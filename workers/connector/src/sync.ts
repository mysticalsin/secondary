// Delta sync for one source. Idempotent: replaying a page upserts the same ids with the same eTag,
// which the Workspace treats as a no-op. State moves only after the page was applied downstream:
// the delta/next link is saved after the Workspace accepted the page, so a crash replays that page.

import type { CallOutcome, FailureReason } from "../../../packages/contracts/src/ops-v7.ts";
import { decodeText, EXTRACTOR_VERSION, isTextCandidate, MAX_TEXT_BYTES } from "./extract.ts";
import {
  GraphAuthError,
  GraphGoneError,
  GraphHttpError,
  type GraphLike,
  GraphThrottledError,
} from "./graph.ts";
import { itemKey, sha256Hex } from "./ids.ts";
import { settingsOf } from "./registry.ts";
import type { ApiItem, ApiSink, Cursor, LocalRecord, SourceDef, Store } from "./types.ts";

export const DEFAULT_MAX_PAGES = 20;
const FULL_RESYNC_MS = 24 * 3_600_000;

export interface SyncDeps {
  store: Store;
  graph: GraphLike;
  api: ApiSink;
  now: () => number;
  maxPages?: number;
  log?: (event: string, ids: Record<string, string | number>) => void;
}

export type SyncOutcome =
  | { status: "done"; pages: number; upserted: number; deleted: number; resynced: boolean }
  | { status: "more"; pages: number; upserted: number; deleted: number }
  | { status: "throttled"; retryAfterSeconds: number; pages: number }
  | { status: "error"; error: string; pages: number }
  | { status: "skipped"; reason: "disabled" | "not_found" | "paused" };

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  root?: unknown;
  deleted?: unknown;
  parentReference?: { id?: string; path?: string };
  "@microsoft.graph.downloadUrl"?: string;
}
interface DeltaPage {
  value?: DriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

const initialUrl = (s: SourceDef) => `/drives/${encodeURIComponent(s.driveId)}/root/delta?$top=200`;

const normPath = (p: string): string => {
  const t = `/${p.trim().replace(/^\/+|\/+$/g, "")}`;
  return t === "/" ? "" : t;
};

/** Is the item inside the source's folder? Delta only runs on the drive root, so the folder is a filter. */
export function inFolder(item: DriveItem, folderPath: string): boolean {
  const folder = normPath(folderPath);
  if (!folder) return true;
  const raw = item.parentReference?.path;
  if (!raw) return false;
  const at = raw.indexOf("root:");
  if (at < 0) return false;
  let rel: string;
  try {
    rel = decodeURIComponent(raw.slice(at + 5));
  } catch {
    return false;
  }
  rel = normPath(rel);
  return rel === folder || rel.startsWith(`${folder}/`);
}

export class GraphTimeoutError extends Error {
  constructor() {
    super("graph_timeout");
  }
}

/** The failure reason an operator sees for an error code. Codes only, never a response body. */
export function reasonOf(code: string): FailureReason {
  if (code === "graph_throttled") return "graph_429";
  if (code === "graph_timeout") return "timeout";
  if (code === "graph_auth_failed" || code === "graph_http_401" || code === "graph_http_403")
    return "permission_denied";
  if (code === "graph_http_404") return "permission_denied";
  return "parse_error";
}

/**
 * Graph with a per-call timeout (the source's setting) that records how long each call took and how
 * it ended. A timed-out call is abandoned, not cancelled: the sync sees an error and retries by policy.
 */
export function timedGraph(
  graph: GraphLike,
  store: Store,
  sourceId: string,
  timeoutSeconds: number,
  now: () => number,
): GraphLike {
  return {
    getBytes: (url, max) => graph.getBytes(url, max),
    async getJson<T = unknown>(path: string): Promise<T> {
      const t0 = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: CallOutcome = "ok";
      try {
        return await Promise.race([
          graph.getJson<T>(path),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new GraphTimeoutError()), timeoutSeconds * 1000);
          }),
        ]);
      } catch (e) {
        outcome =
          e instanceof GraphTimeoutError
            ? "timeout"
            : e instanceof GraphThrottledError
              ? "429"
              : "error";
        throw e;
      } finally {
        clearTimeout(timer);
        await store.recordCall(sourceId, { at: t0, ms: now() - t0, outcome });
      }
    },
  };
}

/** One run of a source: the delta pass itself, then the attempt is recorded for the operator views. */
export async function syncSource(
  deps: SyncDeps,
  tenantId: string,
  sourceId: string,
): Promise<SyncOutcome> {
  const source = await deps.store.getSource(sourceId);
  if (!source) return { status: "skipped", reason: "not_found" };
  if (!source.enabled) return { status: "skipped", reason: "disabled" };
  if (source.paused) return { status: "skipped", reason: "paused" };
  const settings = settingsOf(source);
  const t0 = deps.now();
  const out = await runPass(
    {
      ...deps,
      graph: timedGraph(deps.graph, deps.store, sourceId, settings.timeoutSeconds, deps.now),
    },
    tenantId,
    source,
  );
  if (out.status === "skipped") return out;
  const failed = out.status === "error" || out.status === "throttled";
  const reason =
    out.status === "throttled" ? "graph_throttled" : out.status === "error" ? out.error : "";
  await deps.store.recordAttempt(sourceId, {
    at: t0,
    ms: deps.now() - t0,
    outcome:
      out.status === "throttled"
        ? "throttled"
        : out.status === "error"
          ? out.error === "graph_timeout"
            ? "timeout"
            : "error"
          : "ok",
    reason: failed ? reasonOf(reason) : null,
    retryAfter: out.status === "throttled" ? out.retryAfterSeconds : null,
  });
  return out;
}

async function runPass(deps: SyncDeps, tenantId: string, source: SourceDef): Promise<SyncOutcome> {
  const { store, graph } = deps;
  const sourceId = source.id;

  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  let cursor = await store.getCursor(sourceId);
  // A daily full pass catches what delta cannot report (renamed folders, silent ACL-only changes).
  if (
    !cursor.nextLink &&
    cursor.deltaLink &&
    cursor.lastFullAt !== null &&
    deps.now() - cursor.lastFullAt > FULL_RESYNC_MS
  ) {
    cursor = startFull(cursor, deps.now());
  }
  if (!cursor.deltaLink && !cursor.nextLink && !cursor.full) cursor = startFull(cursor, deps.now());

  let pages = 0;
  let upserted = 0;
  let deleted = 0;
  let resynced = false;
  let url = cursor.nextLink ?? cursor.deltaLink ?? initialUrl(source);

  try {
    for (;;) {
      if (pages >= maxPages) {
        await store.setCursor({ ...cursor, nextLink: url, lastError: null });
        return { status: "more", pages, upserted, deleted };
      }
      let page: DeltaPage;
      try {
        page = await graph.getJson<DeltaPage>(url);
      } catch (e) {
        if (e instanceof GraphGoneError && !resynced) {
          // 410: the delta token expired. Start over with a full pass; unseen records are removed at its end.
          resynced = true;
          cursor = startFull({ ...cursor, deltaLink: null, nextLink: null }, deps.now());
          await store.setCursor(cursor);
          url = initialUrl(source);
          deps.log?.("sync.resync", { sourceId });
          continue;
        }
        throw e;
      }
      pages++;
      const res = await applyPage(deps, tenantId, source, cursor, page.value ?? []);
      upserted += res.upserted;
      deleted += res.deleted;

      const next = page["@odata.nextLink"];
      const delta = page["@odata.deltaLink"];
      if (next) {
        url = next;
        cursor = { ...cursor, nextLink: next, lastError: null };
        await store.setCursor(cursor);
        continue;
      }
      if (!delta) throw new Error("graph_page_without_link");
      if (cursor.full) deleted += await reconcile(deps, tenantId, source, cursor.gen);
      cursor = {
        ...cursor,
        deltaLink: delta,
        nextLink: null,
        full: false,
        lastSyncAt: deps.now(),
        lastFullAt: cursor.lastFullAt,
        lastError: null,
      };
      await store.setCursor(cursor);
      deps.log?.("sync.done", { sourceId, pages, upserted, deleted });
      return { status: "done", pages, upserted, deleted, resynced };
    }
  } catch (e) {
    if (e instanceof GraphThrottledError) {
      await store.setCursor({ ...cursor, lastError: "throttled" });
      return { status: "throttled", retryAfterSeconds: e.retryAfterSeconds, pages };
    }
    const code =
      e instanceof GraphHttpError || e instanceof GraphAuthError || e instanceof Error
        ? e.message.slice(0, 80)
        : "error";
    await store.setCursor({ ...cursor, lastError: code });
    deps.log?.("sync.error", { sourceId, error: code });
    return { status: "error", error: code, pages };
  }
}

function startFull(c: Cursor, now: number): Cursor {
  return { ...c, full: true, gen: c.gen + 1, nextLink: null, deltaLink: null, lastFullAt: now };
}

async function applyPage(
  deps: SyncDeps,
  tenantId: string,
  source: SourceDef,
  cursor: Cursor,
  items: DriveItem[],
): Promise<{ upserted: number; deleted: number }> {
  const { store, graph, api } = deps;
  const removed = new Set<string>();
  const dropped: string[] = [];
  const pending: { rec: LocalRecord; api: ApiItem | null }[] = [];

  for (const it of items) {
    if (!it.id || it.root) continue;
    const itemId = await itemKey(source.id, source.driveId, it.id);

    if (it.deleted) {
      // The id itself is always sent: removal is idempotent and covers a crash between upsert and local write.
      removed.add(itemId);
      for (const id of await store.listTree(itemId)) removed.add(id);
      dropped.push(itemId);
      continue;
    }
    if (it.folder) {
      await store.putRecord(folderRecord(source, itemId, it, deps.now(), cursor.gen));
      continue;
    }
    if (!it.file) continue;

    const existing = await store.getRecord(itemId);
    if (!inFolder(it, source.folderPath)) {
      // Moved out of the mapped folder: stop serving it.
      if (existing) {
        removed.add(itemId);
        dropped.push(itemId);
      }
      continue;
    }
    const eTag = it.eTag ?? "";
    if (existing && existing.eTag === eTag && existing.cTag === (it.cTag ?? null)) {
      await store.touchRecord(itemId, cursor.gen);
      continue;
    }

    const name = it.name ?? "untitled";
    const size = typeof it.size === "number" && it.size >= 0 ? it.size : 0;
    const mime = it.file.mimeType ?? null;
    const now = deps.now();
    let body: string | null = null;
    let contentSha: string;
    let byteLength = size;
    // Only UTF-8 text and Markdown are downloaded. Everything else is metadata plus a source link.
    if (isTextCandidate(name, mime, size)) {
      const url = it["@microsoft.graph.downloadUrl"];
      const bytes = url ? await graph.getBytes(url, MAX_TEXT_BYTES) : null;
      if (bytes) {
        body = decodeText(bytes);
        contentSha = await sha256Hex(bytes);
        byteLength = bytes.byteLength;
      } else {
        contentSha = await sha256Hex(`meta:${it.id}:${eTag}`);
      }
    } else {
      contentSha = await sha256Hex(`meta:${it.id}:${eTag}`);
    }

    const rec: LocalRecord = {
      itemId,
      sourceId: source.id,
      kind: "file",
      driveItemId: it.id,
      parentId: it.parentReference?.id ?? null,
      name,
      mime,
      size,
      eTag,
      cTag: it.cTag ?? null,
      webUrl: it.webUrl ?? null,
      contentSha256: contentSha,
      hasText: body !== null,
      extractorVersion: EXTRACTOR_VERSION,
      fetchedAt: now,
      // A new revision was fetched but no user permission was confirmed yet: not servable until checked.
      aclCheckedAt: null,
      aclState: "unknown",
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      gen: cursor.gen,
    };
    pending.push({
      rec,
      api: {
        id: itemId,
        title: name,
        body,
        webUrl: it.webUrl ?? null,
        mime,
        size: byteLength,
        eTag,
        syncedAt: now,
      },
    });
  }

  // Deletions first, then upserts. The Workspace is written before local state moves.
  if (removed.size) await api.remove(tenantId, source, [...removed]);
  for (const id of dropped) await store.deleteTree(id);
  if (pending.length)
    await api.upsert(
      tenantId,
      source,
      pending.map((p) => p.api as ApiItem),
    );
  for (const p of pending) {
    await store.putRecord(p.rec);
    // A changed item may have changed permissions: drop cached decisions so the next read re-checks.
    await store.deleteAclFor(p.rec.itemId);
  }
  return { upserted: pending.length, deleted: removed.size };
}

function folderRecord(
  source: SourceDef,
  itemId: string,
  it: DriveItem,
  now: number,
  gen: number,
): LocalRecord {
  return {
    itemId,
    sourceId: source.id,
    kind: "folder",
    driveItemId: it.id,
    parentId: it.parentReference?.id ?? null,
    name: "",
    mime: null,
    size: 0,
    eTag: it.eTag ?? "",
    cTag: it.cTag ?? null,
    webUrl: null,
    contentSha256: "",
    hasText: false,
    extractorVersion: EXTRACTOR_VERSION,
    fetchedAt: now,
    aclCheckedAt: null,
    aclState: "unknown",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    gen,
  };
}

/** End of a full pass: files the pass did not see are gone at the source. */
async function reconcile(
  deps: SyncDeps,
  tenantId: string,
  source: SourceDef,
  gen: number,
): Promise<number> {
  const stale = await deps.store.listOlder(source.id, gen);
  const files = stale.filter((r) => r.kind === "file").map((r) => r.itemId);
  if (files.length) await deps.api.remove(tenantId, source, files);
  for (const r of stale) await deps.store.deleteTree(r.itemId);
  return files.length;
}

/** Source removed or disabled by an operator: drop everything it put into the Workspace and local state. */
export async function purgeSource(deps: SyncDeps, tenantId: string, sourceId: string) {
  const source = await deps.store.getSource(sourceId);
  if (!source) return { purged: 0 };
  await deps.api.purge(tenantId, source);
  const ids = await deps.store.deleteBySource(sourceId);
  return { purged: ids.length };
}
