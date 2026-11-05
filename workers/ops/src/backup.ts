// Snapshot, prune, list and restore. Everything here takes its dependencies as arguments, so the
// same code runs in the cron, in the admin routes and in the API's round-trip test.
//
// A snapshot is one R2 object per Durable Object: <date>/<tenant>/tenant.jsonl.enc for the TenantPolicy
// and <date>/<tenant>/ws-<scope>.jsonl.enc for each Workspace. The plaintext is JSONL: a first line
// {"_meta": ...} then one {"t": table, "r": row} per row. It is encrypted before it reaches R2.

import { logEvent } from "../../../packages/contracts/src/log.ts";
import { signOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { decryptBackup, encryptBackup } from "./crypto.ts";

export interface BackupDeps {
  BACKUPS: R2Bucket;
  API: Fetcher;
  ENVIRONMENT: string;
  INTERNAL_HMAC_KEY: string | undefined;
  BACKUP_KEY: string | undefined;
  BACKUP_KEY_PREVIOUS?: string | undefined;
  BACKUP_RETENTION_DAYS?: string | undefined;
  RESTORE_ENABLED?: string | undefined;
}

const API_ORIGIN = "https://api.internal";
const DAY_MS = 86_400_000;
const PARALLEL = 4;
export const DEFAULT_RETENTION_DAYS = 35;

type Target = { tenant: string; kind: "tenant" | "workspace"; scope: string };
type Tables = Record<string, Record<string, unknown>[]>;

export const objectKey = (date: string, t: Target): string =>
  `${date}/${t.tenant}/${t.kind === "tenant" ? "tenant" : `ws-${t.scope}`}.jsonl.enc`;

async function callApi(
  d: BackupDeps,
  method: "GET" | "POST",
  pathAndQuery: string,
  body?: string,
): Promise<Response> {
  const url = `${API_ORIGIN}${pathAndQuery}`;
  const headers = await signOpsRequest({
    secret: d.INTERNAL_HMAC_KEY ?? "",
    method,
    url,
    ...(body !== undefined ? { body } : {}),
  });
  return d.API.fetch(url, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body } : {}),
  });
}

const query = (t: Target) =>
  `tenant=${encodeURIComponent(t.tenant)}&kind=${t.kind}&scope=${encodeURIComponent(t.scope)}`;

export function toJsonl(meta: Record<string, unknown>, tables: Tables): string {
  const lines = [JSON.stringify({ _meta: meta })];
  for (const [t, rows] of Object.entries(tables))
    for (const r of rows) lines.push(JSON.stringify({ t, r }));
  return `${lines.join("\n")}\n`;
}

export function fromJsonl(text: string): { meta: Record<string, unknown>; tables: Tables } {
  const [first, ...rest] = text.split("\n").filter((l) => l.trim());
  const head = JSON.parse(first ?? "null") as { _meta?: Record<string, unknown> } | null;
  if (!head?._meta) throw new Error("invalid_snapshot");
  const tables: Tables = {};
  for (const line of rest) {
    const { t, r } = JSON.parse(line) as { t: string; r: Record<string, unknown> };
    const rows = tables[t] ?? [];
    rows.push(r);
    tables[t] = rows;
  }
  return { meta: head._meta, tables };
}

/** Snapshot every Durable Object of every tenant. Throws after trying all of them if any failed. */
export async function runBackup(
  d: BackupDeps,
  now = Date.now(),
): Promise<{ objects: number; bytes: number; skipped: number }> {
  if (!d.BACKUP_KEY || d.BACKUP_KEY.length < 32) throw new Error("BACKUP_KEY missing");
  const res = await callApi(d, "GET", "/v1/internal/ops/targets");
  if (!res.ok) throw new Error(`targets ${res.status}`);
  const { tenants } = (await res.json()) as { tenants: { tenantId: string; scopes: string[] }[] };
  const date = new Date(now).toISOString().slice(0, 10);
  const targets: Target[] = tenants.flatMap((t) => [
    { tenant: t.tenantId, kind: "tenant" as const, scope: "" },
    ...t.scopes.map((scope) => ({ tenant: t.tenantId, kind: "workspace" as const, scope })),
  ]);
  let objects = 0;
  let bytes = 0;
  let skipped = 0;
  let failed = 0;
  const one = async (t: Target) => {
    try {
      const r = await callApi(d, "GET", `/v1/internal/ops/export?${query(t)}`);
      if (!r.ok) throw new Error(`export ${r.status}`);
      const { tables } = (await r.json()) as { tables: Tables };
      if (Object.values(tables).every((rows) => rows.length === 0)) {
        skipped++;
        return;
      }
      const key = objectKey(date, t);
      const plain = new TextEncoder().encode(
        toJsonl(
          {
            v: 1,
            env: d.ENVIRONMENT,
            at: new Date(now).toISOString(),
            tenant: t.tenant,
            kind: t.kind,
            scope: t.scope,
          },
          tables,
        ),
      ) as Uint8Array<ArrayBuffer>;
      const enc = await encryptBackup(d.BACKUP_KEY as string, key, plain);
      await d.BACKUPS.put(key, enc, { customMetadata: { tenant: t.tenant, kind: t.kind } });
      objects++;
      bytes += enc.length;
    } catch (e) {
      failed++;
      logEvent({
        event: "backup_failed",
        worker: "ops",
        env: d.ENVIRONMENT,
        errorName: e instanceof Error ? e.name : "unknown",
      });
    }
  };
  for (let i = 0; i < targets.length; i += PARALLEL)
    await Promise.all(targets.slice(i, i + PARALLEL).map(one));
  logEvent({
    event: "backup_done",
    worker: "ops",
    env: d.ENVIRONMENT,
    count: objects,
    ok: failed === 0,
  });
  if (failed > 0) throw new Error(`${failed} snapshot(s) failed`);
  return { objects, bytes, skipped };
}

/** Delete snapshots dated before today minus BACKUP_RETENTION_DAYS (default 35). Returns the number deleted. */
export async function pruneBackups(d: BackupDeps, now = Date.now()): Promise<number> {
  const parsed = Number.parseInt(d.BACKUP_RETENTION_DAYS ?? "", 10);
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await d.BACKUPS.list({ ...(cursor ? { cursor } : {}) });
    const old = page.objects
      .filter((o) => /^\d{4}-\d{2}-\d{2}\//.test(o.key) && o.key.slice(0, 10) < cutoff)
      .map((o) => o.key);
    if (old.length) await d.BACKUPS.delete(old);
    deleted += old.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function listBackups(
  d: BackupDeps,
  prefix = "",
): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await d.BACKUPS.list({ prefix, ...(cursor ? { cursor } : {}) });
    out.push(...page.objects.map((o) => ({ key: o.key, size: o.size })));
    cursor = page.truncated && out.length < 1000 ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export type RestoreResult =
  | { ok: true; tenant: string; kind: string; scope: string; rows: number; dryRun: boolean }
  | {
      ok: false;
      error:
        | "restore_disabled"
        | "not_found"
        | "cannot_decrypt"
        | "invalid_snapshot"
        | "api_refused";
    };

/** Decrypt one snapshot and replace the matching Durable Object with it. `dryRun` stops after decrypting. */
export async function restoreBackup(
  d: BackupDeps,
  key: string,
  dryRun = false,
): Promise<RestoreResult> {
  if (d.RESTORE_ENABLED !== "yes") return { ok: false, error: "restore_disabled" };
  const obj = await d.BACKUPS.get(key);
  if (!obj) return { ok: false, error: "not_found" };
  const plain = await decryptBackup(
    [d.BACKUP_KEY ?? "", d.BACKUP_KEY_PREVIOUS ?? ""],
    key,
    new Uint8Array(await obj.arrayBuffer()) as Uint8Array<ArrayBuffer>,
  );
  if (!plain) return { ok: false, error: "cannot_decrypt" };
  let snap: ReturnType<typeof fromJsonl>;
  try {
    snap = fromJsonl(new TextDecoder().decode(plain));
  } catch {
    return { ok: false, error: "invalid_snapshot" };
  }
  const { tenant, kind, scope } = snap.meta as {
    tenant: string;
    kind: "tenant" | "workspace";
    scope: string;
  };
  const rows = Object.values(snap.tables).reduce((n, r) => n + r.length, 0);
  if (dryRun) return { ok: true, tenant, kind, scope, rows, dryRun: true };
  const res = await callApi(
    d,
    "POST",
    `/v1/internal/ops/restore?${query({ tenant, kind, scope })}`,
    JSON.stringify({ tables: snap.tables }),
  );
  if (!res.ok) return { ok: false, error: res.status === 422 ? "invalid_snapshot" : "api_refused" };
  return { ok: true, tenant, kind, scope, rows, dryRun: false };
}

/** The retention job: ask the API to delete expired Personal Brain drafts and briefs. */
export async function runRetention(d: BackupDeps): Promise<{ purged: number }> {
  const res = await callApi(d, "POST", "/v1/internal/ops/retention", "{}");
  if (!res.ok) throw new Error(`retention ${res.status}`);
  const out = (await res.json()) as { purged: number };
  logEvent({ event: "retention_done", worker: "ops", env: d.ENVIRONMENT, count: out.purged });
  return { purged: out.purged };
}
