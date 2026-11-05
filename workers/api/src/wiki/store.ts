// The wiki of one workspace, stored in that workspace's Durable Object (WikiBase is the parent class
// of Workspace). Pages, facts with validity, an append-only log, the schema, source hashes, jobs and
// lint findings live in wiki_* tables beside the items they cite. Review items are ordinary
// workspace items (kinds wiki_ingest, wiki_lint, wiki_dream), so they ride the existing review queue.
// Nothing here knows who the caller is: the API checks policy first and passes the actor.

import { DurableObject } from "cloudflare:workers";
import type { Fail, ItemRecord, NewItem } from "../workspace.ts";
import { runWikiJobs, type WikiApi } from "./engine.ts";
import {
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
  type PageRow,
  type Proposal,
  type SourceInfo,
  type WikiSchema,
} from "./types.ts";

const DAY = 86_400_000;
const GENERATED_ORDER = ["decision_log", "commitments", "risk_register"] as const;
/** Item kinds that count as raw sources. Review items and counters never do. */
const SOURCE_KINDS = new Set(["record", "meeting_record", "personalitem", "candidate"]);
const MAX_PAGE_CHARS = 20_000;

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
] as const;

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
export type ProposeOpts = { plane: string; autoAccept?: boolean };
export type ProposeResult =
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; id: string; autoAccepted: boolean }
  | Fail;
export type ApplyResult = { pages: string[]; facts: number; invalidated: number; archived: number };
export type DecideResult =
  | { ok: true; status: "approved" | "rejected"; applied: ApplyResult | null }
  | Fail;

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
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

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
    });
  }

  // ---- meta ----

  private metaGet(key: string): string | null {
    const r = this.sql.exec("SELECT value FROM wiki_meta WHERE key = ?", key).toArray()[0];
    return r ? (r.value as string) : null;
  }
  private metaSet(key: string, value: string): void {
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
        gateNodeId: nodeOfScope(scope),
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
    const out: { id: string; kind: "item" | "source"; title: string; gateNodeId: string }[] = [];
    for (const id of ids.slice(0, 200)) {
      const it = this.get(id);
      if (it && SOURCE_KINDS.has(it.kind))
        out.push({ id, kind: "item", title: it.label, gateNodeId: nodeOfScope(scope) });
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
    const dup = this.sql
      .exec(
        "SELECT 1 FROM wiki_jobs WHERE state = 'pending' AND kind = ? AND payload = ?",
        kind,
        body,
      )
      .toArray().length;
    if (!dup)
      this.sql.exec(
        "INSERT INTO wiki_jobs (kind, payload, run_at) VALUES (?, ?, ?)",
        kind,
        body,
        runAt ?? now + 1_000,
      );
    await this.wikiSchedule(now);
  }

  /**
   * Claim the jobs that are due: they move to "running" in the same step, so an alarm and an
   * on-demand run never take the same job. A claim older than five minutes is given up and retried.
   */
  wikiJobsDue(now: number, limit: number): JobRow[] {
    const real = Date.now();
    this.sql.exec(
      "UPDATE wiki_jobs SET state = 'pending' WHERE state = 'running' AND CAST(result AS INTEGER) < ?",
      real - 300_000,
    );
    return this.sql
      .exec(
        `UPDATE wiki_jobs SET state = 'running', result = ?
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

  private pageById(id: string): PageRow | null {
    const r = this.sql.exec("SELECT * FROM wiki_pages WHERE id = ?", id).toArray()[0];
    return r ? rowPage(r) : null;
  }

  wikiIndex(includeArchived = false): Omit<PageRow, "markdown">[] {
    this.wikiSyncPromotions(Date.now());
    return this.sql
      .exec(
        `SELECT * FROM wiki_pages ${includeArchived ? "" : "WHERE status = 'published'"} ORDER BY type = 'overview' DESC, title`,
      )
      .toArray()
      .map((r) => {
        const { markdown: _m, ...rest } = rowPage(r);
        return rest;
      });
  }

  wikiPages(): PageRow[] {
    return this.sql
      .exec("SELECT * FROM wiki_pages WHERE status = 'published' ORDER BY id")
      .toArray()
      .map(rowPage);
  }

  wikiPage(id: string, revision?: number): (PageRow & { current: number }) | null {
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
    };
  }

  wikiPageHistory(id: string): {
    revision: number;
    title: string;
    actor: string | null;
    at: number;
    proposalId: string | null;
    diff: ReturnType<typeof lineDiff>;
  }[] {
    const rows = this.sql
      .exec("SELECT * FROM wiki_page_revisions WHERE page_id = ? ORDER BY revision", id)
      .toArray();
    return rows
      .map((r, i) => ({
        revision: r.revision as number,
        title: r.title as string,
        actor: (r.actor as string | null) ?? null,
        at: r.at as number,
        proposalId: (r.proposal_id as string | null) ?? null,
        diff: lineDiff(
          i === 0 ? null : ((rows[i - 1] as Record<string, SqlStorageValue>).markdown as string),
          r.markdown as string,
        ),
      }))
      .reverse();
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

  private savePage(
    p: { id: string; type: string; title: string; markdown: string },
    actor: string | null,
    proposalId: string | null,
    now: number,
  ): boolean {
    const cur = this.pageById(p.id);
    const md = p.markdown.slice(0, MAX_PAGE_CHARS);
    if (cur && cur.status === "published" && cur.markdown === md && cur.title === p.title)
      return false;
    const revision = cur ? cur.revision + 1 : 1;
    const summary = summaryOf(md);
    if (cur)
      this.sql.exec(
        "UPDATE wiki_pages SET type = ?, title = ?, markdown = ?, summary = ?, revision = ?, status = 'published', updated_at = ? WHERE id = ?",
        p.type,
        p.title,
        md,
        summary,
        revision,
        now,
        p.id,
      );
    else
      this.sql.exec(
        "INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'published', ?, ?)",
        p.id,
        p.type,
        p.title,
        md,
        summary,
        now,
        now,
      );
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
    return true;
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

  wikiVerifyFact(id: number, actor: string, now: number): boolean {
    const r = this.sql
      .exec(
        "UPDATE wiki_facts SET verified_by = ?, checked_at = ? WHERE id = ? RETURNING id",
        actor,
        new Date(now).toISOString(),
        id,
      )
      .toArray();
    if (r.length) this.wikiLogAppend(actor, "fact.verified", { factId: id }, now);
    return r.length > 0;
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

  private cleanDraft(d: PageDraft, known: Set<string>): PageDraft | null {
    const schema = this.wikiSchema();
    if (!PAGE_ID.test(d.pageId) || !schema.types[d.type] || GENERATED[d.type]) return null;
    // Links leave the workspace only toward Company Global. Citations must name sources of this wiki.
    const markdown = d.markdown
      .replaceAll("\u0000", "")
      .replace(/\[\[([A-Za-z0-9:_-]{1,70})\]\]/g, (m, x: string) =>
        x.includes(":") && !x.startsWith("global:") ? "" : m,
      )
      .replace(/\{src:([^}]*)\}/g, (m, x: string) => (known.has(x) ? m : ""))
      .slice(0, MAX_PAGE_CHARS);
    if (!markdown.trim()) return null;
    return { ...d, title: d.title.replace(/\s+/g, " ").trim().slice(0, 120) || d.pageId, markdown };
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
    for (const r of this.wikiSourceRefs([
      ...new Set(input.pages.flatMap((p) => citationsOf(p.markdown))),
    ]))
      known.add(r.id);

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

    const p: Proposal = { ...input, v: 1, pages, title: input.title.slice(0, 200) };
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
    this.wikiLogAppend(authorId, `${p.kind}.proposed`, { id, title: p.title }, now);
    if (opts.autoAccept && m.autoAccept && isPersonalScope(m.scopeId) && p.kind === "wiki_ingest") {
      this.sql.exec("UPDATE items SET status = 'approved', updated_at = ? WHERE id = ?", now, id);
      this.applyProposal(p, authorId, null, now, id);
      this.wikiLogAppend(authorId, "auto_accepted", { id }, now);
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
  ): ApplyResult {
    const at = new Date(now).toISOString();
    const touched: string[] = [];
    let invalidated = 0;
    let archived = 0;
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
    for (const d of p.pages) {
      if (GENERATED[d.type]) continue;
      if (
        this.savePage(
          { id: d.pageId, type: d.type, title: d.title, markdown: d.markdown },
          actor,
          proposalId,
          now,
        )
      )
        touched.push(d.pageId);
    }
    for (const id of p.archive) {
      const r = this.sql
        .exec(
          "UPDATE wiki_pages SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'published' RETURNING id",
          now,
          id,
        )
        .toArray();
      if (r.length) {
        this.sql.exec("DELETE FROM wiki_fts WHERE id = ?", id);
        archived++;
        touched.push(id);
      }
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
      if (
        md !== null &&
        this.savePage({ id: g.id, type, title: g.title, markdown: md }, actor, proposalId, now)
      )
        touched.push(g.id);
    }
    const others = this.wikiPages()
      .map((x) => x.id)
      .filter((x) => x !== "overview");
    const ov = renderGenerated("overview", valid, others);
    if (
      ov !== null &&
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
      )
    )
      touched.push("overview");
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

  /** The decision on one review item. The API has already checked that the actor may decide. */
  async wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
  ): Promise<DecideResult> {
    const item = this.get(id);
    const m = this.wikiMeta();
    if (!item || !m || !isWikiKind(item.kind))
      return { ok: false, code: "not_found", message: "No such proposal" };
    if (item.status !== "candidate")
      return { ok: false, code: "not_pending", message: "The proposal was already decided" };
    if (item.authorId === actorId && !isPersonalScope(m.scopeId))
      return {
        ok: false,
        code: "self_approval",
        message: "You wrote this proposal, so a different person must decide it",
      };
    const p = this.parse(item);
    if (!p) return { ok: false, code: "not_found", message: "The proposal is unreadable" };
    if (decision === "reject") {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE items SET status = 'rejected', updated_at = ? WHERE id = ?", now, id);
        this.sql.exec(
          "INSERT OR REPLACE INTO approvals (item_id, revision, actor_id, kind, at, verdict) VALUES (?, ?, ?, 'review', ?, 'rejected')",
          id,
          item.revision,
          actorId,
          now,
        );
        if (p.findingKey)
          this.sql.exec(
            "UPDATE wiki_findings SET status = 'dismissed' WHERE key = ?",
            p.findingKey,
          );
        this.wikiLogAppend(actorId, `${p.kind}.rejected`, { id }, now);
      });
      return { ok: true, status: "rejected", applied: null };
    }
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
    let applied: ApplyResult | null = null;
    this.ctx.storage.transactionSync(() => {
      applied = this.applyProposal(p, actorId, actorId, now, id);
      this.sql.exec("UPDATE items SET status = 'approved', updated_at = ? WHERE id = ?", now, id);
      this.sql.exec(
        "INSERT OR REPLACE INTO approvals (item_id, revision, actor_id, kind, at) VALUES (?, ?, ?, 'approve', ?)",
        id,
        item.revision,
        actorId,
        now,
      );
      if (p.findingKey)
        this.sql.exec("UPDATE wiki_findings SET status = 'resolved' WHERE key = ?", p.findingKey);
    });
    for (const src of p.reingest)
      await this.wikiEnqueue("ingest", { sourceId: src, force: true }, now);
    return { ok: true, status: "approved", applied };
  }

  /** A reviewer's own wording for one page of a proposal. It is applied as written. */
  wikiEditProposal(
    id: string,
    actorId: string,
    pageId: string,
    markdown: string,
    now: number,
  ): Fail | { ok: true } {
    const item = this.get(id);
    if (!item || !isWikiKind(item.kind))
      return { ok: false, code: "not_found", message: "No such proposal" };
    if (item.status !== "candidate")
      return { ok: false, code: "not_pending", message: "The proposal was already decided" };
    const p = this.parse(item);
    const d = p?.pages.find((x) => x.pageId === pageId);
    if (!p || !d) return { ok: false, code: "not_found", message: "No such page in this proposal" };
    const known = new Set<string>(p.sources.map((s) => s.id));
    for (const f of p.facts) for (const sid of f.sourceIds) known.add(sid);
    for (const r of this.wikiSourceRefs(citationsOf(markdown))) known.add(r.id);
    const clean = markdown
      .replaceAll("\u0000", "")
      .replace(/\{src:([^}]*)\}/g, (m, x: string) => (known.has(x) ? m : ""))
      .slice(0, MAX_PAGE_CHARS);
    d.markdown = clean;
    d.edited = true;
    this.sql.exec(
      "UPDATE items SET body = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(p),
      now,
      id,
    );
    this.sql.exec(
      "INSERT INTO edits (item_id, revision, actor_id, at) VALUES (?, ?, ?, ?)",
      id,
      item.revision,
      actorId,
      now,
    );
    this.wikiLogAppend(actorId, "proposal.edited", { id, pageId }, now);
    return { ok: true };
  }

  /** Everything the reviewer needs to decide: before and after for each page, the facts and what they replace. */
  wikiProposalView(id: string): {
    id: string;
    kind: string;
    status: string;
    title: string;
    rationale: string;
    detail: string;
    authorId: string | null;
    createdAt: number;
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
    }[];
    confirm: number[];
    archive: string[];
    reingest: string[];
    sources: Proposal["sources"];
  } | null {
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
          .exec("SELECT subject, predicate, object FROM wiki_facts WHERE id = ?", i.factId)
          .toArray()[0];
        return {
          ...i,
          subject: (r?.subject as string) ?? "",
          predicate: (r?.predicate as string) ?? "",
          object: (r?.object as string) ?? "",
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
      pages: this.wikiPages().map(({ id, type, title, markdown, revision }) => ({
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
      this.ctx.storage.transactionSync(() => {
        this.savePage({ id, type: "topic", title: it.label, markdown: md }, it.authorId, cid, now);
        this.sql.exec("UPDATE wiki_promotions SET page_id = ? WHERE candidate_id = ?", id, cid);
        this.wikiLogAppend("system", "promotion.published", { pageId: id }, now);
      });
    }
  }

  // ---- operations ----

  wikiReset(): void {
    for (const t of WIKI_TABLES) this.sql.exec(`DELETE FROM ${t}`);
  }

  /** Right to erasure: a person's id in the wiki becomes a pseudonym. */
  wikiPseudonymise(from: string, to: string): number {
    let n = 0;
    for (const [t, c] of [
      ["wiki_facts", "verified_by"],
      ["wiki_log", "actor"],
      ["wiki_page_revisions", "actor"],
    ] as const)
      n += this.sql
        .exec(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ? RETURNING 1`, to, from)
        .toArray().length;
    return n;
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
