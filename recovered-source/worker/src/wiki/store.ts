// The wiki of one workspace, stored in that workspace's Durable Object (WikiBase is the parent class
// of Workspace). Pages, facts with validity, an append-only log, the schema, source hashes, jobs and
// lint findings live in wiki_* tables beside the items they cite. Review items are ordinary
// workspace items (kinds wiki_ingest, wiki_lint, wiki_dream), so they ride the existing review queue.
// Nothing here knows who the caller is: the API checks policy first and passes the actor.

import { DurableObject } from "cloudflare:workers";
import {
  claimImport,
  commitImport,
  decodeImportStatus,
} from "../../../../src/state/import-outcome.ts";
import { claimPage, commitPage, decodePageStatus } from "../../../../src/state/page-visibility.ts";
import {
  claimProposal,
  commitProposal,
  decodeFindingStatus,
  decodeProposalStatus,
  type FindingStatus,
} from "../../../../src/state/proposal-review.ts";
import { citedSourceIds } from "../../../../src/state/proposal-citation.ts";
import { decodeWikiJobStatus, forgetWikiJob } from "../../../../src/state/wiki-job.ts";
import type { Fail, ItemRecord, NewItem } from "../workspace.ts";
import { runWikiJobs, type WikiApi } from "./engine.ts";
import {
  capLines,
  citationsOf,
  claimLines,
  emptyGenerated,
  GENERATED,
  lineDiff,
  PAGE_ID,
  renderGenerated,
  sha256Hex,
  slug,
  summaryOf,
} from "./text.ts";
import {
  DEFAULT_SCHEMA,
  type Fact,
  type FactOrigin,
  type Health,
  isPersonalScope,
  isWikiKind,
  type NewFact,
  nodeOfScope,
  type PageDraft,
  type PageOrigin,
  type PageRow,
  type Proposal,
  type SchemaType,
  type SourceInfo,
  type WikiSchema,
} from "./types.ts";

const DAY = 86_400_000;
const GENERATED_ORDER = ["decision_log", "commitments", "risk_register"] as const;
/** Item kinds that count as raw sources. Review items and counters never do. A candidate counts only once released. */
const SOURCE_KINDS = new Set(["record", "meeting_record", "personalitem", "candidate"]);
const MAX_PAGE_CHARS = 20_000;
/** Pages one request loads into memory, and revisions one history answer returns (M-03). */
export const MAX_PAGES_LOADED = 500;
export const HISTORY_DEFAULT = 20;
export const HISTORY_MAX = 50;
const MAX_REFS = 1_000;
/** A source read again within this window waits for it before the next ingest (M-05). */
export const INGEST_DEBOUNCE_MS = 10 * 60_000;
/** A claimed job that never finishes is retried this many times, then given up (L-05). */
const MAX_ATTEMPTS = 3;
const DONE_JOB_KEEP_MS = 14 * DAY;
/** Author of the synthetic raw records the dev seed writes. */
export const SEED_ACTOR = "svc:seed";
export type SeedDoc = {
  id: string;
  label: string;
  kind: "record" | "meeting_record" | "personalitem";
  status: string;
  tags: string[];
  body: string;
  /** How many days before the seed the record is dated. */
  ageDays: number;
};
/** Recorded as `verified_by` on what the dev seed accepted. */
export const SEED_VERIFIER = "seed:synthetic";
/** The service identity that signs what the wiki publishes on its own account (L-06). */
export const serviceId = (scopeId: string): string => `svc:wiki:${scopeId}`;

export const WIKI_TABLES = [
  "wiki_meta",
  "wiki_pages",
  "wiki_fts",
  "wiki_page_revisions",
  "wiki_facts",
  "wiki_log",
  "wiki_schema",
  "wiki_sources",
  "wiki_jobs",
  "wiki_findings",
  "wiki_promotions",
  "brain_members",
  "brain_fields",
  "brain_coach",
] as const;

/** A record tagged "contacts" in an account is gated by the account's Contacts subspace, not the account. */
const gateOfItem = (own: string, tagsJson: string): string =>
  own.startsWith("a_") && tagsJson.includes('"contacts"') ? `${own}:con` : own;

const hex8 = (): string =>
  [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** The next 02:00 UTC after `now`. */
export const nextNight = (now: number): number => {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2);
  return t > now ? t : t + DAY;
};

export type JobRow = { id: number; kind: string; payload: Record<string, unknown>; runAt: number };
export type ProposeOpts = {
  plane: string;
  autoAccept?: boolean;
  /** A person's proposal may cite only sources they can read (L-01). Agents omit it. */
  readable?: string[];
  /** Dev seed only: apply at once, marked "Synthetic seed". Refused unless ENVIRONMENT is dev. */
  seed?: boolean;
  /**
   * The route decided this proposal publishes at once: the brain's publication mode is direct, the
   * policy bounds allow it and the caller may edit. Only a plain page proposal ever takes this path.
   */
  publishDirect?: boolean;
};
export type ProposeResult =
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; id: string; autoAccepted: boolean }
  | Fail;
export type ApplyResult = { pages: string[]; facts: number; invalidated: number; archived: number };
export type DecideResult =
  | {
      ok: true;
      status: "approved" | "rejected" | "pending";
      applied: ApplyResult | null;
      approvals: number;
      required: number;
    }
  | Fail;

class PageRefusal extends Error {
  readonly fail: Fail;
  constructor(fail: Fail) {
    super(fail.code);
    this.fail = fail;
  }
}

function proposalFail(reason: string): Fail {
  if (reason === "replay")
    return { ok: false, code: "replay", message: "The proposal changed since it was read" };
  if (reason === "not_pending")
    return { ok: false, code: "not_pending", message: "The proposal was already decided" };
  if (reason === "same_actor" || reason === "already_done")
    return { ok: false, code: "already_done", message: "You already approved this revision" };
  if (reason === "clock_unreadable")
    return { ok: false, code: "clock_unreadable", message: "The clock cannot be read" };
  return { ok: false, code: "state_unreadable", message: "The proposal status cannot be read" };
}

function importFail(reason: string): Fail {
  if (reason === "replay")
    return { ok: false, code: "replay", message: "The proposal changed since it was read" };
  if (reason === "not_draft")
    return { ok: false, code: "not_draft", message: "Publishing starts from a draft" };
  return {
    ok: false,
    code: "state_unreadable",
    message: "The proposal status cannot be read",
  };
}

function pageFail(reason: string): Fail {
  const code =
    reason === "archived" ||
    reason === "state_unreadable" ||
    reason === "clock_unreadable" ||
    reason === "replay" ||
    reason === "not_archived" ||
    reason === "absent"
      ? reason
      : "state_unreadable";
  const message =
    code === "archived"
      ? "An archived page is not saved. Unarchive it first"
      : code === "state_unreadable"
        ? "The page status cannot be read"
        : code === "clock_unreadable"
          ? "The clock cannot be read"
          : code === "replay"
            ? "The page changed since it was read"
            : code === "not_archived"
              ? "The page is not archived"
              : "There is no page to unarchive";
  return { ok: false, code, message };
}

const rowFact = (r: Record<string, SqlStorageValue>): Fact => ({
  id: r.id as number,
  subject: r.subject as string,
  predicate: r.predicate as string,
  object: r.object as string,
  validAt: r.valid_at as string,
  invalidAt: (r.invalid_at as string | null) ?? null,
  recordedAt: r.recorded_at as string,
  checkedAt: r.checked_at as string,
  sourceIds: JSON.parse(r.source_ids as string) as string[],
  sourceHashes: JSON.parse(r.source_hashes as string) as Record<string, string>,
  confidence: r.confidence as number,
  origin: r.origin as FactOrigin,
  verifiedBy: (r.verified_by as string | null) ?? null,
  proposalId: (r.proposal_id as string | null) ?? null,
});

const rowPage = (r: Record<string, SqlStorageValue>): PageRow => ({
  id: r.id as string,
  type: r.type as string,
  title: r.title as string,
  markdown: r.markdown as string,
  summary: r.summary as string,
  revision: r.revision as number,
  status: r.status as "published" | "archived",
  origin: (r.origin as string | undefined) === "seed" ? "seed" : "human",
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

/** Proposals written before `titleSources` existed: what they cite is what they derive from. */
const sourcesOfLegacy = (p: Proposal): string[] => [
  ...new Set([...p.sources.map((x) => x.id), ...p.facts.flatMap((f) => f.sourceIds)]),
];

export abstract class WikiBase extends DurableObject<Env> {
  protected readonly sql: SqlStorage;

  abstract create(n: NewItem, now: number): ItemRecord | Fail;
  abstract get(id: string): ItemRecord | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS wiki_pages (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(title, summary, body, id UNINDEXED);
        CREATE TABLE IF NOT EXISTS wiki_page_revisions (
          page_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
          actor TEXT, at INTEGER NOT NULL, proposal_id TEXT, PRIMARY KEY (page_id, revision));
        CREATE TABLE IF NOT EXISTS wiki_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, predicate TEXT NOT NULL,
          object TEXT NOT NULL, valid_at TEXT NOT NULL, invalid_at TEXT, recorded_at TEXT NOT NULL,
          checked_at TEXT NOT NULL, source_ids TEXT NOT NULL, source_hashes TEXT NOT NULL,
          confidence REAL NOT NULL, origin TEXT NOT NULL, verified_by TEXT, proposal_id TEXT);
        CREATE INDEX IF NOT EXISTS wiki_facts_sp ON wiki_facts (subject, predicate);
        CREATE TABLE IF NOT EXISTS wiki_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
          kind TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS wiki_schema (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS wiki_sources (
          source_id TEXT PRIMARY KEY, hash TEXT NOT NULL, title TEXT NOT NULL,
          ingested_hash TEXT, ingested_at INTEGER, gate_node_id TEXT);
        CREATE TABLE IF NOT EXISTS wiki_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
          run_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', result TEXT);
        CREATE TABLE IF NOT EXISTS wiki_findings (
          key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, proposal_id TEXT, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS wiki_promotions (
          candidate_id TEXT PRIMARY KEY, title TEXT NOT NULL, at INTEGER NOT NULL, page_id TEXT);
      `);
      // Objects created before the attempt counter keep their rows.
      const cols = this.sql.exec("PRAGMA table_info(wiki_jobs)").toArray();
      if (!cols.some((c) => c.name === "attempts"))
        this.sql.exec("ALTER TABLE wiki_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
      if (!cols.some((c) => c.name === "subject"))
        this.sql.exec("ALTER TABLE wiki_jobs ADD COLUMN subject TEXT");
      this.sql.exec(
        `UPDATE wiki_jobs SET subject = json_extract(payload, '$.sourceId')
         WHERE subject IS NULL AND json_valid(payload) AND json_type(payload, '$.sourceId') = 'text'
           AND json_extract(payload, '$.sourceId') != ''`,
      );
      // Pages made by the dev seed say so ("seed"); everything else is "human".
      if (
        !this.sql
          .exec("PRAGMA table_info(wiki_pages)")
          .toArray()
          .some((c) => c.name === "origin")
      )
        this.sql.exec("ALTER TABLE wiki_pages ADD COLUMN origin TEXT NOT NULL DEFAULT 'human'");
    });
  }

  // ---- meta ----

  protected metaGet(key: string): string | null {
    const r = this.sql.exec("SELECT value FROM wiki_meta WHERE key = ?", key).toArray()[0];
    return r ? (r.value as string) : null;
  }
  protected metaSet(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO wiki_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /** Remember which tenant and scope this object serves (the alarm has no request to ask). */
  async wikiTouch(tenantId: string, scopeId: string, now: number): Promise<void> {
    if (this.metaGet("scope_id")) return;
    this.metaSet("tenant_id", tenantId);
    this.metaSet("scope_id", scopeId);
    this.metaSet("next_lint_at", String(now + DAY));
    this.metaSet("next_dream_at", String(nextNight(now)));
    this.sql.exec(
      "INSERT OR IGNORE INTO wiki_schema (id, body) VALUES (1, ?)",
      JSON.stringify(DEFAULT_SCHEMA),
    );
    await this.wikiSchedule(now);
  }

  /** A source was created or changed: remember the wiki's identity and queue one ingest job per source. */
  async wikiNotify(
    tenantId: string,
    scopeId: string,
    sourceIds: string[],
    now: number,
  ): Promise<void> {
    await this.wikiTouch(tenantId, scopeId, now);
    for (const id of sourceIds.slice(0, 200))
      await this.wikiEnqueue("ingest", { sourceId: id }, now);
  }

  /**
   * Dev seed for this workspace: create the synthetic raw records that are not here yet, extend the
   * page types, and run the ingest for each through the deterministic path. Idempotent (an existing
   * record or an unchanged source adds nothing) and it never touches what people wrote. Refuses
   * anywhere but the dev environment.
   */
  async wikiSeedRun(
    tenantId: string,
    scopeId: string,
    plane: string,
    types: Record<string, SchemaType>,
    docs: SeedDoc[],
    now: number,
  ): Promise<{ created: number; pages: number } | { refused: true }> {
    if (this.env.ENVIRONMENT !== "dev") return { refused: true };
    await this.wikiTouch(tenantId, scopeId, now);
    const cur = this.wikiSchema();
    this.wikiSetSchema({ ...cur, types: { ...types, ...cur.types } });
    const personal = isPersonalScope(scopeId);
    let created = 0;
    for (const d of docs) {
      if (!this.get(d.id)) {
        const made = this.create(
          {
            id: d.id,
            label: d.label,
            kind: d.kind,
            plane,
            origin: personal ? "personal" : "record",
            status: d.status,
            authorId: personal ? scopeId.slice("personal:".length) : SEED_ACTOR,
            body: d.body,
            tags: d.tags,
          },
          now - d.ageDays * DAY,
        );
        if ("ok" in made) continue;
        created++;
      }
      await this.wikiEnqueue("ingest", { sourceId: d.id }, now, now);
    }
    for (let round = 0; round < 60; round++) {
      const ran = await runWikiJobs(this as unknown as WikiApi, {
        env: this.env,
        now,
        dueAt: now + 1,
        only: ["ingest"],
        seed: true,
      });
      if (!ran.length) break;
    }
    return { created, pages: this.wikiPages().length };
  }

  wikiMeta(): {
    tenantId: string;
    scopeId: string;
    autoAccept: boolean;
    freshnessDays: number;
    nextLintAt: number;
    nextDreamAt: number;
    lastLintAt: number | null;
  } | null {
    const scopeId = this.metaGet("scope_id");
    const tenantId = this.metaGet("tenant_id");
    if (!scopeId || !tenantId) return null;
    return {
      tenantId,
      scopeId,
      autoAccept: this.metaGet("auto_accept") === "1",
      freshnessDays: Number(this.metaGet("freshness_days") ?? "180") || 180,
      nextLintAt: Number(this.metaGet("next_lint_at") ?? "0"),
      nextDreamAt: Number(this.metaGet("next_dream_at") ?? "0"),
      lastLintAt: this.metaGet("last_lint_at") ? Number(this.metaGet("last_lint_at")) : null,
    };
  }

  wikiSetSettings(patch: { autoAccept?: boolean; freshnessDays?: number }): void {
    if (patch.autoAccept !== undefined) this.metaSet("auto_accept", patch.autoAccept ? "1" : "0");
    if (patch.freshnessDays !== undefined)
      this.metaSet("freshness_days", String(Math.min(Math.max(patch.freshnessDays, 7), 1_095)));
  }

  wikiSchema(): WikiSchema {
    const r = this.sql.exec("SELECT body FROM wiki_schema WHERE id = 1").toArray()[0];
    return r ? (JSON.parse(r.body as string) as WikiSchema) : DEFAULT_SCHEMA;
  }

  wikiSetSchema(s: WikiSchema): void {
    this.sql.exec(
      "INSERT INTO wiki_schema (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      JSON.stringify(s),
    );
  }

  // ---- log (append only: no method updates or deletes a row) ----

  wikiLogAppend(actor: string, kind: string, detail: Record<string, unknown>, now: number): void {
    this.sql.exec(
      "INSERT INTO wiki_log (at, actor, kind, detail) VALUES (?, ?, ?, ?)",
      now,
      actor,
      kind,
      JSON.stringify(detail).slice(0, 4_000),
    );
  }

  wikiLog(
    limit: number,
  ): { id: number; at: number; actor: string; kind: string; detail: string }[] {
    return this.sql
      .exec("SELECT * FROM wiki_log ORDER BY id DESC LIMIT ?", limit)
      .toArray()
      .map((r) => ({
        id: r.id as number,
        at: r.at as number,
        actor: r.actor as string,
        kind: r.kind as string,
        detail: r.detail as string,
      }));
  }

  // ---- sources ----

  /** A raw source with its content hash, or null when it is not one (or is gone). */
  async wikiSourceInfo(id: string): Promise<SourceInfo | null> {
    const scope = this.metaGet("scope_id") ?? "";
    const it = this.get(id);
    if (it) {
      if (!SOURCE_KINDS.has(it.kind)) return null;
      if (it.kind === "personalitem" && !it.tags.includes("note")) return null;
      // Only a released candidate is a source, and its own target node gates it (L-02).
      if (it.kind === "candidate" && it.status !== "approved") return null;
      const body = it.body ?? "";
      return {
        id,
        kind: "item",
        title: it.label,
        body,
        hash: await sha256Hex(`${it.kind}\n${it.status}\n${it.label}\n${body}`),
        tags: it.tags,
        status: it.status,
        authorId: it.authorId,
        itemKind: it.kind,
        updatedAt: it.updatedAt,
        gateNodeId:
          it.kind === "candidate"
            ? (it.targetNode ?? nodeOfScope(scope))
            : gateOfItem(nodeOfScope(scope), JSON.stringify(it.tags)),
      };
    }
    const s = this.sql.exec("SELECT * FROM source_items WHERE id = ?", id).toArray()[0];
    if (!s) return null;
    const body = (s.body as string | null) ?? "";
    return {
      id,
      kind: "source",
      title: s.title as string,
      body,
      hash: await sha256Hex(`source\n${s.title as string}\n${body}`),
      tags: [],
      status: "synced",
      authorId: null,
      itemKind: "source",
      updatedAt: s.synced_at as number,
      gateNodeId: s.gate_node_id as string,
    };
  }

  /** Light lookups for citation checks: who gates each source, and what to call it. */
  wikiSourceRefs(
    ids: string[],
  ): { id: string; kind: "item" | "source"; title: string; gateNodeId: string }[] {
    const scope = this.metaGet("scope_id") ?? "";
    const own = nodeOfScope(scope);
    const out: { id: string; kind: "item" | "source"; title: string; gateNodeId: string }[] = [];
    for (const id of ids.slice(0, MAX_REFS)) {
      const it = this.sql
        .exec("SELECT kind, label, status, target_node, tags FROM items WHERE id = ?", id)
        .toArray()[0];
      const kind = it?.kind as string | undefined;
      // Only a released candidate is a source, and its own target node gates it (L-02).
      if (
        it &&
        kind &&
        SOURCE_KINDS.has(kind) &&
        (kind !== "candidate" || it.status === "approved")
      )
        out.push({
          id,
          kind: "item",
          title: it.label as string,
          gateNodeId:
            kind === "candidate"
              ? ((it.target_node as string | null) ?? own)
              : gateOfItem(own, it.tags as string),
        });
      else {
        const s = this.sql
          .exec("SELECT title, gate_node_id FROM source_items WHERE id = ?", id)
          .toArray()[0];
        if (s)
          out.push({
            id,
            kind: "source",
            title: s.title as string,
            gateNodeId: s.gate_node_id as string,
          });
      }
    }
    return out;
  }

  /** Citations of published pages (all, or the named ones), for the per-viewer visibility check. */
  wikiPageCitations(ids?: string[]): { id: string; type: string; cites: string[] }[] {
    const rows = ids
      ? ids
          .slice(0, MAX_PAGES_LOADED)
          .flatMap((id) =>
            this.sql
              .exec(
                "SELECT id, type, markdown FROM wiki_pages WHERE id = ? AND status = 'published'",
                id,
              )
              .toArray(),
          )
      : this.sql
          .exec(
            "SELECT id, type, markdown FROM wiki_pages WHERE status = 'published' ORDER BY id LIMIT ?",
            MAX_PAGES_LOADED,
          )
          .toArray();
    return rows.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      cites: citationsOf(r.markdown as string),
    }));
  }

  /** Current hashes of cited sources. Gone sources are absent. */
  async wikiSourceHashes(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const s = await this.wikiSourceInfo(id);
      if (s) out[id] = s.hash;
    }
    return out;
  }

  wikiSourceState(id: string): { hash: string; ingestedHash: string | null } | null {
    const r = this.sql
      .exec("SELECT hash, ingested_hash FROM wiki_sources WHERE source_id = ?", id)
      .toArray()[0];
    return r
      ? { hash: r.hash as string, ingestedHash: (r.ingested_hash as string | null) ?? null }
      : null;
  }

  /** Remember what the wiki last read from a source. `ingested` marks it as taken into account. */
  wikiSourceSeen(
    id: string,
    hash: string,
    title: string,
    gate: string,
    ingested: boolean,
    now: number,
  ): void {
    this.sql.exec(
      `INSERT INTO wiki_sources (source_id, hash, title, gate_node_id, ingested_hash, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET hash = excluded.hash, title = excluded.title,
         gate_node_id = excluded.gate_node_id,
         ingested_hash = CASE WHEN ? THEN excluded.hash ELSE wiki_sources.ingested_hash END,
         ingested_at = CASE WHEN ? THEN excluded.ingested_at ELSE wiki_sources.ingested_at END`,
      id,
      hash,
      title,
      gate,
      ingested ? hash : null,
      ingested ? now : null,
      ingested ? 1 : 0,
      ingested ? 1 : 0,
    );
  }

  /** Facts that cite `sourceId` and still say what the new text says: their stored hash moves forward. */
  wikiRefreshHashes(
    sourceId: string,
    hash: string,
    keep: { subject: string; predicate: string; object: string }[],
  ): number {
    let n = 0;
    for (const r of this.sql.exec("SELECT * FROM wiki_facts WHERE invalid_at IS NULL").toArray()) {
      const f = rowFact(r);
      if (!f.sourceIds.includes(sourceId)) continue;
      if (
        !keep.some(
          (k) => k.subject === f.subject && k.predicate === f.predicate && k.object === f.object,
        )
      )
        continue;
      this.sql.exec(
        "UPDATE wiki_facts SET source_hashes = ? WHERE id = ?",
        JSON.stringify({ ...f.sourceHashes, [sourceId]: hash }),
        f.id,
      );
      n++;
    }
    return n;
  }

  // ---- jobs and the alarm ----

  async wikiEnqueue(
    kind: "ingest" | "lint" | "dream",
    payload: Record<string, unknown>,
    now: number,
    runAt?: number,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const subject = typeof payload.sourceId === "string" && payload.sourceId !== "" ? payload.sourceId : null;
    // A source read again soon after its last ingest waits for the debounce window: saving a record
    // in a loop makes one job per window, not one per save (M-05).
    if (kind === "ingest" && runAt === undefined && payload.force !== true) {
      const last = this.sql
        .exec(
          "SELECT ingested_at FROM wiki_sources WHERE source_id = ?",
          String(payload.sourceId ?? ""),
        )
        .toArray()[0]?.ingested_at as number | null | undefined;
      if (last) runAt = Math.max(now + 1_000, last + INGEST_DEBOUNCE_MS);
    }
    const dup = this.sql
      .exec(
        "SELECT 1 FROM wiki_jobs WHERE state = 'pending' AND kind = ? AND payload = ?",
        kind,
        body,
      )
      .toArray().length;
    if (!dup)
      this.sql.exec(
        "INSERT INTO wiki_jobs (kind, payload, run_at, subject) VALUES (?, ?, ?, ?)",
        kind,
        body,
        runAt ?? now + 1_000,
        subject,
      );
    await this.wikiSchedule(now);
  }

  /**
   * Claim the jobs that are due: they move to "running" in the same step, so an alarm and an
   * on-demand run never take the same job. A claim older than five minutes is given up and retried.
   */
  wikiJobsDue(now: number, limit: number): JobRow[] {
    const real = Date.now();
    // A claim older than five minutes is given up and retried, up to MAX_ATTEMPTS claims in all.
    this.sql.exec(
      "UPDATE wiki_jobs SET state = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END WHERE state = 'running' AND CAST(result AS INTEGER) < ?",
      MAX_ATTEMPTS,
      real - 300_000,
    );
    this.sql.exec(
      "DELETE FROM wiki_jobs WHERE state IN ('done', 'failed') AND run_at < ?",
      real - DONE_JOB_KEEP_MS,
    );
    const refused = this.sql
      .exec(
        `UPDATE wiki_jobs SET state = 'failed', result = 'unattributed'
         WHERE kind = 'ingest' AND state = 'pending' AND (subject IS NULL OR subject = '')
         RETURNING id`,
      )
      .toArray();
    if (refused.length > 0)
      this.wikiLogAppend("system", "job.unattributed", { ids: refused.map((r) => r.id as number) }, now);
    return this.sql
      .exec(
        `UPDATE wiki_jobs SET state = 'running', result = ?, attempts = attempts + 1
         WHERE id IN (SELECT id FROM wiki_jobs WHERE state = 'pending' AND run_at <= ? ORDER BY id LIMIT ?)
         RETURNING id, kind, payload, run_at`,
        String(real),
        now,
        limit,
      )
      .toArray()
      .map((r) => ({
        id: r.id as number,
        kind: r.kind as string,
        payload: JSON.parse(r.payload as string) as Record<string, unknown>,
        runAt: r.run_at as number,
      }))
      .sort((a, b) => a.id - b.id);
  }

  wikiJobFinish(id: number, result: Record<string, unknown>): void {
    this.sql.exec(
      "UPDATE wiki_jobs SET state = 'done', result = ? WHERE id = ?",
      JSON.stringify(result).slice(0, 2_000),
      id,
    );
  }

  wikiJobsPending(): number {
    return this.sql.exec("SELECT COUNT(*) AS n FROM wiki_jobs WHERE state = 'pending'").one()
      .n as number;
  }

  wikiMarkRun(kind: "lint" | "dream", now: number): void {
    if (kind === "lint") {
      this.metaSet("last_lint_at", String(now));
      this.metaSet("next_lint_at", String(now + DAY));
    } else this.metaSet("next_dream_at", String(nextNight(now)));
  }

  /** Alarms can be switched off (tests and one-shot tools). Jobs then wait for POST /wiki/:ws/run. */
  async wikiSchedule(now: number): Promise<void> {
    if (String(this.env.WIKI_ALARMS ?? "").toLowerCase() === "off") return;
    const m = this.wikiMeta();
    if (!m) return;
    const job = this.sql
      .exec("SELECT MIN(run_at) AS t FROM wiki_jobs WHERE state = 'pending'")
      .one().t as number | null;
    const next = Math.min(job ?? Number.POSITIVE_INFINITY, m.nextLintAt, m.nextDreamAt);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(next, now + 50));
  }

  override async alarm(): Promise<void> {
    const m = this.wikiMeta();
    if (!m) return;
    const now = Date.now();
    try {
      if (now >= m.nextLintAt) {
        await this.wikiEnqueue("lint", {}, now, now);
        this.metaSet("next_lint_at", String(now + DAY));
      }
      if (now >= m.nextDreamAt) {
        await this.wikiEnqueue("dream", {}, now, now);
        this.metaSet("next_dream_at", String(nextNight(now + 3_600_000)));
      }
      await runWikiJobs(this as unknown as WikiApi, { env: this.env, now });
    } catch (e) {
      console.warn(JSON.stringify({ at: "wiki_alarm", error: String(e).slice(0, 200) }));
    }
    await this.wikiSchedule(Date.now());
  }

  // ---- pages ----

  protected pageById(id: string): PageRow | null {
    const r = this.sql.exec("SELECT * FROM wiki_pages WHERE id = ?", id).toArray()[0];
    return r ? rowPage(r) : null;
  }

  wikiIndex(includeArchived = false): Omit<PageRow, "markdown">[] {
    this.wikiSyncPromotions(Date.now());
    return this.sql
      .exec(
        `SELECT * FROM wiki_pages ${includeArchived ? "" : "WHERE status = 'published'"} ORDER BY type = 'overview' DESC, title LIMIT ${MAX_PAGES_LOADED}`,
      )
      .toArray()
      .map((r) => {
        const { markdown: _m, ...rest } = rowPage(r);
        return rest;
      });
  }

  /** Published pages with their text. At most MAX_PAGES_LOADED are read into memory in one call (M-03). */
  wikiPages(): PageRow[] {
    return this.sql
      .exec(
        "SELECT * FROM wiki_pages WHERE status = 'published' ORDER BY id LIMIT ?",
        MAX_PAGES_LOADED,
      )
      .toArray()
      .map(rowPage);
  }

  wikiPage(
    id: string,
    revision?: number,
  ): (PageRow & { current: number; hidden?: boolean }) | null {
    this.wikiSyncPromotions(Date.now());
    const p = this.pageById(id);
    if (!p) return null;
    if (revision === undefined || revision === p.revision) return { ...p, current: p.revision };
    const r = this.sql
      .exec("SELECT * FROM wiki_page_revisions WHERE page_id = ? AND revision = ?", id, revision)
      .toArray()[0];
    if (!r) return null;
    return {
      ...p,
      title: r.title as string,
      markdown: r.markdown as string,
      revision,
      current: p.revision,
      hidden: r.hidden_at != null,
    };
  }

  /**
   * Revisions of a page, newest first, at most `limit` per answer (default 20, cap 50). `before` is the
   * revision to start under; `next` is the cursor for the following answer, or null at the end.
   * Each diff is against the revision before it, read one row at a time, never the whole history.
   */
  wikiPageHistory(
    id: string,
    o: { limit?: number; before?: number } = {},
  ): {
    revisions: {
      revision: number;
      title: string;
      actor: string | null;
      at: number;
      proposalId: string | null;
      hidden: boolean;
      /** The revision this one was diffed against is hidden: its removed lines are hidden text. */
      prevHidden: boolean;
      diff: ReturnType<typeof lineDiff>;
    }[];
    next: number | null;
  } {
    const limit = Math.min(Math.max(Math.trunc(o.limit ?? HISTORY_DEFAULT), 1), HISTORY_MAX);
    const rows = this.sql
      .exec(
        "SELECT * FROM wiki_page_revisions WHERE page_id = ? AND revision < ? ORDER BY revision DESC LIMIT ?",
        id,
        o.before ?? Number.MAX_SAFE_INTEGER,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    const out = page.map((r, i) => {
      const prev = (rows[i + 1] as Record<string, SqlStorageValue> | undefined) ?? null;
      return {
        revision: r.revision as number,
        title: r.title as string,
        actor: (r.actor as string | null) ?? null,
        at: r.at as number,
        proposalId: (r.proposal_id as string | null) ?? null,
        hidden: r.hidden_at != null,
        prevHidden: prev ? prev.hidden_at != null : false,
        diff: lineDiff(prev ? (prev.markdown as string) : null, r.markdown as string),
      };
    });
    return {
      revisions: out,
      next: rows.length > limit ? (page[page.length - 1]?.revision as number) : null,
    };
  }

  wikiSearch(match: string, limit: number): { id: string; rank: number }[] {
    this.wikiSyncPromotions(Date.now());
    return this.sql
      .exec(
        `SELECT f.id AS id, bm25(wiki_fts, 4.0, 2.0, 1.0) AS rank FROM wiki_fts f
         JOIN wiki_pages p ON p.id = f.id AND p.status = 'published'
         WHERE wiki_fts MATCH ? ORDER BY rank, f.id LIMIT ?`,
        match,
        limit,
      )
      .toArray()
      .map((r) => ({ id: r.id as string, rank: r.rank as number }));
  }

  protected savePage(
    p: { id: string; type: string; title: string; markdown: string },
    actor: string | null,
    proposalId: string | null,
    now: number,
    origin: PageOrigin = "human",
  ): { ok: true; wrote: boolean } | Fail {
    const cur = this.pageById(p.id);
    const from = cur ? decodePageStatus(cur.status) : { tag: "absent" as const };
    const step = commitPage(from, { type: "save", now });
    if (!step.ok) return pageFail(step.reason);
    const effect = step.effects[0];
    if (!effect) return { ok: true, wrote: false };
    const md = capLines(p.markdown.slice(0, MAX_PAGE_CHARS));
    if (effect.type === "update" && cur && cur.markdown === md && cur.title === p.title)
      return { ok: true, wrote: false };
    const summary = summaryOf(md);
    const revision = effect.type === "insert" ? 1 : (cur?.revision ?? 0) + 1;
    const wrote =
      effect.type === "insert"
        ? this.sql
            .exec(
              "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'published', ?, ?, ?) RETURNING id",
              p.id,
              p.type,
              p.title,
              md,
              summary,
              origin,
              now,
              now,
            )
            .toArray()
        : this.sql
            .exec(
              "UPDATE wiki_pages SET type = ?, title = ?, markdown = ?, summary = ?, revision = ?, status = 'published', origin = ?, updated_at = ? WHERE id = ? AND status = 'published' RETURNING id",
              p.type,
              p.title,
              md,
              summary,
              revision,
              origin,
              now,
              p.id,
            )
            .toArray();
    if (claimPage(wrote.length).tag !== "applied") return pageFail("replay");
    this.sql.exec(
      "INSERT OR REPLACE INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at, proposal_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      p.id,
      revision,
      p.title,
      md,
      actor,
      now,
      proposalId,
    );
    this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", p.id);
    this.sql.exec(
      "INSERT INTO wiki_fts (title, summary, body, id) VALUES (?, ?, ?, ?)",
      p.title,
      summary,
      md.replace(/\{src:[^}]*\}/g, ""),
      p.id,
    );
    return { ok: true, wrote: true };
  }

  /** Publish an archived page. A save does not do this. */
  protected unarchivePage(id: string, now: number): { ok: true; wrote: boolean } | Fail {
    const cur = this.pageById(id);
    const from = cur ? decodePageStatus(cur.status) : { tag: "absent" as const };
    const step = commitPage(from, { type: "unarchive", now });
    if (!step.ok) return pageFail(step.reason);
    if (!cur || !step.effects.some((effect) => effect.type === "unarchive"))
      return { ok: true, wrote: false };
    const wrote = this.sql
      .exec(
        "UPDATE wiki_pages SET status = 'published', updated_at = ? WHERE id = ? AND status = 'archived' RETURNING id",
        now,
        id,
      )
      .toArray();
    if (claimPage(wrote.length).tag !== "applied") return pageFail("replay");
    this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", id);
    this.sql.exec(
      "INSERT INTO wiki_fts (title, summary, body, id) VALUES (?, ?, ?, ?)",
      cur.title,
      cur.summary,
      cur.markdown.replace(/\{src:[^}]*\}/g, ""),
      id,
    );
    return { ok: true, wrote: true };
  }

  // ---- facts ----

  wikiFacts(o: { validOnly?: boolean; subject?: string; limit?: number } = {}): Fact[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (o.validOnly) where.push("invalid_at IS NULL");
    if (o.subject) {
      where.push("subject = ?");
      args.push(o.subject);
    }
    return this.sql
      .exec(
        `SELECT * FROM wiki_facts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY subject, predicate, valid_at, id LIMIT ?`,
        ...args,
        o.limit ?? 500,
      )
      .toArray()
      .map(rowFact);
  }

  /** Confirm a fact. Not by the person who wrote a source it rests on (L-03). */
  wikiVerifyFact(id: number, actor: string, now: number): Fail | { ok: true } {
    const f = this.sql.exec("SELECT source_ids FROM wiki_facts WHERE id = ?", id).toArray()[0];
    if (!f) return { ok: false, code: "not_found", message: "No such fact" };
    const personal = isPersonalScope(this.metaGet("scope_id") ?? "");
    if (!personal && this.wroteSourceOf(JSON.parse(f.source_ids as string) as string[], [actor]))
      return {
        ok: false,
        code: "self_approval",
        message: "You wrote a source of this fact, so a different person must verify it",
      };
    this.sql.exec(
      "UPDATE wiki_facts SET verified_by = ?, checked_at = ? WHERE id = ?",
      actor,
      new Date(now).toISOString(),
      id,
    );
    this.wikiLogAppend(actor, "fact.verified", { factId: id }, now);
    return { ok: true };
  }

  // ---- proposals ----

  private validFactsSql(): Fact[] {
    return this.sql
      .exec("SELECT * FROM wiki_facts WHERE invalid_at IS NULL")
      .toArray()
      .map(rowFact);
  }

  /** The generated pages as they would read after these changes. */
  private previewGenerated(
    newFacts: NewFact[],
    invalidate: Set<number>,
    draftIds: string[] = [],
  ): PageDraft[] {
    const valid: Pick<Fact, "subject" | "predicate" | "object" | "sourceIds">[] = [
      ...this.validFactsSql().filter((f) => !invalidate.has(f.id)),
      ...newFacts.filter((f) => !f.invalidAt),
    ];
    const out: PageDraft[] = [];
    const published = new Set(this.wikiPages().map((p) => p.id));
    const made: string[] = [];
    for (const type of GENERATED_ORDER) {
      const g = GENERATED[type];
      if (!g) continue;
      const cur = this.pageById(g.id);
      const md = renderGenerated(type, valid, []) ?? (cur ? emptyGenerated(type) : null);
      if (md === null) continue;
      made.push(g.id);
      if (cur?.markdown !== md)
        out.push({
          pageId: g.id,
          type,
          title: g.title,
          baseRevision: cur?.revision ?? null,
          markdown: md,
        });
    }
    const others = [...new Set([...published, ...made, ...draftIds])]
      .filter((id) => id !== "overview")
      .sort();
    const ov = GENERATED.overview;
    if (ov) {
      const cur = this.pageById("overview");
      const md = renderGenerated("overview", valid, others);
      if (md !== null && cur?.markdown !== md)
        out.push({
          pageId: "overview",
          type: "overview",
          title: ov.title,
          baseRevision: cur?.revision ?? null,
          markdown: md,
        });
    }
    return out;
  }

  /** Page text as stored: no NULs, links leave the workspace only toward Company Global, citations name known sources. */
  private cleanMarkdown(md: string, known: Set<string>): string {
    return capLines(
      md
        .replaceAll("\u0000", "")
        .replace(/\[\[([A-Za-z0-9:_-]{1,70})\]\]/g, (m, x: string) =>
          x.includes(":") && !x.startsWith("global:") ? "" : m,
        )
        .replace(/\{src:([^}]*)\}/g, (m, x: string) => (known.has(x) ? m : ""))
        .slice(0, MAX_PAGE_CHARS),
    );
  }

  private cleanDraft(d: PageDraft, known: Set<string>): PageDraft | null {
    const schema = this.wikiSchema();
    if (!PAGE_ID.test(d.pageId) || !schema.types[d.type] || GENERATED[d.type]) return null;
    const markdown = this.cleanMarkdown(d.markdown, known);
    if (!markdown.trim()) return null;
    return { ...d, title: d.title.replace(/\s+/g, " ").trim().slice(0, 120) || d.pageId, markdown };
  }

  /** The sources a viewer must be able to read before the proposal's own text is shown to them (H-02). */
  private titleSourcesOf(input: Omit<Proposal, "v" | "pages"> & { pages: PageDraft[] }): string[] {
    const ids = new Set<string>(input.titleSources ?? []);
    for (const s of input.sources) ids.add(s.id);
    for (const f of input.facts) for (const i of f.sourceIds) ids.add(i);
    for (const i of input.reingest) ids.add(i);
    for (const fid of [...input.invalidate.map((x) => x.factId), ...input.confirm]) {
      const r = this.sql.exec("SELECT source_ids FROM wiki_facts WHERE id = ?", fid).toArray()[0];
      if (r) for (const i of JSON.parse(r.source_ids as string) as string[]) ids.add(i);
    }
    // A check or a merge names pages: a page title is a claim of the sources the page cites.
    if (input.kind !== "wiki_ingest") {
      const pageIds = [
        ...(input.subjectPages ?? []),
        ...input.pages.map((p) => p.pageId),
        ...input.archive,
      ];
      for (const id of pageIds) {
        const cur = this.pageById(id);
        if (cur && !GENERATED[cur.type]) for (const i of citationsOf(cur.markdown)) ids.add(i);
      }
    }
    return [...ids].slice(0, 200);
  }

  async wikiPropose(
    input: Omit<Proposal, "v" | "pages"> & { pages: PageDraft[] },
    authorId: string,
    now: number,
    opts: ProposeOpts,
  ): Promise<ProposeResult> {
    const m = this.wikiMeta();
    if (!m) return { ok: false, code: "not_found", message: "No wiki here yet" };
    if (!isWikiKind(input.kind))
      return { ok: false, code: "not_found", message: "Unknown proposal kind" };
    if (
      input.findingKey &&
      this.sql.exec("SELECT 1 FROM wiki_findings WHERE key = ?", input.findingKey).toArray().length
    )
      return { ok: true, created: false, reason: "known finding" };

    const known = new Set<string>(input.sources.map((s) => s.id));
    for (const f of input.facts) for (const id of f.sourceIds) known.add(id);
    const mayCite = opts.readable ? new Set(opts.readable) : null;
    for (const r of this.wikiSourceRefs([
      ...new Set(input.pages.flatMap((p) => citationsOf(p.markdown))),
    ]))
      if (!mayCite || mayCite.has(r.id)) known.add(r.id);

    const authored = input.pages.flatMap((d) => {
      const c = this.cleanDraft(d, known);
      return c ? [c] : [];
    });
    const supersede = new Set(input.invalidate.map((i) => i.factId));
    const generated =
      input.kind === "wiki_ingest" || input.invalidate.length || input.confirm.length
        ? this.previewGenerated(
            input.facts,
            supersede,
            authored.map((d) => d.pageId),
          )
        : [];
    const pages = [...authored, ...generated];
    // A finding with nothing to change is still worth a review item: approving acknowledges it.
    const empty =
      !input.findingKey &&
      !input.facts.length &&
      !input.invalidate.length &&
      !input.confirm.length &&
      !pages.length &&
      !input.archive.length &&
      !input.reingest.length;
    if (empty) return { ok: true, created: false, reason: "no new information" };

    const titleSources = this.titleSourcesOf({ ...input, pages });
    const p: Proposal = {
      ...input,
      v: 1,
      pages,
      title: input.title.slice(0, 200),
      titleSources,
    };
    const id = `cand:${nodeOfScope(m.scopeId)}:${hex8()}`;
    const made = this.create(
      {
        id,
        label: p.title,
        kind: p.kind,
        plane: opts.plane,
        origin: "candidate",
        status: "candidate",
        authorId,
        body: JSON.stringify(p),
        targetNode: nodeOfScope(m.scopeId),
        tags: ["wiki"],
      },
      now,
    );
    if ("ok" in made) return made;
    if (p.findingKey)
      this.sql.exec(
        "INSERT OR IGNORE INTO wiki_findings (key, kind, status, proposal_id, at) VALUES (?, ?, 'open', ?, ?)",
        p.findingKey,
        p.kind,
        id,
        now,
      );
    // The log keeps ids; the title is resolved for each viewer (it can carry a source's title).
    this.wikiLogAppend(
      authorId,
      `${p.kind}.proposed`,
      { id, sourceIds: titleSources.slice(0, 50) },
      now,
    );
    // Dev seed: synthetic data accepted at once and marked as such. Never outside the dev environment.
    if (opts.seed && p.origin === "seed" && this.env.ENVIRONMENT === "dev") {
      try {
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("UPDATE items SET status = 'approved', updated_at = ? WHERE id = ?", now, id);
          const applied = this.applyProposal(p, authorId, SEED_VERIFIER, now, id);
          if (!("pages" in applied)) throw new PageRefusal(applied);
          this.wikiLogAppend(authorId, "seed.accepted", { id }, now);
        });
      } catch (e) {
        if (e instanceof PageRefusal) return e.fail;
        throw e;
      }
      return { ok: true, created: true, id, autoAccepted: true };
    }
    const publishing = p.kind === "wiki_ingest" && opts.publishDirect === true;
    const staying =
      p.kind === "wiki_ingest" &&
      opts.autoAccept === true &&
      m.autoAccept &&
      isPersonalScope(m.scopeId) &&
      !publishing;
    if (publishing || staying) {
      const step = commitImport(decodeImportStatus(made.status), {
        type: publishing ? "publish" : "auto_accept",
      });
      if (!step.ok) return importFail(step.reason);
      if (!step.effects.some((effect) => effect.type === "publish"))
        return { ok: true, created: true, id, autoAccepted: false };
      try {
        this.ctx.storage.transactionSync(() => {
          const wrote = this.sql
            .exec(
              "UPDATE items SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'candidate' RETURNING id",
              now,
              id,
            )
            .toArray();
          if (claimImport(wrote.length).tag !== "applied") throw new PageRefusal(importFail("replay"));
          const applied = this.applyProposal(p, authorId, null, now, id);
          if (!("pages" in applied)) throw new PageRefusal(applied);
          this.wikiLogAppend(authorId, "auto_accepted", { id }, now);
        });
      } catch (e) {
        if (e instanceof PageRefusal) return e.fail;
        throw e;
      }
      return { ok: true, created: true, id, autoAccepted: true };
    }
    return { ok: true, created: true, id, autoAccepted: false };
  }

  /** A newer read of the same source replaces older proposals still waiting for it. */
  wikiSupersede(sourceId: string, now: number): number {
    let n = 0;
    for (const r of this.sql
      .exec("SELECT id FROM items WHERE kind = 'wiki_ingest' AND status = 'candidate'")
      .toArray()) {
      const it = this.get(r.id as string);
      const p = it ? this.parse(it) : null;
      if (!it || !p?.sources.some((s) => s.id === sourceId)) continue;
      this.sql.exec(
        "UPDATE items SET status = 'rejected', updated_at = ? WHERE id = ?",
        now,
        it.id,
      );
      this.wikiLogAppend("system", "wiki_ingest.superseded", { id: it.id, sourceId }, now);
      n++;
    }
    return n;
  }

  private parse(item: ItemRecord): Proposal | null {
    if (!isWikiKind(item.kind)) return null;
    try {
      return JSON.parse(item.body ?? "") as Proposal;
    } catch {
      return null;
    }
  }

  /** Apply a proposal. One transaction at the caller. `verifier` is null for auto-accepted facts. */
  private applyProposal(
    p: Proposal,
    actor: string,
    verifier: string | null,
    now: number,
    proposalId: string,
  ): ApplyResult | Fail {
    const at = new Date(now).toISOString();
    const touched: string[] = [];
    let invalidated = 0;
    let archived = 0;
    const kept = (saved: { ok: true; wrote: boolean } | Fail, pageId: string): Fail | null => {
      if (!saved.ok) return saved;
      if (saved.wrote) touched.push(pageId);
      return null;
    };
    const result = (): ApplyResult => ({
      pages: touched,
      facts: p.facts.length,
      invalidated,
      archived,
    });

    for (const i of p.invalidate) {
      const r = this.sql
        .exec(
          "UPDATE wiki_facts SET invalid_at = ? WHERE id = ? AND invalid_at IS NULL RETURNING id",
          i.at,
          i.factId,
        )
        .toArray();
      invalidated += r.length;
    }
    for (const f of p.facts)
      this.sql.exec(
        `INSERT INTO wiki_facts (subject, predicate, object, valid_at, invalid_at, recorded_at, checked_at,
           source_ids, source_hashes, confidence, origin, verified_by, proposal_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.subject,
        f.predicate,
        f.object,
        f.validAt,
        f.invalidAt ?? null,
        at,
        at,
        JSON.stringify(f.sourceIds),
        JSON.stringify(f.sourceHashes),
        f.confidence,
        f.origin,
        verifier,
        proposalId,
      );
    for (const id of p.confirm)
      this.sql.exec(
        "UPDATE wiki_facts SET verified_by = COALESCE(?, verified_by), checked_at = ? WHERE id = ?",
        verifier,
        at,
        id,
      );

    const edited = new Map(p.pages.filter((d) => d.edited).map((d) => [d.pageId, d]));
    const origin: PageOrigin = p.origin === "seed" ? "seed" : "human";
    for (const d of p.pages) {
      if (GENERATED[d.type]) continue;
      const refused = kept(
        this.savePage(
          { id: d.pageId, type: d.type, title: d.title, markdown: d.markdown },
          actor,
          proposalId,
          now,
          origin,
        ),
        d.pageId,
      );
      if (refused) return refused;
    }
    for (const id of p.archive) {
      const cur = this.pageById(id);
      const from = cur ? decodePageStatus(cur.status) : { tag: "absent" as const };
      const step = commitPage(from, { type: "archive", now });
      if (!step.ok) return pageFail(step.reason);
      if (!step.effects.some((effect) => effect.type === "archive")) continue;
      const r = this.sql
        .exec(
          "UPDATE wiki_pages SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'published' RETURNING id",
          now,
          id,
        )
        .toArray();
      if (claimPage(r.length).tag !== "applied") continue;
      this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", id);
      archived++;
      touched.push(id);
    }
    // Generated pages follow the facts that hold now.
    const valid = this.validFactsSql();
    for (const type of GENERATED_ORDER) {
      const g = GENERATED[type];
      if (!g) continue;
      const cur = this.pageById(g.id);
      const md =
        edited.get(g.id)?.markdown ??
        renderGenerated(type, valid, []) ??
        (cur ? emptyGenerated(type) : null);
      if (md !== null) {
        const refused = kept(
          this.savePage({ id: g.id, type, title: g.title, markdown: md }, actor, proposalId, now, origin),
          g.id,
        );
        if (refused) return refused;
      }
    }
    const others = this.wikiPages()
      .map((x) => x.id)
      .filter((x) => x !== "overview");
    const ov = renderGenerated("overview", valid, others);
    if (ov !== null) {
      const refused = kept(
        this.savePage(
          {
            id: "overview",
            type: "overview",
            title: "Overview",
            markdown: edited.get("overview")?.markdown ?? ov,
          },
          actor,
          proposalId,
          now,
          origin,
        ),
        "overview",
      );
      if (refused) return refused;
    }
    for (const s of p.sources)
      this.wikiSourceSeen(s.id, s.hash, s.title, this.sourceGate(s.id), true, now);
    this.wikiLogAppend(
      actor,
      `${p.kind}.applied`,
      { id: proposalId, pages: touched, facts: p.facts.length, invalidated },
      now,
    );
    return result();
  }

  private sourceGate(id: string): string {
    const r = this.sql
      .exec("SELECT gate_node_id FROM wiki_sources WHERE source_id = ?", id)
      .toArray()[0];
    return (r?.gate_node_id as string | null) ?? nodeOfScope(this.metaGet("scope_id") ?? "");
  }

  /** Exact content of a proposal's revision. An approval names it, and an edit changes it. */
  private async proposalHash(item: ItemRecord): Promise<string> {
    return sha256Hex(`${item.id}\n${item.revision}\n${item.body ?? ""}`);
  }

  /** The contributor and anyone who edited the proposal count as its authors (H-01). */
  private wikiAuthored(item: ItemRecord, ids: string[]): boolean {
    if (item.authorId !== null && ids.includes(item.authorId)) return true;
    return (
      this.sql
        .exec(
          `SELECT 1 FROM edits WHERE item_id = ? AND actor_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
          item.id,
          ...ids,
        )
        .toArray().length > 0
    );
  }

  /** The actor wrote one of the sources the proposal is drawn from (L-03). */
  private wroteSourceOf(sourceIds: string[], ids: string[]): boolean {
    for (const sid of sourceIds.slice(0, 200)) {
      const it = this.get(sid);
      if (it && SOURCE_KINDS.has(it.kind) && it.authorId !== null && ids.includes(it.authorId))
        return true;
    }
    return false;
  }

  /** The finding named by a proposal. A missing row is unknown and writes nothing. */
  private findingOf(key: string | null): FindingStatus | null {
    if (!key) return null;
    const row = this.sql.exec("SELECT status FROM wiki_findings WHERE key = ?", key).toArray()[0];
    return decodeFindingStatus(row ? row.status : null);
  }

  /**
   * The decision on one review item. The API has already checked that the actor may decide.
   * Approving names the exact revision (`revisionHash`); a proposal edited since gives a conflict.
   * Authors and editors never decide; where the item needs two approvers (Company Global) the first
   * approval is recorded and the diff is applied by the second, different person.
   */
  async wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
    opts: { revisionHash?: string; sameHuman?: string[] } = {},
  ): Promise<DecideResult> {
    // Every principal id of the same human counts as the actor (N-01).
    const ids = [actorId, ...(opts.sameHuman ?? [])];
    const item = this.get(id);
    const m = this.wikiMeta();
    if (!item || !m || !isWikiKind(item.kind))
      return { ok: false, code: "not_found", message: "No such proposal" };
    const from = decodeProposalStatus(item.status);
    if (from.tag === "unknown") return proposalFail("state_unreadable");
    if (from.tag !== "candidate") return proposalFail("not_pending");
    const personal = isPersonalScope(m.scopeId);
    if (!personal && this.wikiAuthored(item, ids))
      return {
        ok: false,
        code: "self_approval",
        message: "You wrote or edited this proposal, so a different person must decide it",
      };
    const p = this.parse(item);
    if (!p) return { ok: false, code: "not_found", message: "The proposal is unreadable" };
    if (
      !personal &&
      this.wroteSourceOf(
        p.sources.map((x) => x.id),
        ids,
      )
    )
      return {
        ok: false,
        code: "self_approval",
        message: "You wrote a source of this proposal, so a different person must decide it",
      };
    if (decision === "reject") {
      const step = commitProposal(from, { type: "reject" }, this.findingOf(p.findingKey));
      if (!step.ok) return proposalFail(step.reason);
      try {
        this.ctx.storage.transactionSync(() => {
          const wrote = this.sql
            .exec(
              "UPDATE items SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'candidate' RETURNING id",
              now,
              id,
            )
            .toArray();
          if (claimProposal(wrote.length).tag !== "applied") throw new PageRefusal(proposalFail("replay"));
          this.sql.exec(
            "INSERT OR REPLACE INTO approvals (item_id, revision, actor_id, kind, at, verdict) VALUES (?, ?, ?, 'review', ?, 'rejected')",
            id,
            item.revision,
            actorId,
            now,
          );
          if (p.findingKey && step.effects.some((effect) => effect.type === "dismiss_finding"))
            this.sql.exec(
              "UPDATE wiki_findings SET status = 'dismissed' WHERE key = ? AND status = 'open'",
              p.findingKey,
            );
          this.wikiLogAppend(actorId, `${p.kind}.rejected`, { id }, now);
        });
      } catch (e) {
        if (e instanceof PageRefusal) return e.fail;
        throw e;
      }
      return { ok: true, status: "rejected", applied: null, approvals: 0, required: 0 };
    }
    if (!opts.revisionHash)
      return {
        ok: false,
        code: "revision_required",
        message: "Approve names the revision you read: send revisionHash",
      };
    if (opts.revisionHash !== (await this.proposalHash(item)))
      return {
        ok: false,
        code: "conflict",
        message: "The proposal changed since you read it. Reload and read it again",
        currentRevision: item.revision,
      };
    // An authored page that moved since the draft was written needs a new draft, not a blind overwrite.
    for (const d of p.pages) {
      if (GENERATED[d.type]) continue;
      const cur = this.pageById(d.pageId);
      if ((cur?.revision ?? null) !== d.baseRevision && !(cur === null && d.baseRevision === null))
        return {
          ok: false,
          code: "conflict",
          message: `Page "${d.title}" changed since this was drafted. Reject it and run the check again.`,
          ...(cur ? { currentRevision: cur.revision } : {}),
        };
    }
    const required = personal ? 1 : item.required;
    const prior = this.sql
      .exec(
        "SELECT actor_id FROM approvals WHERE item_id = ? AND revision = ? AND kind = 'approve'",
        id,
        item.revision,
      )
      .toArray()
      .map((r) => r.actor_id as string);
    if (prior.some((actor) => ids.includes(actor)))
      return { ok: false, code: "already_done", message: "You already approved this revision" };
    const step = commitProposal(
      from,
      { type: "approve", required, approvers: [...prior, actorId] },
      this.findingOf(p.findingKey),
    );
    if (!step.ok) return proposalFail(step.reason);
    const approvals = prior.length + 1;
    const releasing = step.effects.some((effect) => effect.type === "approve");
    if (!releasing) {
      try {
        this.ctx.storage.transactionSync(() => {
          const noted = this.sql
            .exec(
              `INSERT OR IGNORE INTO approvals (item_id, revision, actor_id, kind, at) VALUES (?, ?, ?, 'approve', ?)
               RETURNING actor_id`,
              id,
              item.revision,
              actorId,
              now,
            )
            .toArray();
          if (!noted.length)
            throw new PageRefusal({
              ok: false,
              code: "already_done",
              message: "You already approved this revision",
            });
          this.wikiLogAppend(actorId, `${p.kind}.approval`, { id, approvals, required }, now);
        });
      } catch (e) {
        if (e instanceof PageRefusal) return e.fail;
        throw e;
      }
      return { ok: true, status: "pending", applied: null, approvals, required };
    }
    let applied: ApplyResult | null = null;
    try {
      this.ctx.storage.transactionSync(() => {
        const mine = this.sql
          .exec(
            `INSERT OR IGNORE INTO approvals (item_id, revision, actor_id, kind, at) VALUES (?, ?, ?, 'approve', ?)
             RETURNING actor_id`,
            id,
            item.revision,
            actorId,
            now,
          )
          .toArray();
        if (!mine.length)
          throw new PageRefusal({
            ok: false,
            code: "already_done",
            message: "You already approved this revision",
          });
        const out = this.applyProposal(p, actorId, actorId, now, id);
        if (!("pages" in out)) throw new PageRefusal(out);
        const changed = this.sql
          .exec(
            "UPDATE items SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'candidate' RETURNING id",
            now,
            id,
          )
          .toArray();
        if (changed.length !== 1)
          throw new PageRefusal({
            ok: false,
            code: "replay",
            message: "The proposal was already decided",
          });
        applied = out;
        if (p.findingKey && step.effects.some((effect) => effect.type === "resolve_finding"))
          this.sql.exec(
            "UPDATE wiki_findings SET status = 'resolved' WHERE key = ? AND status = 'open'",
            p.findingKey,
          );
      });
    } catch (e) {
      if (e instanceof PageRefusal) return e.fail;
      throw e;
    }
    for (const src of p.reingest)
      await this.wikiEnqueue("ingest", { sourceId: src, force: true }, now);
    return { ok: true, status: "approved", applied, approvals, required };
  }

  /**
   * A reviewer's own wording for one page of a proposal. It is applied as written, so the editor
   * becomes an author (cannot approve), the revision moves on and earlier approvals no longer count.
   * Generated pages are rendered from facts and cannot be edited by hand. `readable` lists the sources
   * the editor may read: a citation to any other source is removed.
   */
  wikiEditProposal(
    id: string,
    actorId: string,
    pageId: string,
    markdown: string,
    now: number,
    readable: string[] = [],
  ): Fail | { ok: true; revision: number } {
    const item = this.get(id);
    if (!item || !isWikiKind(item.kind))
      return { ok: false, code: "not_found", message: "No such proposal" };
    const edited = commitProposal(decodeProposalStatus(item.status), { type: "edit" }, null);
    if (!edited.ok) return proposalFail(edited.reason);
    const p = this.parse(item);
    const d = p?.pages.find((x) => x.pageId === pageId);
    if (!p || !d) return { ok: false, code: "not_found", message: "No such page in this proposal" };
    if (GENERATED[d.type])
      return {
        ok: false,
        code: "generated_page",
        message: "This page is rendered from facts. Change the facts, not the page",
      };
    const mayCite = new Set(readable);
    const known = new Set<string>();
    for (const r of this.wikiSourceRefs(citationsOf(markdown)))
      if (mayCite.has(r.id)) known.add(r.id);
    const clean = this.cleanMarkdown(markdown, known);
    if (!clean.trim()) return { ok: false, code: "not_found", message: "The edited page is empty" };
    d.markdown = clean;
    d.edited = true;
    const revision = item.revision + 1;
    try {
      this.ctx.storage.transactionSync(() => {
        const wrote = this.sql
          .exec(
            "UPDATE items SET body = ?, revision = ?, updated_at = ? WHERE id = ? AND status = 'candidate' AND revision = ? RETURNING id",
            JSON.stringify(p),
            revision,
            now,
            id,
            item.revision,
          )
          .toArray();
        if (claimProposal(wrote.length).tag !== "applied") throw new PageRefusal(proposalFail("replay"));
        this.sql.exec(
          "INSERT INTO edits (item_id, revision, actor_id, at) VALUES (?, ?, ?, ?)",
          id,
          revision,
          actorId,
          now,
        );
        this.wikiLogAppend(actorId, "proposal.edited", { id, pageId, revision }, now);
      });
    } catch (e) {
      if (e instanceof PageRefusal) return e.fail;
      throw e;
    }
    return { ok: true, revision };
  }

  /** Proposal titles for the log, resolved per viewer by the API. */
  wikiProposalTitles(ids: string[]): { id: string; title: string; titleSources: string[] }[] {
    const out: { id: string; title: string; titleSources: string[] }[] = [];
    for (const id of ids.slice(0, 200)) {
      const it = this.get(id);
      const p = it ? this.parse(it) : null;
      if (it && p)
        out.push({ id, title: it.label, titleSources: p.titleSources ?? sourcesOfLegacy(p) });
    }
    return out;
  }

  /** Everything the reviewer needs to decide: before and after for each page, the facts and what they replace. */
  async wikiProposalView(id: string): Promise<{
    id: string;
    kind: string;
    status: string;
    title: string;
    rationale: string;
    detail: string;
    authorId: string | null;
    createdAt: number;
    revision: number;
    revisionHash: string;
    approvals: number;
    required: number;
    titleSources: string[];
    pages: {
      pageId: string;
      type: string;
      title: string;
      before: string | null;
      after: string;
      edited: boolean;
      stale: boolean;
      diff: ReturnType<typeof lineDiff>;
    }[];
    facts: NewFact[];
    invalidate: {
      factId: number;
      at: string;
      subject: string;
      predicate: string;
      object: string;
      sourceIds: string[];
    }[];
    confirm: number[];
    archive: string[];
    reingest: string[];
    sources: Proposal["sources"];
  } | null> {
    const item = this.get(id);
    const p = item ? this.parse(item) : null;
    if (!item || !p) return null;
    return {
      id,
      kind: item.kind,
      status: item.status,
      title: p.title,
      rationale: p.rationale,
      detail: p.detail ?? "",
      authorId: item.authorId,
      createdAt: item.createdAt,
      revision: item.revision,
      revisionHash: await this.proposalHash(item),
      approvals: item.approvals,
      required: item.required,
      titleSources: p.titleSources ?? sourcesOfLegacy(p),
      pages: p.pages.map((d) => {
        const cur = this.pageById(d.pageId);
        return {
          pageId: d.pageId,
          type: d.type,
          title: d.title,
          before: cur?.markdown ?? null,
          after: d.markdown,
          edited: !!d.edited,
          stale: !GENERATED[d.type] && (cur?.revision ?? null) !== d.baseRevision,
          diff: lineDiff(cur?.markdown ?? null, d.markdown),
        };
      }),
      facts: p.facts,
      invalidate: p.invalidate.map((i) => {
        const r = this.sql
          .exec(
            "SELECT subject, predicate, object, source_ids FROM wiki_facts WHERE id = ?",
            i.factId,
          )
          .toArray()[0];
        return {
          ...i,
          subject: (r?.subject as string) ?? "",
          predicate: (r?.predicate as string) ?? "",
          object: (r?.object as string) ?? "",
          sourceIds: r ? (JSON.parse(r.source_ids as string) as string[]) : [],
        };
      }),
      confirm: p.confirm,
      archive: p.archive,
      reingest: p.reingest,
      sources: p.sources,
    };
  }

  wikiProposals(status: string): {
    id: string;
    kind: string;
    title: string;
    status: string;
    authorId: string | null;
    createdAt: number;
    detail: string;
    revision: number;
    titleSources: string[];
  }[] {
    return this.sql
      .exec(
        "SELECT id FROM items WHERE kind LIKE 'wiki\\_%' ESCAPE '\\' AND status = ? ORDER BY created_at DESC, id LIMIT 100",
        status,
      )
      .toArray()
      .flatMap((r) => {
        const it = this.get(r.id as string);
        const p = it ? this.parse(it) : null;
        return it && p
          ? [
              {
                id: it.id,
                kind: it.kind,
                title: it.label,
                status: it.status,
                authorId: it.authorId,
                createdAt: it.createdAt,
                detail: p.detail ?? p.rationale,
                revision: it.revision,
                titleSources: p.titleSources ?? sourcesOfLegacy(p),
              },
            ]
          : [];
      });
  }

  /** Data for the lint pass, read in one call. */
  async wikiLintData(): Promise<{
    pages: Pick<PageRow, "id" | "type" | "title" | "markdown" | "revision">[];
    facts: Fact[];
    hashes: Record<string, string>;
    schema: WikiSchema;
    freshnessDays: number;
  }> {
    const facts = this.wikiFacts({ limit: 2_000 });
    const ids = [...new Set(facts.filter((f) => f.invalidAt === null).flatMap((f) => f.sourceIds))];
    return {
      pages: this.wikiPages()
        .filter((p) => p.type !== "journal")
        .map(({ id, type, title, markdown, revision }) => ({
          id,
          type,
          title,
          markdown,
          revision,
        })),
      facts,
      hashes: await this.wikiSourceHashes(ids),
      schema: this.wikiSchema(),
      freshnessDays: this.wikiMeta()?.freshnessDays ?? 180,
    };
  }

  wikiHealth(now: number): Health | null {
    const m = this.wikiMeta();
    if (!m) return null;
    const one = (q: string, ...a: (string | number)[]) => this.sql.exec(q, ...a).one().n as number;
    const pages = one("SELECT COUNT(*) AS n FROM wiki_pages WHERE status = 'published'");
    const facts = one("SELECT COUNT(*) AS n FROM wiki_facts WHERE invalid_at IS NULL");
    const unverified = one(
      "SELECT COUNT(*) AS n FROM wiki_facts WHERE invalid_at IS NULL AND verified_by IS NULL",
    );
    const openFindings = one(
      "SELECT COUNT(*) AS n FROM wiki_findings WHERE status = 'open' AND kind = 'wiki_lint'",
    );
    const openProposals = one(
      "SELECT COUNT(*) AS n FROM items WHERE kind LIKE 'wiki\\_%' ESCAPE '\\' AND status = 'candidate'",
    );
    const cutoff = new Date(now - m.freshnessDays * DAY).toISOString();
    const stale = one(
      "SELECT COUNT(*) AS n FROM wiki_facts WHERE invalid_at IS NULL AND MAX(recorded_at, checked_at) < ?",
      cutoff,
    );
    const penalty =
      Math.min(60, openFindings * 8) + Math.min(25, stale * 5) + Math.min(15, unverified);
    return {
      pages,
      facts,
      unverified,
      openFindings,
      openProposals,
      stale,
      lastLintAt: m.lastLintAt,
      score: Math.max(0, 100 - penalty),
    };
  }

  // ---- promotion to Company Global ----

  wikiRegisterPromotion(candidateId: string, title: string, now: number): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO wiki_promotions (candidate_id, title, at) VALUES (?, ?, ?)",
      candidateId,
      title,
      now,
    );
    this.wikiLogAppend("system", "promotion.requested", { candidateId }, now);
  }

  /** A released promotion candidate becomes a published Company Global page, cited to its own record. */
  private wikiSyncPromotions(now: number): void {
    const rows = this.sql.exec("SELECT * FROM wiki_promotions WHERE page_id IS NULL").toArray();
    for (const r of rows) {
      const cid = r.candidate_id as string;
      const it = this.get(cid);
      if (it?.status !== "approved") continue;
      const base = slug(it.label) || "page";
      let id = base;
      for (let n = 2; this.pageById(id); n++) id = `${base}-${n}`;
      const body = (it.body ?? "")
        .split("\n")
        .map((l) => (/^\s*[-*]\s+\S/.test(l) ? `${l} {src:${cid}}` : l))
        .join("\n");
      const md = /^#\s/m.test(body) ? body : `# ${it.label}\n\n${body}`;
      try {
        this.ctx.storage.transactionSync(() => {
          // The revision names the service, not the promoter: a Global reader must not learn the account team (L-06).
          const saved = this.savePage(
            { id, type: "topic", title: it.label, markdown: md },
            serviceId("global"),
            cid,
            now,
          );
          if (!saved.ok || !saved.wrote) throw new PageRefusal(saved.ok ? pageFail("replay") : saved);
          this.sql.exec("UPDATE wiki_promotions SET page_id = ? WHERE candidate_id = ?", id, cid);
          this.wikiLogAppend("system", "promotion.published", { pageId: id }, now);
        });
      } catch (e) {
        if (e instanceof PageRefusal) continue;
        throw e;
      }
    }
  }

  // ---- operations ----

  wikiReset(): void {
    for (const t of WIKI_TABLES) this.sql.exec(`DELETE FROM ${t}`);
  }

  /**
   * Right to erasure: a person's id becomes a pseudonym in every actor column, and the id and any
   * alias (address, name) typed into facts, pages, revisions, the search index, the log, source
   * titles and the text of records and proposals is replaced too (M-02).
   */
  wikiPseudonymise(from: string, to: string, aliases: string[] = []): number {
    let n = 0;
    for (const [t, c] of [
      ["wiki_facts", "verified_by"],
      ["wiki_log", "actor"],
      ["wiki_page_revisions", "actor"],
    ] as const)
      n += this.sql
        .exec(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ? RETURNING 1`, to, from)
        .toArray().length;
    const names = [
      ...new Set([from, ...aliases].map((x) => x.trim()).filter((x) => x.length >= 3)),
    ];
    const touched = new Set<string>();
    for (const a of names) {
      const hit = (t: string, cols: string[], extra = "") => {
        const set = cols.map((c) => `${c} = replace(${c}, ?, ?)`).join(", ");
        const any = cols.map((c) => `instr(${c}, ?) > 0`).join(" OR ");
        const args: string[] = [...cols.flatMap(() => [a, to]), ...cols.map(() => a)];
        return this.sql
          .exec(`UPDATE ${t} SET ${set} WHERE (${any})${extra} RETURNING 1`, ...args)
          .toArray().length;
      };
      for (const r of this.sql
        .exec("SELECT id FROM wiki_pages WHERE instr(markdown, ?) > 0 OR instr(title, ?) > 0", a, a)
        .toArray())
        touched.add(r.id as string);
      n += hit("wiki_facts", ["subject", "object"]);
      n += hit("wiki_pages", ["title", "markdown", "summary"]);
      n += hit("wiki_page_revisions", ["title", "markdown"]);
      n += hit("wiki_log", ["detail"]);
      n += hit("wiki_sources", ["title"]);
      n += hit("wiki_promotions", ["title"]);
      n += hit(
        "items",
        ["label", "body"],
        " AND (kind IN ('meeting_record', 'record') OR kind LIKE 'wiki\\_%' ESCAPE '\\')",
      );
    }
    for (const id of touched) this.reindexPage(id);
    return n;
  }

  /** Rebuild the search row of one page from what is stored now. */
  private reindexPage(id: string): void {
    this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", id);
    const p = this.pageById(id);
    if (p?.status === "published")
      this.sql.exec(
        "INSERT INTO wiki_fts (title, summary, body, id) VALUES (?, ?, ?, ?)",
        p.title,
        summaryOf(p.markdown),
        p.markdown.replace(/\{src:[^}]*\}/g, ""),
        id,
      );
  }

  /**
   * Retention and erasure follow derived knowledge (M-02). A source is gone (deleted at the customer's
   * request, retention purge, a removed note): the facts that rest on it are deleted, the page lines
   * that cite it are removed from every page and every revision, search rows are rebuilt, proposals
   * that cite it are rejected and emptied, and its title leaves the source table, the jobs and the
   * log. Runs inside the caller's transaction.
   */
  wikiForgetSources(
    ids: string[],
    now: number,
  ): { facts: number; pages: number; proposals: number } {
    const gone = new Set(ids);
    const out = { facts: 0, pages: 0, proposals: 0 };
    if (!gone.size) return out;
    const hit = (cites: string[]) => cites.some((x) => gone.has(x));
    for (const r of this.sql
      .exec("SELECT id, source_ids, source_hashes FROM wiki_facts")
      .toArray()) {
      const sids = JSON.parse(r.source_ids as string) as string[];
      if (!hit(sids)) continue;
      const rest = sids.filter((x) => !gone.has(x));
      if (!rest.length) {
        this.sql.exec("DELETE FROM wiki_facts WHERE id = ?", r.id as number);
        out.facts++;
      } else {
        const hashes = JSON.parse(r.source_hashes as string) as Record<string, string>;
        for (const x of gone) delete hashes[x];
        this.sql.exec(
          "UPDATE wiki_facts SET source_ids = ?, source_hashes = ? WHERE id = ?",
          JSON.stringify(rest),
          JSON.stringify(hashes),
          r.id as number,
        );
      }
    }
    // A line that cites a gone source is dropped from the page and from every revision.
    const redact = (md: string): string =>
      md
        .split("\n")
        .filter((l) => !hit(citationsOf(l)))
        .join("\n");
    const hasContent = (md: string): boolean =>
      md.split("\n").some((l) => l.trim() !== "" && !l.startsWith("#"));
    for (const r of this.sql.exec("SELECT id, markdown FROM wiki_pages").toArray()) {
      const md = r.markdown as string;
      if (!hit(citationsOf(md))) continue;
      const next = redact(md);
      out.pages++;
      if (!hasContent(next)) {
        this.sql.exec("DELETE FROM wiki_pages WHERE id = ?", r.id as string);
        this.sql.exec("DELETE FROM wiki_page_revisions WHERE page_id = ?", r.id as string);
        this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", r.id as string);
      } else {
        this.sql.exec(
          "UPDATE wiki_pages SET markdown = ?, summary = ? WHERE id = ?",
          next,
          summaryOf(next),
          r.id as string,
        );
        this.reindexPage(r.id as string);
      }
    }
    for (const r of this.sql
      .exec("SELECT page_id, revision, markdown FROM wiki_page_revisions")
      .toArray()) {
      const md = r.markdown as string;
      if (hit(citationsOf(md)))
        this.sql.exec(
          "UPDATE wiki_page_revisions SET markdown = ? WHERE page_id = ? AND revision = ?",
          redact(md),
          r.page_id as string,
          r.revision as number,
        );
    }
    const scrubbed: string[] = [];
    // Status is read before any proposal write, so a later change misses the compare-and-set.
    // The citation decision is in code. This statement only writes the row that decision named.
    const proposals = this.sql
      .exec("SELECT id, status, body FROM items WHERE kind LIKE 'wiki\\_%' ESCAPE '\\' ORDER BY id")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        status: r.status as string,
        body: typeof r.body === "string" ? r.body : "",
      }));
    for (const row of proposals) {
      const cited = citedSourceIds(row.body);
      for (const sourceId of gone) {
        const quoted = cited.malformed && row.body.includes(`"${sourceId}"`);
        if (!cited.ids.has(sourceId) && !quoted) continue;
        const changed = this.sql
          .exec(
            `UPDATE items SET
               label = 'Erased source',
               body = json_object(
                 'v', 1,
                 'kind', CASE WHEN json_valid(body) THEN json_extract(body, '$.kind') END,
                 'title', 'Erased source',
                 'rationale', '',
                 'origin', CASE WHEN json_valid(body) THEN json_extract(body, '$.origin') END,
                 'pages', json('[]'),
                 'facts', json('[]'),
                 'invalidate', json('[]'),
                 'confirm', json('[]'),
                 'archive', json('[]'),
                 'reingest', json('[]'),
                 'sources', json('[]'),
                 'findingKey', CASE WHEN json_valid(body) THEN json_extract(body, '$.findingKey') END,
                 'titleSources', json('[]')
               ),
               status = CASE WHEN status IN ('approved', 'rejected') THEN status ELSE 'rejected' END,
               updated_at = ?
             WHERE id = ? AND status = ?
             RETURNING id`,
            now,
            row.id,
            row.status,
          )
          .toArray();
        if (changed.length !== 1) continue;
        this.sql.exec("DELETE FROM items_fts WHERE id = ?", row.id);
        scrubbed.push(row.id);
        out.proposals++;
        break;
      }
    }
    for (const x of gone) {
      this.sql.exec("DELETE FROM wiki_sources WHERE source_id = ?", x);
      for (const job of this.sql
        .exec("SELECT id, state FROM wiki_jobs WHERE subject = ?", x)
        .toArray()) {
        const effect = forgetWikiJob(decodeWikiJobStatus(job.state));
        if (effect.tag === "delete")
          this.sql.exec(
            "DELETE FROM wiki_jobs WHERE id = ? AND state = ? AND subject = ?",
            job.id as number,
            job.state as string,
            x,
          );
        else if (effect.tag === "cancel")
          this.sql.exec(
            "UPDATE wiki_jobs SET state = 'cancelled' WHERE id = ? AND state = 'running' AND subject = ?",
            job.id as number,
            x,
          );
      }
    }
    for (const x of scrubbed)
      this.sql.exec(
        "UPDATE wiki_log SET detail = json_remove(detail, '$.title') WHERE json_valid(detail) AND json_extract(detail, '$.id') = ?",
        x,
      );
    if (out.facts || out.pages || out.proposals)
      this.wikiLogAppend("system", "sources.forgotten", { ...out, sources: gone.size }, now);
    return out;
  }

  /** What a person did in this wiki, for the subject export. */
  wikiAuthoredBy(principalId: string): {
    revisions: { pageId: string; revision: number; title: string; at: number }[];
    factsVerified: number[];
    log: { at: number; kind: string }[];
  } {
    return {
      revisions: this.sql
        .exec(
          "SELECT page_id, revision, title, at FROM wiki_page_revisions WHERE actor = ? ORDER BY at",
          principalId,
        )
        .toArray()
        .map((r) => ({
          pageId: r.page_id as string,
          revision: r.revision as number,
          title: r.title as string,
          at: r.at as number,
        })),
      factsVerified: this.sql
        .exec("SELECT id FROM wiki_facts WHERE verified_by = ? ORDER BY id", principalId)
        .toArray()
        .map((r) => r.id as number),
      log: this.sql
        .exec("SELECT at, kind FROM wiki_log WHERE actor = ? ORDER BY id", principalId)
        .toArray()
        .map((r) => ({ at: r.at as number, kind: r.kind as string })),
    };
  }

  /** For the mismatch check in tests: the tables that hold published knowledge. */
  /** What the wiki holds, as JSON text, to compare before and after something that must not write. */
  wikiDigest(): string {
    return JSON.stringify({
      pages: this.sql.exec("SELECT id, revision, markdown FROM wiki_pages ORDER BY id").toArray(),
      facts: this.sql
        .exec(
          "SELECT id, subject, predicate, object, invalid_at, verified_by FROM wiki_facts ORDER BY id",
        )
        .toArray(),
      revisions: this.sql.exec("SELECT COUNT(*) AS n FROM wiki_page_revisions").one().n as number,
    });
  }

  /** Claims in a page that no source supports, for the page header. */
  static uncited(md: string): number {
    return claimLines(md).filter((c) => citationsOf(c.text).length === 0).length;
  }
}
