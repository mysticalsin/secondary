// The per-brain state that lives in a workspace's own Durable Object: template, publication mode,
// Everyone at Mantu, the business-field schema and values, stored member roles, hidden versions, the
// daily journal and Structure Coach proposals. BrainBase sits between WikiBase and Workspace, so a
// snapshot, an erasure and a reseed cover it (WIKI_TABLES). Nothing here knows the caller: the API
// checks policy first and passes the actor.

import type { BrainRole, Everyone, Publication } from "@secondary/policy";
import { BRAIN_ROLES } from "@secondary/policy";
import {
  claimMember,
  commitMember,
  decodeMember,
} from "../../../../src/state/brain-member.ts";
import { WikiBase } from "../wiki/store.ts";
import { citationsOf, lineDiff } from "../wiki/text.ts";
import { DEFAULT_SCHEMA, type Proposal, type SchemaType, type WikiSchema } from "../wiki/types.ts";
import {
  type Collection,
  DAY,
  type FieldDef,
  isCalendarDay,
  SESSION_REPORT_TYPE,
  schemaTypeOf,
  type TemplateId,
} from "./model.ts";

export type BrainFail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): BrainFail => ({ ok: false, code, message });

export const JOURNAL_TYPE: SchemaType = { label: "Journal", required: [], generated: true };
/** Where agents' session reports go (Sources > Session reports). Every brain knows it. */
export const SESSION_REPORT_SCHEMA: SchemaType = { label: "Session reports", required: [] };
const JOURNAL_ID = /^journal-\d{4}-\d{2}-\d{2}$/;
const SERVICE = "system:journal";
const MAX_LOOKBACK_DAYS = 7;
const SCHEMA_TYPE_KEY = /^[a-z][a-z0-9_]{0,40}$/;

export interface BrainConfig {
  template: TemplateId | null;
  publication: Publication | null;
  everyone: Everyone | null;
  fields: FieldDef[];
}

export interface MemberRow {
  principalId: string;
  role: BrainRole;
  state: "active" | "pending";
  addedBy: string;
  at: number;
}

export interface VersionRow {
  revision: number;
  at: number;
  actor: string | null;
  hidden: boolean;
  hiddenAt: number | null;
  hiddenBy: string | null;
  reason: string | null;
}

export interface ChangeRow {
  pageId: string;
  title: string;
  type: string;
  revision: number;
  at: number;
  actor: string | null;
  change: "new" | "updated";
  diff: { type: "add" | "del" | "same"; text: string }[];
}

export interface InsightRaw {
  revisions: { pageId: string; at: number }[];
  proposals: {
    id: string;
    kind: string;
    status: string;
    createdAt: number;
    decidedAt: number;
    origin: string;
    rationale: string;
    sources: string[];
    titleSources: string[];
    reviewed: boolean;
  }[];
  ingested: { sourceId: string; at: number }[];
  promotions: number;
  facts: { sourceIds: string[]; verified: boolean; confidence: number }[];
  sourceKinds: Record<string, "sharepoint" | "meetings" | "manual">;
  provenance: Record<string, "agents" | "import">;
}

export interface CoachRow {
  id: string;
  hash: string;
  body: string;
  expiresAt: number;
  appliedAt: number | null;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export abstract class BrainBase extends WikiBase {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS brain_members (
          principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
          added_by TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS brain_fields (
          page_id TEXT NOT NULL, field_key TEXT NOT NULL, value TEXT NOT NULL,
          written_by TEXT NOT NULL, written_at INTEGER NOT NULL, PRIMARY KEY (page_id, field_key));
        CREATE TABLE IF NOT EXISTS brain_coach (
          id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, applied_at INTEGER);
      `);
      const cols = this.sql.exec("PRAGMA table_info(wiki_page_revisions)").toArray();
      for (const [name, type] of [
        ["hidden_at", "INTEGER"],
        ["hidden_by", "TEXT"],
        ["hidden_reason", "TEXT"],
      ] as const)
        if (!cols.some((c) => c.name === name))
          this.sql.exec(`ALTER TABLE wiki_page_revisions ADD COLUMN ${name} ${type}`);
    });
  }

  /** The schema always knows the journal and session report collections, whatever an older stored schema says. */
  override wikiSchema(): WikiSchema {
    const s = super.wikiSchema();
    if (s.types.journal && s.types[SESSION_REPORT_TYPE]) return s;
    return {
      ...s,
      types: {
        journal: JOURNAL_TYPE,
        [SESSION_REPORT_TYPE]: SESSION_REPORT_SCHEMA,
        ...s.types,
      },
    };
  }

  // ---- config ----

  brainConfig(): BrainConfig {
    const t = this.metaGet("brain_template");
    const p = this.metaGet("brain_publication");
    const e = this.metaGet("brain_everyone");
    let fields: FieldDef[] = [];
    try {
      fields = JSON.parse(this.metaGet("brain_fields") ?? "[]") as FieldDef[];
    } catch {
      fields = [];
    }
    return {
      template: (t as TemplateId | null) ?? null,
      publication: p === "review" || p === "direct" ? p : null,
      everyone: e === "none" || e === "reader" || e === "contributor" ? e : null,
      fields,
    };
  }

  brainConfigSet(patch: Partial<BrainConfig>, actor: string, now: number): BrainConfig {
    if (patch.template) this.metaSet("brain_template", patch.template);
    if (patch.publication) this.metaSet("brain_publication", patch.publication);
    if (patch.everyone) this.metaSet("brain_everyone", patch.everyone);
    if (patch.fields) this.metaSet("brain_fields", JSON.stringify(patch.fields));
    this.wikiLogAppend(actor, "brain.config", { keys: Object.keys(patch) }, now);
    return this.brainConfig();
  }

  /** Add collections to the schema. Never removes or changes one that exists. Returns the types added. */
  brainSchemaAdd(collections: Collection[]): string[] {
    const schema = this.wikiSchema();
    const added: string[] = [];
    const types = { ...schema.types };
    for (const c of collections) {
      if (!SCHEMA_TYPE_KEY.test(c.type) || types[c.type]) continue;
      types[c.type] = schemaTypeOf(c);
      added.push(c.type);
    }
    if (added.length || !super.wikiSchema().types.journal) this.wikiSetSchema({ ...schema, types });
    return added;
  }

  // ---- stored member roles (they only ever narrow) ----

  brainMembers(): MemberRow[] {
    return this.sql
      .exec("SELECT * FROM brain_members ORDER BY at, principal_id")
      .toArray()
      .map((r) => ({
        principalId: r.principal_id as string,
        role: r.role as BrainRole,
        state: r.state as "active" | "pending",
        addedBy: r.added_by as string,
        at: r.at as number,
      }));
  }

  /** The highest stored role among the ids of one human, or null when they have none. */
  brainRoleOf(principalIds: string[]): BrainRole | null {
    if (!principalIds.length) return null;
    let best = -1;
    for (const id of principalIds.slice(0, 20)) {
      const r = this.sql
        .exec("SELECT role FROM brain_members WHERE principal_id = ?", id)
        .toArray()[0];
      if (r) best = Math.max(best, BRAIN_ROLES.indexOf(r.role as BrainRole));
    }
    return best < 0 ? null : (BRAIN_ROLES[best] as BrainRole);
  }

  brainMemberSet(
    principalId: string,
    role: BrainRole,
    state: "active" | "pending",
    actor: string,
    now: number,
  ): { ok: true; state: "active" | "pending" } | { ok: false; code: string } {
    const row = this.sql
      .exec("SELECT role, state, at FROM brain_members WHERE principal_id = ?", principalId)
      .toArray()[0];
    const from = row ? decodeMember(row.state) : { tag: "absent" as const };
    const step = commitMember(from, { type: "set", state, now });
    if (!step.ok) return { ok: false, code: step.reason };
    const matched =
      from.tag === "absent"
        ? this.sql
            .exec(
              `INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(principal_id) DO NOTHING RETURNING principal_id`,
              principalId,
              role,
              state,
              actor,
              now,
            )
            .toArray().length
        : this.sql
            .exec(
              `UPDATE brain_members SET role = ?, state = ?, added_by = ?, at = ?
               WHERE principal_id = ? AND state = ? AND at = ? RETURNING principal_id`,
              role,
              state,
              actor,
              now,
              principalId,
              from.tag,
              row?.at,
            )
            .toArray().length;
    if (claimMember(matched).tag !== "applied") {
      console.warn(JSON.stringify({ at: "brain_member", reason: "replay" }));
      return { ok: false, code: "replay" };
    }
    this.wikiLogAppend(actor, "brain.member", { principalId, role, state }, now);
    return { ok: true, state };
  }

  brainMemberRemove(principalId: string, actor: string, now: number): boolean {
    const n = this.sql
      .exec("DELETE FROM brain_members WHERE principal_id = ? RETURNING 1", principalId)
      .toArray().length;
    if (n) this.wikiLogAppend(actor, "brain.member_removed", { principalId }, now);
    return n > 0;
  }

  // ---- what changed ----

  brainChangesSince(since: number, limit: number): ChangeRow[] {
    const rows = this.sql
      .exec(
        `SELECT r.page_id AS page_id, MAX(r.revision) AS rev FROM wiki_page_revisions r
         JOIN wiki_pages p ON p.id = r.page_id AND p.status = 'published' AND p.type != 'journal'
         WHERE r.at >= ? AND r.hidden_at IS NULL GROUP BY r.page_id ORDER BY MAX(r.at) DESC LIMIT ?`,
        since,
        limit,
      )
      .toArray();
    const out: ChangeRow[] = [];
    for (const row of rows) {
      const id = row.page_id as string;
      const cur = this.sql
        .exec(
          "SELECT * FROM wiki_page_revisions WHERE page_id = ? AND revision = ?",
          id,
          row.rev as number,
        )
        .toArray()[0];
      const page = this.pageById(id);
      if (!cur || !page) continue;
      const prev = this.sql
        .exec(
          "SELECT markdown FROM wiki_page_revisions WHERE page_id = ? AND revision < ? ORDER BY revision DESC LIMIT 1",
          id,
          cur.revision as number,
        )
        .toArray()[0];
      out.push({
        pageId: id,
        title: cur.title as string,
        type: page.type,
        revision: cur.revision as number,
        at: cur.at as number,
        actor: (cur.actor as string | null) ?? null,
        change: prev ? "updated" : "new",
        diff: lineDiff(prev ? (prev.markdown as string) : null, cur.markdown as string)
          .filter((d) => d.type !== "same")
          .slice(0, 400),
      });
    }
    return out;
  }

  // ---- insights (raw aggregates; the API filters them to what the caller may read) ----

  /**
   * What the Insights views need from this workspace, with no page text: when each published page
   * was written to, the proposals of the window, sources ingested, promotions, valid facts and the
   * kind of each cited source. Nothing here is policy-filtered: the API keeps only what the caller
   * may read before it counts or names anything.
   */
  brainInsightRaw(
    since: number,
    historyFrom: number,
    citedIds: string[],
    light = false,
  ): InsightRaw {
    const revisions = this.sql
      .exec(
        `SELECT r.page_id AS page_id, r.at AS at FROM wiki_page_revisions r
         JOIN wiki_pages p ON p.id = r.page_id AND p.status = 'published'
         WHERE r.at >= ? AND r.hidden_at IS NULL ORDER BY r.at LIMIT 20000`,
        historyFrom,
      )
      .toArray()
      .map((r) => ({ pageId: r.page_id as string, at: r.at as number }));
    if (light)
      return {
        revisions,
        proposals: [],
        ingested: [],
        promotions: 0,
        facts: [],
        sourceKinds: {},
        provenance: {},
      };
    const proposals = this.sql
      .exec(
        `SELECT i.id AS id, i.kind AS kind, i.status AS status, i.created_at AS created_at,
                i.updated_at AS updated_at, i.body AS body,
                EXISTS (SELECT 1 FROM approvals a WHERE a.item_id = i.id AND a.kind = 'review') AS reviewed
         FROM items i WHERE i.kind LIKE 'wiki\\_%' ESCAPE '\\' AND i.created_at >= ?
         ORDER BY i.created_at DESC LIMIT 500`,
        since,
      )
      .toArray()
      .map((r) => {
        let p: Partial<Proposal> = {};
        try {
          p = JSON.parse((r.body as string | null) ?? "{}") as Partial<Proposal>;
        } catch {
          // an unreadable body counts as a proposal with no sources
        }
        return {
          id: r.id as string,
          kind: r.kind as string,
          status: r.status as string,
          createdAt: r.created_at as number,
          decidedAt: r.updated_at as number,
          origin: p.origin ?? "human",
          rationale: String(p.rationale ?? "").slice(0, 80),
          sources: (p.sources ?? []).map((x) => x.id),
          titleSources: p.titleSources ?? [],
          reviewed: !!r.reviewed,
        };
      });
    const ingested = this.sql
      .exec(
        "SELECT source_id, ingested_at FROM wiki_sources WHERE ingested_at IS NOT NULL AND ingested_at >= ? LIMIT 2000",
        since,
      )
      .toArray()
      .map((r) => ({ sourceId: r.source_id as string, at: r.ingested_at as number }));
    const promotions = this.sql
      .exec("SELECT COUNT(*) AS n FROM wiki_promotions WHERE at >= ?", since)
      .one().n as number;
    const facts = this.wikiFacts({ validOnly: true, limit: 2_000 }).map((f) => ({
      sourceIds: f.sourceIds,
      verified: f.verifiedBy !== null,
      confidence: f.confidence,
    }));
    const sourceKinds: Record<string, "sharepoint" | "meetings" | "manual"> = {};
    for (const id of [...new Set(citedIds)].slice(0, 2_000)) {
      const it = this.sql.exec("SELECT kind FROM items WHERE id = ?", id).toArray()[0];
      if (it) sourceKinds[id] = it.kind === "meeting_record" ? "meetings" : "manual";
      else if (this.sql.exec("SELECT 1 AS x FROM source_items WHERE id = ?", id).toArray()[0])
        sourceKinds[id] = "sharepoint";
    }
    // Where each page's latest text came from, by the words its proposal was filed with.
    const provenance: Record<string, "agents" | "import"> = {};
    const why = new Map<string, string>();
    const latest = this.sql
      .exec(
        `SELECT r.page_id AS page_id, r.proposal_id AS proposal_id FROM wiki_page_revisions r
         JOIN (SELECT page_id, MAX(revision) AS m FROM wiki_page_revisions GROUP BY page_id) x
           ON x.page_id = r.page_id AND x.m = r.revision
         JOIN wiki_pages p ON p.id = r.page_id AND p.status = 'published'
         WHERE r.proposal_id IS NOT NULL LIMIT 5000`,
      )
      .toArray();
    for (const r of latest) {
      const pid = r.proposal_id as string;
      if (!why.has(pid)) {
        const it = this.sql.exec("SELECT body FROM items WHERE id = ?", pid).toArray()[0];
        let text = "";
        try {
          text = String(
            (JSON.parse((it?.body as string | null) ?? "{}") as Partial<Proposal>).rationale ?? "",
          );
        } catch {
          // no rationale
        }
        why.set(pid, text.toLowerCase());
      }
      const t = why.get(pid) ?? "";
      if (t.includes("agent")) provenance[r.page_id as string] = "agents";
      else if (t.startsWith("imported")) provenance[r.page_id as string] = "import";
    }
    return { revisions, proposals, ingested, promotions, facts, sourceKinds, provenance };
  }

  // ---- business field values ----

  brainFieldValues(
    pageId: string,
  ): { key: string; value: string; writtenBy: string; writtenAt: number }[] {
    return this.sql
      .exec("SELECT * FROM brain_fields WHERE page_id = ? ORDER BY field_key", pageId)
      .toArray()
      .map((r) => ({
        key: r.field_key as string,
        value: r.value as string,
        writtenBy: r.written_by as string,
        writtenAt: r.written_at as number,
      }));
  }

  brainFieldsWrite(
    pageId: string,
    writes: { key: string; value: string | null }[],
    actor: string,
    now: number,
  ): void {
    for (const w of writes) {
      if (w.value === null)
        this.sql.exec(
          "DELETE FROM brain_fields WHERE page_id = ? AND field_key = ?",
          pageId,
          w.key,
        );
      else
        this.sql.exec(
          `INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(page_id, field_key) DO UPDATE SET value = excluded.value, written_by = excluded.written_by, written_at = excluded.written_at`,
          pageId,
          w.key,
          w.value,
          actor,
          now,
        );
    }
    // The log keeps keys only, never values.
    this.wikiLogAppend(actor, "brain.fields", { pageId, keys: writes.map((w) => w.key) }, now);
  }

  /** Every stored value of the brain, for the export (which keeps the harmless fields only). */
  brainAllFieldValues(): { pageId: string; key: string; value: string }[] {
    return this.sql
      .exec(
        "SELECT page_id, field_key, value FROM brain_fields ORDER BY page_id, field_key LIMIT 20000",
      )
      .toArray()
      .map((r) => ({
        pageId: r.page_id as string,
        key: r.field_key as string,
        value: r.value as string,
      }));
  }

  /** Values past their field's retention are deleted. Returns how many. */
  brainPurgeFields(now: number): number {
    let n = 0;
    for (const f of this.brainConfig().fields)
      if (f.retentionDays)
        n += this.sql
          .exec(
            "DELETE FROM brain_fields WHERE field_key = ? AND written_at < ? RETURNING 1",
            f.key,
            now - f.retentionDays * DAY,
          )
          .toArray().length;
    // A page that is gone keeps no values.
    this.sql.exec("DELETE FROM brain_fields WHERE page_id NOT IN (SELECT id FROM wiki_pages)");
    return n;
  }

  // ---- hidden versions ----

  brainVersions(pageId: string, limit: number): VersionRow[] {
    return this.sql
      .exec(
        "SELECT * FROM wiki_page_revisions WHERE page_id = ? ORDER BY revision DESC LIMIT ?",
        pageId,
        limit,
      )
      .toArray()
      .map((r) => ({
        revision: r.revision as number,
        at: r.at as number,
        actor: (r.actor as string | null) ?? null,
        hidden: r.hidden_at != null,
        hiddenAt: (r.hidden_at as number | null) ?? null,
        hiddenBy: (r.hidden_by as string | null) ?? null,
        reason: (r.hidden_reason as string | null) ?? null,
      }));
  }

  brainSetHidden(
    pageId: string,
    revision: number,
    hide: boolean,
    actor: string,
    reason: string,
    now: number,
  ): { ok: true } | BrainFail {
    const page = this.pageById(pageId);
    if (!page) return fail("not_found", "No such page");
    const row = this.sql
      .exec(
        "SELECT hidden_at FROM wiki_page_revisions WHERE page_id = ? AND revision = ?",
        pageId,
        revision,
      )
      .toArray()[0];
    if (!row) return fail("not_found", "No such version");
    if (hide && revision === page.revision)
      return fail("current_revision", "The current version cannot be hidden. Hide an older one");
    if (hide === (row.hidden_at != null))
      return fail(hide ? "already_hidden" : "not_hidden", hide ? "Already hidden" : "Not hidden");
    this.sql.exec(
      "UPDATE wiki_page_revisions SET hidden_at = ?, hidden_by = ?, hidden_reason = ? WHERE page_id = ? AND revision = ?",
      hide ? now : null,
      hide ? actor : null,
      hide ? reason : null,
      pageId,
      revision,
    );
    this.wikiLogAppend(
      actor,
      hide ? "version.hidden" : "version.restored",
      { pageId, revision },
      now,
    );
    return { ok: true };
  }

  // ---- journal: built only from this brain's own wiki log ----

  brainJournalDays(limit: number): { date: string; pageId: string }[] {
    return this.sql
      .exec(
        "SELECT id FROM wiki_pages WHERE type = 'journal' AND status = 'published' ORDER BY id DESC LIMIT ?",
        limit,
      )
      .toArray()
      .map((r) => r.id as string)
      .filter((id) => JOURNAL_ID.test(id))
      .map((id) => ({ date: id.slice(8), pageId: id }));
  }

  /**
   * Writes the journal page of one UTC day. Counts and `[[page]]` links only: no titles, no text, no
   * actor. A day with nothing in the log has no page. Deterministic: the same log gives the same page.
   */
  brainJournalRun(date: string, now: number): { pageId: string | null; created: boolean } {
    if (!isCalendarDay(date)) return { pageId: null, created: false };
    const start = Date.parse(`${date}T00:00:00Z`);
    const rows = this.sql
      .exec(
        "SELECT kind, detail FROM wiki_log WHERE at >= ? AND at < ? ORDER BY id",
        start,
        start + DAY,
      )
      .toArray()
      .filter((r) => {
        const k = r.kind as string;
        return !k.startsWith("journal.") && !k.startsWith("brain.");
      });
    if (!rows.length) return { pageId: null, created: false };
    const n = { filed: 0, published: 0, approved: 0, rejected: 0, contradictions: 0, resolved: 0 };
    const c = { lintRuns: 0, found: 0, verified: 0, unchanged: 0, edited: 0, dreams: 0 };
    const touched = new Set<string>();
    const detail = (s: string): Record<string, unknown> => {
      try {
        const v: unknown = JSON.parse(s);
        return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    for (const r of rows) {
      const kind = r.kind as string;
      const d = detail(r.detail as string);
      if (kind === "wiki_ingest.proposed") n.filed++;
      else if (kind === "wiki_lint.proposed") {
        const item = this.sql
          .exec("SELECT body FROM items WHERE id = ?", String(d.id))
          .toArray()[0];
        if (item && /"findingKey":"contra:/.test(String(item.body))) n.contradictions++;
      } else if (kind.endsWith(".applied")) {
        n.published++;
        n.resolved += Number(d.invalidated ?? 0) || 0;
        if (Array.isArray(d.pages)) for (const p of d.pages) touched.add(String(p));
      } else if (kind === "auto_accepted" || kind === "seed.accepted") n.published++;
      else if (kind.endsWith(".rejected")) n.rejected++;
      else if (kind.endsWith(".approval")) n.approved++;
      else if (kind === "lint.run") {
        c.lintRuns++;
        c.found += Number(d.found ?? 0) || 0;
      } else if (kind === "dream.run") c.dreams++;
      else if (kind === "fact.verified") c.verified++;
      else if (kind === "ingest.triage") c.unchanged++;
      else if (kind === "proposal.edited") c.edited++;
    }
    const linked = [...touched]
      .filter(
        (id) => this.pageById(id)?.status === "published" && this.pageById(id)?.type !== "journal",
      )
      .sort()
      .slice(0, 30);
    const s = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
    const lines = [
      `# Journal ${date}`,
      "",
      "## Ingested",
      `- ${s(n.filed, "page proposal filed", "page proposals filed")} for review`,
      `- ${s(n.published, "change published", "changes published")}`,
      `- ${s(c.unchanged, "source read with nothing new", "sources read with nothing new")}`,
      "",
      "## Decided",
      `- ${s(n.approved, "approval", "approvals")} and ${s(n.rejected, "rejection", "rejections")}`,
      `- ${s(c.verified, "fact confirmed", "facts confirmed")}`,
      `- ${s(c.edited, "proposal edited by a reviewer", "proposals edited by a reviewer")}`,
      "",
      "## Contradicted",
      `- ${s(n.contradictions, "contradiction raised", "contradictions raised")}`,
      `- ${s(n.resolved, "older fact ended", "older facts ended")}`,
      "",
      "## Checks",
      `- ${s(c.lintRuns, "lint run", "lint runs")} found ${c.found}`,
      `- ${s(c.dreams, "consolidation run", "consolidation runs")}`,
    ];
    if (linked.length) lines.push("", "## Pages changed", ...linked.map((id) => `- [[${id}]]`));
    const id = `journal-${date}`;
    const existed = this.pageById(id) !== null;
    this.savePage(
      { id, type: "journal", title: `Journal ${date}`, markdown: lines.join("\n") },
      SERVICE,
      null,
      now,
    );
    if (!existed) this.wikiLogAppend(SERVICE, "journal.written", { date }, now);
    return { pageId: id, created: !existed };
  }

  /** The nightly work: yesterday's journal (and any day missed in the last week) and field retention. */
  brainDaily(now: number): void {
    if (!this.wikiMeta()) return;
    const yesterday = isoDay(now - DAY);
    const through = this.metaGet("brain_journal_through");
    let day = through ? Date.parse(`${through}T00:00:00Z`) + DAY : now - DAY * MAX_LOOKBACK_DAYS;
    day = Math.max(day, now - DAY * MAX_LOOKBACK_DAYS);
    while (isoDay(day) <= yesterday) {
      this.brainJournalRun(isoDay(day), now);
      day += DAY;
    }
    this.metaSet("brain_journal_through", yesterday);
    this.brainPurgeFields(now);
  }

  override async alarm(): Promise<void> {
    try {
      this.brainDaily(Date.now());
    } catch (e) {
      console.warn(JSON.stringify({ at: "brain_daily", error: String(e).slice(0, 200) }));
    }
    await super.alarm();
  }

  // ---- Structure Coach ----

  brainCoachSave(id: string, hash: string, body: string, now: number, ttlMs: number): void {
    this.sql.exec("DELETE FROM brain_coach WHERE expires_at < ?", now);
    this.sql.exec(
      "INSERT OR REPLACE INTO brain_coach (id, hash, body, created_at, expires_at, applied_at) VALUES (?, ?, ?, ?, ?, NULL)",
      id,
      hash,
      body,
      now,
      now + ttlMs,
    );
  }

  brainCoachGet(id: string, now: number): CoachRow | null {
    const r = this.sql
      .exec(
        "SELECT * FROM brain_coach WHERE id = ? AND expires_at >= ? AND applied_at IS NULL",
        id,
        now,
      )
      .toArray()[0];
    return r
      ? {
          id: r.id as string,
          hash: r.hash as string,
          body: r.body as string,
          expiresAt: r.expires_at as number,
          appliedAt: null,
        }
      : null;
  }

  brainCoachDone(id: string, actor: string, now: number): void {
    this.sql.exec("UPDATE brain_coach SET applied_at = ? WHERE id = ?", now, id);
    this.wikiLogAppend(actor, "brain.coach_applied", { id }, now);
  }

  /** The page ids of this brain that cite a source (the routes re-check readability per caller). */
  brainCitedBy(pageId: string): string[] {
    const p = this.pageById(pageId);
    return p ? citationsOf(p.markdown) : [];
  }
}

export { DEFAULT_SCHEMA };
