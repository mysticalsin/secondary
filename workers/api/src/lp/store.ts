// The Landing Page Studio store: one Durable Object per tenant (SQLite). It keeps each page record
// (status, copy, references, review state) and nothing of the brain itself. The invariants that belong
// to the data live here: exact revision on every edit, an edit takes a page back to draft, approval
// names the exact revision hash, and nobody who wrote the page can approve it. Who may call it is
// decided by the API before it is addressed.

import { DurableObject } from "cloudflare:workers";
import { exportTables, replaceTables, type Snapshot } from "../ops-snapshot.ts";
import {
  type Brand,
  type CheckResult,
  type Contact,
  type Lang,
  type PageRecord,
  type Prospect,
  type Reference,
  revisionHashOf,
  type Slots,
  type Stats,
  type Status,
  type Utm,
} from "./types.ts";

/** Tables a backup carries: the whole LP store (copy, prospect data, review trail). */
const SNAPSHOT_TABLES = ["pages", "snapshots", "edits", "approvals"] as const;

export type Fail = {
  ok: false;
  code:
    | "not_found"
    | "conflict"
    | "locked"
    | "not_in_review"
    | "not_approved"
    | "self_approval"
    | "checks_required";
  message: string;
  currentRevision?: number;
};
export type Done = { ok: true; record: PageRecord };
export type Result = Done | Fail;
export type Actor = { id: string; email: string };

export interface NewPage {
  id: string;
  owner: string;
  ownerEmail: string;
  brand: Brand;
  lang: Lang;
  prospect: Prospect;
  slots: Slots;
  references: Reference[];
  contact: Contact;
  composer: "deterministic" | "ai";
  expiresAt: number;
}

const json = (v: unknown): string => JSON.stringify(v);
const parse = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const fail = (code: Fail["code"], message: string, currentRevision?: number): Fail => ({
  ok: false,
  code,
  message,
  ...(currentRevision === undefined ? {} : { currentRevision }),
});
const lower = (s: string): string => s.trim().toLowerCase();

function toRecord(r: Record<string, SqlStorageValue>): PageRecord {
  return {
    id: r.id as string,
    owner: r.owner as string,
    ownerEmail: r.owner_email as string,
    status: r.status as Status,
    brand: r.brand as Brand,
    lang: r.lang as Lang,
    prospect: parse(r.prospect, { role: "", company: "" }),
    slots: parse(r.slots, { hero: "", intro: "", whyUs: "", caseStudyIntro: "", cta: "" }),
    references: parse(r.refs, []),
    contact: parse(r.contact, { name: "", email: "" }),
    revision: r.revision as number,
    composer: r.composer as "deterministic" | "ai",
    slug: (r.slug as string | null) ?? null,
    expiresAt: r.expires_at as number,
    publishedAt: (r.published_at as number | null) ?? null,
    utm: parse<Utm | null>(r.utm, null),
    previewHtml: (r.preview_html as string | null) ?? null,
    approvedHash: (r.approved_hash as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    checks: parse<PageRecord["checks"]>(r.checks, null),
    finalStats: parse<Stats | null>(r.final_stats, null),
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export class LandingPages extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_email TEXT NOT NULL, status TEXT NOT NULL,
          brand TEXT NOT NULL, lang TEXT NOT NULL, prospect TEXT NOT NULL, slots TEXT NOT NULL,
          refs TEXT NOT NULL, contact TEXT NOT NULL, revision INTEGER NOT NULL, composer TEXT NOT NULL,
          slug TEXT, expires_at INTEGER NOT NULL, published_at INTEGER, utm TEXT, preview_html TEXT,
          approved_hash TEXT, approved_by TEXT, checks TEXT, final_stats TEXT, note TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS pages_owner ON pages (owner, updated_at);
        CREATE INDEX IF NOT EXISTS pages_status ON pages (status, expires_at);
        CREATE TABLE IF NOT EXISTS snapshots (
          page_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL,
          PRIMARY KEY (page_id, revision));
        CREATE TABLE IF NOT EXISTS edits (
          page_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS edits_page ON edits (page_id);
        CREATE TABLE IF NOT EXISTS approvals (
          page_id TEXT NOT NULL, revision_hash TEXT NOT NULL, actor_id TEXT NOT NULL, at INTEGER NOT NULL,
          PRIMARY KEY (page_id, revision_hash, actor_id));
      `);
    });
  }

  private row(id: string): PageRecord | null {
    const r = this.sql.exec("SELECT * FROM pages WHERE id = ?", id).toArray()[0];
    return r ? toRecord(r) : null;
  }

  private snapshot(r: PageRecord): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO snapshots (page_id, revision, snapshot) VALUES (?, ?, ?)",
      r.id,
      r.revision,
      json({
        slots: r.slots,
        references: r.references.map((x) => x.title),
        refs: r.references,
        contact: r.contact,
      }),
    );
  }

  private noteEdit(id: string, a: Actor, now: number): void {
    this.sql.exec(
      "INSERT INTO edits (page_id, actor_id, actor_email, at) VALUES (?, ?, ?, ?)",
      id,
      a.id,
      lower(a.email),
      now,
    );
  }

  create(i: NewPage, now: number): PageRecord {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO pages (id, owner, owner_email, status, brand, lang, prospect, slots, refs, contact,
           revision, composer, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        i.id,
        i.owner,
        i.ownerEmail,
        i.brand,
        i.lang,
        json(i.prospect),
        json(i.slots),
        json(i.references),
        json(i.contact),
        i.composer,
        i.expiresAt,
        now,
        now,
      );
      this.noteEdit(i.id, { id: i.owner, email: i.ownerEmail }, now);
    });
    const r = this.row(i.id) as PageRecord;
    this.snapshot(r);
    return r;
  }

  get(id: string): PageRecord | null {
    return this.row(id);
  }

  listByOwner(owner: string, limit: number): PageRecord[] {
    return this.sql
      .exec(
        "SELECT * FROM pages WHERE owner = ? ORDER BY updated_at DESC, id LIMIT ?",
        owner,
        limit,
      )
      .toArray()
      .map(toRecord);
  }

  inReview(limit: number): PageRecord[] {
    return this.sql
      .exec(
        "SELECT * FROM pages WHERE status = 'in_review' ORDER BY updated_at DESC, id LIMIT ?",
        limit,
      )
      .toArray()
      .map(toRecord);
  }

  /** Every person who changed the page, by principal id and by address. */
  editors(id: string): { ids: string[]; emails: string[] } {
    const rows = this.sql
      .exec("SELECT DISTINCT actor_id, actor_email FROM edits WHERE page_id = ?", id)
      .toArray();
    return {
      ids: rows.map((r) => r.actor_id as string),
      emails: [...new Set(rows.map((r) => r.actor_email as string))],
    };
  }

  /** The snapshot of an earlier revision, for the diff in the review. */
  snapshotOf(
    id: string,
    revision: number,
  ): { slots: Slots; references: string[]; refs?: Reference[]; contact?: Contact } | null {
    const r = this.sql
      .exec("SELECT snapshot FROM snapshots WHERE page_id = ? AND revision = ?", id, revision)
      .toArray()[0];
    return r ? parse(r.snapshot, null) : null;
  }

  /** An edit: exact revision, and the page goes back to draft with its checks and approval cleared. */
  update(
    id: string,
    expected: number,
    patch: { slots: Slots; references: Reference[]; contact: Contact },
    actor: Actor,
    now: number,
  ): Result {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.revision !== expected)
      return fail("conflict", "The page changed since you opened it", cur.revision);
    if (cur.status === "published")
      return fail("locked", "Unpublish the page before editing it", cur.revision);
    if (cur.status === "expired") return fail("locked", "The page has expired", cur.revision);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE pages SET slots = ?, refs = ?, contact = ?, revision = revision + 1, status = 'draft',
           checks = NULL, preview_html = NULL, approved_hash = NULL, approved_by = NULL, note = NULL,
           updated_at = ? WHERE id = ?`,
        json(patch.slots),
        json(patch.references),
        json(patch.contact),
        now,
        id,
      );
      this.sql.exec("DELETE FROM approvals WHERE page_id = ?", id);
      this.noteEdit(id, actor, now);
    });
    const r = this.row(id) as PageRecord;
    this.snapshot(r);
    return { ok: true, record: r };
  }

  saveChecks(id: string, hash: string, result: CheckResult): void {
    this.sql.exec("UPDATE pages SET checks = ? WHERE id = ?", json({ ...result, hash }), id);
  }

  /** Draft to in review. The API has already run the checks on this exact revision. */
  async submit(id: string, expected: number, previewHtml: string, now: number): Promise<Result> {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.revision !== expected)
      return fail("conflict", "The page changed since you opened it", cur.revision);
    if (cur.status !== "draft")
      return fail("locked", "Only a draft can be sent to review", cur.revision);
    const hash = await revisionHashOf(cur);
    if (!cur.checks?.ok || cur.checks.hash !== hash)
      return fail("checks_required", "The checks must pass on this revision first", cur.revision);
    this.sql.exec(
      "UPDATE pages SET status = 'in_review', preview_html = ?, updated_at = ? WHERE id = ?",
      previewHtml,
      now,
      id,
    );
    return { ok: true, record: this.row(id) as PageRecord };
  }

  /**
   * Approval of one exact revision by someone who did not write the page. `humans` are all the ids
   * the approving person acts under: the author, or anyone who edited the page, counts as the same
   * person when an id or an address matches (two-person rule).
   */
  async approve(
    id: string,
    revisionHash: string,
    actor: Actor,
    humans: string[],
    now: number,
  ): Promise<Result> {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.status !== "in_review")
      return fail("not_in_review", "The page is not waiting for review", cur.revision);
    const hash = await revisionHashOf(cur);
    if (hash !== revisionHash)
      return fail(
        "conflict",
        "The page changed since you read it. Reload and read it again",
        cur.revision,
      );
    const ed = this.editors(id);
    const mine = new Set([...humans, actor.id]);
    const email = lower(actor.email);
    if (
      mine.has(cur.owner) ||
      lower(cur.ownerEmail) === email ||
      ed.ids.some((x) => mine.has(x)) ||
      ed.emails.includes(email)
    )
      return fail("self_approval", "The author or an editor cannot approve the page", cur.revision);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT OR IGNORE INTO approvals (page_id, revision_hash, actor_id, at) VALUES (?, ?, ?, ?)",
        id,
        hash,
        actor.id,
        now,
      );
      this.sql.exec(
        "UPDATE pages SET status = 'approved', approved_hash = ?, approved_by = ?, updated_at = ? WHERE id = ?",
        hash,
        actor.id,
        now,
        id,
      );
    });
    return { ok: true, record: this.row(id) as PageRecord };
  }

  /** A reviewer sends the page back with a note. The author edits it and submits again. */
  requestChanges(id: string, note: string, now: number): Result {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.status !== "in_review")
      return fail("not_in_review", "The page is not waiting for review", cur.revision);
    this.sql.exec(
      "UPDATE pages SET status = 'draft', note = ?, preview_html = NULL, checks = NULL, updated_at = ? WHERE id = ?",
      note.slice(0, 2_000),
      now,
      id,
    );
    return { ok: true, record: this.row(id) as PageRecord };
  }

  /** The page is approved, unchanged since, and about to go out. Nothing else can publish. */
  async publishable(id: string): Promise<Result> {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.status !== "approved" && cur.status !== "unpublished")
      return fail("not_approved", "The page has not been approved", cur.revision);
    const hash = await revisionHashOf(cur);
    if (!cur.approvedHash || cur.approvedHash !== hash)
      return fail("not_approved", "The page has not been approved", cur.revision);
    return { ok: true, record: cur };
  }

  markPublished(id: string, slug: string, expiresAt: number, utm: Utm | null, now: number): Result {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    this.sql.exec(
      `UPDATE pages SET status = 'published', slug = ?, expires_at = ?, utm = ?, published_at = ?,
         final_stats = NULL, updated_at = ? WHERE id = ?`,
      slug,
      expiresAt,
      utm ? json(utm) : null,
      now,
      now,
      id,
    );
    return { ok: true, record: this.row(id) as PageRecord };
  }

  markUnpublished(id: string, stats: Stats | null, now: number): Result {
    const cur = this.row(id);
    if (!cur) return fail("not_found", "No such page");
    if (cur.status !== "published")
      return fail("locked", "The page is not published", cur.revision);
    this.sql.exec(
      "UPDATE pages SET status = 'unpublished', final_stats = ?, updated_at = ? WHERE id = ?",
      stats ? json(stats) : null,
      now,
      id,
    );
    return { ok: true, record: this.row(id) as PageRecord };
  }

  /** Pages whose clock has run out and that still hold prospect data. */
  due(now: number, limit: number): PageRecord[] {
    return this.sql
      .exec(
        "SELECT * FROM pages WHERE status != 'expired' AND expires_at <= ? ORDER BY expires_at, id LIMIT ?",
        now,
        limit,
      )
      .toArray()
      .map(toRecord);
  }

  /** Expiry: the prospect's data, the copy and the review traces go; the counts and the id stay. */
  expire(id: string, stats: Stats | null, now: number): boolean {
    const cur = this.row(id);
    if (!cur || cur.status === "expired") return false;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE pages SET status = 'expired', prospect = ?, slots = ?, refs = '[]', contact = ?,
           preview_html = NULL, checks = NULL, approved_hash = NULL, approved_by = NULL, note = NULL,
           utm = NULL, final_stats = ?, updated_at = ? WHERE id = ?`,
        json({ role: "", company: "" }),
        json({ hero: "", intro: "", whyUs: "", caseStudyIntro: "", cta: "" }),
        json({ name: "", email: "" }),
        stats ? json(stats) : cur.finalStats ? json(cur.finalStats) : null,
        now,
        id,
      );
      for (const t of ["snapshots", "edits", "approvals"])
        this.sql.exec(`DELETE FROM ${t} WHERE page_id = ?`, id);
    });
    return true;
  }

  // ---- operations: backups, switch-off, rights ----

  exportAll(): Snapshot {
    return exportTables(this.sql, SNAPSHOT_TABLES);
  }

  /** Replace the whole store from a snapshot. All or nothing. */
  importAll(data: unknown): number {
    return replaceTables(this.ctx.storage, SNAPSHOT_TABLES, data);
  }

  /** Every page that is public now, to take offline. */
  published(limit: number): PageRecord[] {
    return this.sql
      .exec("SELECT * FROM pages WHERE status = 'published' ORDER BY id LIMIT ?", limit)
      .toArray()
      .map(toRecord);
  }

  /** The pages one person owns, and the pages of others that name them as the contact. */
  ofPerson(ids: string[], emails: string[]): { owned: PageRecord[]; named: PageRecord[] } {
    const mail = new Set(emails.map(lower).filter(Boolean));
    const all = this.sql.exec("SELECT * FROM pages ORDER BY id").toArray().map(toRecord);
    const owned = all.filter((p) => ids.includes(p.owner) || mail.has(lower(p.ownerEmail)));
    const own = new Set(owned.map((p) => p.id));
    const named = all.filter((p) => !own.has(p.id) && mail.has(lower(p.contact.email)));
    return { owned, named };
  }

  /**
   * Right to erasure. The person's own pages go with everything on them (the prospect's data, the copy, the
   * review trail). A page of someone else that names them as its contact loses that contact, goes offline
   * when it was public and needs a new approval. Their ids in edits and approvals become the pseudonym.
   * The caller has already taken the public objects down.
   */
  erasePerson(
    ids: string[],
    emails: string[],
    pseudonym: string,
    now: number,
  ): { removed: number; redacted: number } {
    const { owned, named } = this.ofPerson(ids, emails);
    const mail = emails.map(lower).filter(Boolean);
    this.ctx.storage.transactionSync(() => {
      for (const p of owned) {
        for (const t of ["pages", "snapshots", "edits", "approvals"])
          this.sql.exec(`DELETE FROM ${t} WHERE ${t === "pages" ? "id" : "page_id"} = ?`, p.id);
      }
      for (const p of named) {
        this.sql.exec(
          `UPDATE pages SET contact = ?, status = CASE status WHEN 'published' THEN 'unpublished'
             WHEN 'in_review' THEN 'draft' WHEN 'approved' THEN 'draft' ELSE status END,
             checks = NULL, approved_hash = NULL, approved_by = NULL, preview_html = NULL,
             updated_at = ? WHERE id = ?`,
          json({ name: pseudonym, email: "" }),
          now,
          p.id,
        );
      }
      // Earlier revisions of other people's pages may still name them as the contact.
      for (const row of this.sql
        .exec("SELECT page_id, revision, snapshot FROM snapshots")
        .toArray()) {
        const snap = parse<{ contact?: Contact } | null>(row.snapshot, null);
        if (snap?.contact && mail.includes(lower(snap.contact.email)))
          this.sql.exec(
            "UPDATE snapshots SET snapshot = ? WHERE page_id = ? AND revision = ?",
            json({ ...snap, contact: { name: pseudonym, email: "" } }),
            row.page_id,
            row.revision,
          );
      }
      for (const id of ids) {
        this.sql.exec("UPDATE edits SET actor_id = ? WHERE actor_id = ?", pseudonym, id);
        this.sql.exec("UPDATE approvals SET actor_id = ? WHERE actor_id = ?", pseudonym, id);
        this.sql.exec("UPDATE pages SET approved_by = ? WHERE approved_by = ?", pseudonym, id);
      }
      for (const m of mail)
        this.sql.exec(
          "UPDATE edits SET actor_email = ? WHERE lower(actor_email) = ?",
          pseudonym,
          m,
        );
    });
    return { removed: owned.length, redacted: named.length };
  }

  /** Every slug the store knows, to take the public objects down before a reset. */
  slugs(): string[] {
    return this.sql
      .exec("SELECT slug FROM pages WHERE slug IS NOT NULL")
      .toArray()
      .map((r) => r.slug as string);
  }

  /** A dev reseed starts from an empty store. */
  wipe(): number {
    let n = 0;
    this.ctx.storage.transactionSync(() => {
      for (const t of SNAPSHOT_TABLES) n += this.sql.exec(`DELETE FROM ${t}`).rowsWritten;
    });
    return n;
  }
}
