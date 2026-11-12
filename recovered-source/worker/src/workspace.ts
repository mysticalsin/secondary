// Workspace: one Durable Object per scope (personal:<userId>, global, or a department, circle,
// account or region id), named per tenant. SQLite holds the items with revision and conflict
// detection, comments, review candidates, approvals, a label search index (FTS5) and an outbox.
// It makes no access decisions about who may call it: the API checks packages/policy first and
// only addresses workspaces the caller's admitted view reaches. It does enforce the invariants
// that belong to the data: exact revision, one approval per person, no self-approval.

import { claimRelease, commitItem } from "../../../src/state/item-release.ts";
import { replaceName } from "../../../src/state/pseudonym-text.ts";
import { commitQuorum } from "../../../src/state/quorum.ts";
import { readUserValidated } from "../../../src/state/user-validated.ts";
import { BrainBase } from "./brains/store.ts";
import { exportTables, replaceTables, type Snapshot } from "./ops-snapshot.ts";
import { personalKindOf } from "./personal-kind.ts";
import type { SensitivityFlag } from "./sensitivity.ts";
import { WIKI_TABLES, type WikiBase } from "./wiki/store.ts";
import { isWikiKind } from "./wiki/types.ts";

export type Origin = "seed" | "personal" | "candidate" | "record";
export type ReleaseTarget = "scope" | "global";
export type UserValidated = { by: string; at: string; revision: number };

export type SeedRow = {
  id: string;
  label: string;
  kind: string;
  plane: string;
  status: string;
  revision: number;
  authorId: string | null;
  tags: string[];
  reviewedBy2: boolean;
};

export type ItemRecord = {
  id: string;
  label: string;
  kind: string;
  plane: string;
  origin: Origin;
  status: string;
  revision: number;
  authorId: string | null;
  tags: string[];
  body: string | null;
  targetNode: string | null;
  releaseTarget: ReleaseTarget;
  userValidated: UserValidated | { tag: "unreadable" } | null;
  sensitivityFlags: SensitivityFlag[];
  reviewedBy2: boolean;
  /** Distinct approvers of the current revision, and how many the release needs. */
  approvals: number;
  required: number;
  createdAt: number;
  updatedAt: number;
};

export type NewItem = {
  id: string;
  label: string;
  kind: string;
  plane: string;
  origin: Exclude<Origin, "seed">;
  status: string;
  authorId: string;
  body: string | null;
  tags?: string[];
  targetNode?: string | null;
  releaseTarget?: ReleaseTarget;
  userValidated?: UserValidated | null;
  sensitivityFlags?: SensitivityFlag[];
};

export type RecentEntry = {
  id: string;
  label: string;
  revision: number;
  at: number;
  targetNode: string | null;
  kind: string;
};

/** A file synced from a connector (SharePoint/OneDrive). Text extract only for UTF-8 text and Markdown. */
export type SourceItem = {
  id: string;
  sourceId: string;
  /** Policy node a reader needs at content level before the item is even considered. */
  gateNodeId: string;
  plane: string;
  title: string;
  body: string | null;
  webUrl: string | null;
  mime: string | null;
  size: number;
  eTag: string;
  syncedAt: number;
};
export type RevisionEntry = {
  revision: number;
  label: string;
  body: string | null;
  actorId: string | null;
  at: number;
};
export type DecisionEntry = { actorId: string; kind: string; verdict: string | null; at: number };

export type Comment = { id: number; itemId: string; authorId: string; text: string; at: number };

export type Fail = {
  ok: false;
  code:
    | "not_found"
    | "conflict"
    | "self_approval"
    | "not_author"
    | "not_pending"
    | "replay"
    | "already_done"
    | "invalid_status"
    | "revision_required"
    | "generated_page"
    | "exists"
    | "archived"
    | "state_unreadable"
    | "clock_unreadable"
    | "not_archived"
    | "absent"
    | "not_draft";
  message: string;
  currentRevision?: number;
};
export type EditResult = { ok: true; revision: number; status: string } | Fail;
export type ReviewResult = { ok: true; revision: number } | Fail;
export type ApproveResult =
  | { ok: true; released: boolean; approvals: number; required: number; revision: number }
  | Fail;

/** Tables that make up a Workspace snapshot. The search index is included so a restore matches the original. */
const SNAPSHOT_TABLES = [
  "items",
  "items_fts",
  "comments",
  "approvals",
  "edits",
  "contributions",
  "outbox",
  ...WIKI_TABLES,
] as const;

const requiredFor = (releaseTarget: string, plane: string): number =>
  releaseTarget === "global" || plane === "GLOBAL_NONPERSONAL" ? 2 : 1;

function personalTags(raw: unknown): { tag: "ok"; tags: string[] } | { tag: "unreadable" } {
  if (typeof raw !== "string") return { tag: "unreadable" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string"))
      return { tag: "unreadable" };
    return { tag: "ok", tags: parsed };
  } catch {
    return { tag: "unreadable" };
  }
}

function wholeWord(text: string, at: number, token: string): boolean {
  if (token === "" || !text.startsWith(token, at)) return false;
  const before = at === 0 || !/[A-Za-z0-9_]/.test(text[at - 1] ?? "");
  const end = at + token.length;
  const after = end >= text.length || !/[A-Za-z0-9_]/.test(text[end] ?? "");
  return before && after;
}

/** Replace a name of any length when it stands as its own word. A second pass finds it gone. */
function boundedName(text: string, from: string, to: string): string {
  if (from === "" || from === to) return text;
  const first = from.length >= to.length ? from : to;
  const second = first === from ? to : from;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (wholeWord(text, i, first)) {
      out += first === from ? to : first;
      i += first.length;
      continue;
    }
    if (second !== "" && wholeWord(text, i, second)) {
      out += second === from ? to : second;
      i += second.length;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function storedValidation(raw: unknown): UserValidated | { tag: "unreadable" } | null {
  const read = readUserValidated(raw);
  if (read.tag === "ok") return read.value;
  if (read.tag === "unreadable") return { tag: "unreadable" };
  return null;
}

export class Workspace extends BrainBase {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, plane TEXT NOT NULL,
          origin TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
          author_id TEXT, tags TEXT NOT NULL DEFAULT '[]', body TEXT,
          target_node TEXT, release_target TEXT NOT NULL DEFAULT 'scope',
          user_validated TEXT, sensitivity_flags TEXT NOT NULL DEFAULT '[]',
          reviewed_by_2 INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS items_status ON items (status, origin);
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(label, id UNINDEXED);
        CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, author_id TEXT NOT NULL,
          text TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS comments_item ON comments (item_id);
        CREATE TABLE IF NOT EXISTS approvals (
          item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
          kind TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT,
          PRIMARY KEY (item_id, revision, actor_id, kind));
        CREATE TABLE IF NOT EXISTS edits (
          item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS edits_item ON edits (item_id, actor_id);
        CREATE TABLE IF NOT EXISTS contributions (
          item_id TEXT NOT NULL, scope_id TEXT NOT NULL, candidate_id TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS contributions_item ON contributions (item_id);
        CREATE TABLE IF NOT EXISTS source_items (
          id TEXT PRIMARY KEY, source_id TEXT NOT NULL, gate_node_id TEXT NOT NULL, plane TEXT NOT NULL,
          title TEXT NOT NULL, body TEXT, web_url TEXT, mime TEXT, size INTEGER NOT NULL,
          etag TEXT NOT NULL, synced_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS source_items_source ON source_items (source_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(title, body, id UNINDEXED);
        CREATE TABLE IF NOT EXISTS revisions (
          item_id TEXT NOT NULL, revision INTEGER NOT NULL, label TEXT NOT NULL, body TEXT,
          actor_id TEXT, at INTEGER NOT NULL, PRIMARY KEY (item_id, revision));
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
          created_at INTEGER NOT NULL, dispatched INTEGER NOT NULL DEFAULT 0);
      `);
    });
  }

  // ---- seeding ----

  /** Upsert seed rows. With `reset`, every table is emptied first (dev seed). */
  seed(rows: SeedRow[], reset: boolean, now: number): number {
    this.ctx.storage.transactionSync(() => {
      if (reset)
        for (const t of [
          "items",
          "items_fts",
          "comments",
          "approvals",
          "edits",
          "outbox",
          "contributions",
          "revisions",
        ])
          this.sql.exec(`DELETE FROM ${t}`);
      if (reset) this.wikiReset();
      for (const r of rows) {
        this.sql.exec(
          `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags,
             reviewed_by_2, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'seed', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET label = excluded.label, kind = excluded.kind,
             plane = excluded.plane, status = excluded.status, revision = excluded.revision,
             author_id = excluded.author_id, tags = excluded.tags,
             reviewed_by_2 = excluded.reviewed_by_2, updated_at = excluded.updated_at`,
          r.id,
          r.label,
          r.kind,
          r.plane,
          r.status,
          r.revision,
          r.authorId,
          JSON.stringify(r.tags),
          r.reviewedBy2 ? 1 : 0,
          now,
          now,
        );
        this.reindex(r.id, r.label);
      }
    });
    return rows.length;
  }

  private reindex(id: string, label: string): void {
    this.sql.exec("DELETE FROM items_fts WHERE id = ?", id);
    this.sql.exec("INSERT INTO items_fts (label, id) VALUES (?, ?)", label, id);
  }

  // ---- connector items (source-backed, read-time permission checked by the API) ----

  /** Idempotent upsert keyed by item id. An unchanged eTag is a no-op, so a replayed sync page changes nothing. */
  sourceUpsert(rows: SourceItem[]): number {
    let changed = 0;
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const cur = this.sql
          .exec("SELECT etag, source_id FROM source_items WHERE id = ?", r.id)
          .toArray()[0];
        if (cur && cur.etag === r.eTag && cur.source_id === r.sourceId) continue;
        this.sql.exec(
          `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, web_url, mime, size, etag, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, gate_node_id = excluded.gate_node_id,
             plane = excluded.plane, title = excluded.title, body = excluded.body, web_url = excluded.web_url,
             mime = excluded.mime, size = excluded.size, etag = excluded.etag, synced_at = excluded.synced_at`,
          r.id,
          r.sourceId,
          r.gateNodeId,
          r.plane,
          r.title,
          r.body,
          r.webUrl,
          r.mime,
          r.size,
          r.eTag,
          r.syncedAt,
        );
        this.sql.exec("DELETE FROM source_fts WHERE id = ?", r.id);
        this.sql.exec(
          "INSERT INTO source_fts (title, body, id) VALUES (?, ?, ?)",
          r.title,
          r.body ?? "",
          r.id,
        );
        changed++;
      }
    });
    return changed;
  }

  /** Deletion propagation: the row and its search entry go together. */
  sourceDelete(ids: string[]): number {
    let n = 0;
    this.ctx.storage.transactionSync(() => {
      for (const id of ids) {
        n += this.sql
          .exec("DELETE FROM source_items WHERE id = ? RETURNING id", id)
          .toArray().length;
        this.sql.exec("DELETE FROM source_fts WHERE id = ?", id);
      }
      // Derived knowledge goes with its source (M-02).
      this.wikiForgetSources(ids, Date.now());
    });
    return n;
  }

  /** A source was removed or disabled: drop everything it put here. */
  sourcePurge(sourceId: string): number {
    const ids = this.sql
      .exec("SELECT id FROM source_items WHERE source_id = ?", sourceId)
      .toArray()
      .map((r) => r.id as string);
    return this.sourceDelete(ids);
  }

  private sourceRow(r: Record<string, SqlStorageValue>): SourceItem {
    return {
      id: r.id as string,
      sourceId: r.source_id as string,
      gateNodeId: r.gate_node_id as string,
      plane: r.plane as string,
      title: r.title as string,
      body: (r.body as string | null) ?? null,
      webUrl: (r.web_url as string | null) ?? null,
      mime: (r.mime as string | null) ?? null,
      size: r.size as number,
      eTag: r.etag as string,
      syncedAt: r.synced_at as number,
    };
  }

  sourceGet(id: string): SourceItem | null {
    const row = this.sql.exec("SELECT * FROM source_items WHERE id = ?", id).toArray()[0];
    return row ? this.sourceRow(row) : null;
  }

  /** `match` is an FTS5 expression built by the API from sanitised tokens. Never returns bodies. */
  sourceSearch(
    match: string,
    limit: number,
    offset = 0,
  ): { id: string; rank: number; title: string; plane: string; gateNodeId: string }[] {
    return this.sql
      .exec(
        `SELECT f.id AS id, bm25(source_fts) AS rank, s.title AS title, s.plane AS plane, s.gate_node_id AS gate
         FROM source_fts f JOIN source_items s ON s.id = f.id
         WHERE source_fts MATCH ? ORDER BY rank, f.id LIMIT ? OFFSET ?`,
        match,
        limit,
        offset,
      )
      .toArray()
      .map((r) => ({
        id: r.id as string,
        rank: r.rank as number,
        title: r.title as string,
        plane: r.plane as string,
        gateNodeId: r.gate as string,
      }));
  }

  // ---- reads ----

  /** `match` is an FTS5 expression built by the API from sanitised tokens. */
  search(match: string, limit: number, offset = 0): { id: string; rank: number }[] {
    return this.sql
      .exec(
        `SELECT id, bm25(items_fts) AS rank FROM items_fts WHERE items_fts MATCH ?
         ORDER BY rank, id LIMIT ? OFFSET ?`,
        match,
        limit,
        offset,
      )
      .toArray()
      .map((r) => ({ id: r.id as string, rank: r.rank as number }));
  }

  private record(r: Record<string, SqlStorageValue>): ItemRecord {
    const id = r.id as string;
    const revision = r.revision as number;
    const releaseTarget = r.release_target as ReleaseTarget;
    const approvals = this.sql
      .exec(
        "SELECT COUNT(*) AS n FROM approvals WHERE item_id = ? AND revision = ? AND kind = 'approve'",
        id,
        revision,
      )
      .one().n as number;
    return {
      id,
      label: r.label as string,
      kind: r.kind as string,
      plane: r.plane as string,
      origin: r.origin as Origin,
      status: r.status as string,
      revision,
      authorId: (r.author_id as string | null) ?? null,
      tags: JSON.parse(r.tags as string) as string[],
      body: (r.body as string | null) ?? null,
      targetNode: (r.target_node as string | null) ?? null,
      releaseTarget,
      userValidated: storedValidation(r.user_validated),
      sensitivityFlags: JSON.parse(r.sensitivity_flags as string) as SensitivityFlag[],
      reviewedBy2: r.reviewed_by_2 === 1,
      approvals,
      required: requiredFor(releaseTarget, r.plane as string),
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  get(id: string): ItemRecord | null {
    const row = this.sql.exec("SELECT * FROM items WHERE id = ?", id).toArray()[0];
    return row ? this.record(row) : null;
  }

  listByKind(kind: string, limit: number): ItemRecord[] {
    return this.sql
      .exec("SELECT * FROM items WHERE kind = ? ORDER BY created_at DESC, id LIMIT ?", kind, limit)
      .toArray()
      .map((r) => this.record(r));
  }

  /** Items waiting for review or release: seeded candidates and contributed ones. */
  pending(limit: number): ItemRecord[] {
    return this.sql
      .exec(
        "SELECT * FROM items WHERE status = 'candidate' AND origin != 'personal' ORDER BY created_at, id LIMIT ?",
        limit,
      )
      .toArray()
      .map((r) => this.record(r));
  }

  comments(itemId: string, limit: number): Comment[] {
    return this.sql
      .exec("SELECT * FROM comments WHERE item_id = ? ORDER BY id DESC LIMIT ?", itemId, limit)
      .toArray()
      .map((r) => ({
        id: r.id as number,
        itemId: r.item_id as string,
        authorId: r.author_id as string,
        text: r.text as string,
        at: r.at as number,
      }));
  }

  // ---- writes ----

  create(n: NewItem, now: number): ItemRecord | Fail {
    if (this.sql.exec("SELECT 1 FROM items WHERE id = ?", n.id).toArray().length)
      return { ok: false, code: "exists", message: "Item id already exists" };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, body,
           target_node, release_target, user_validated, sensitivity_flags, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        n.id,
        n.label,
        n.kind,
        n.plane,
        n.origin,
        n.status,
        n.authorId,
        n.body,
        n.targetNode ?? null,
        n.releaseTarget ?? "scope",
        n.userValidated ? JSON.stringify(n.userValidated) : null,
        JSON.stringify(n.sensitivityFlags ?? []),
        JSON.stringify(n.tags ?? []),
        now,
        now,
      );
      this.snapshot(n.id, 1, n.label, n.body, n.authorId, now);
      if (n.origin === "candidate")
        this.outbox("candidate.created", { id: n.id, target: n.targetNode ?? null }, now);
    });
    return this.get(n.id) as ItemRecord;
  }

  // ---- revision history (B2 UX) ----

  private snapshot(
    id: string,
    revision: number,
    label: string,
    body: string | null,
    actor: string | null,
    now: number,
  ): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO revisions (item_id, revision, label, body, actor_id, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      revision,
      label,
      body,
      actor,
      now,
    );
  }

  /** Keep the state being replaced, so seeded items have a "before" the first time they change. */
  private keepPrevious(rec: ItemRecord): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO revisions (item_id, revision, label, body, actor_id, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      rec.id,
      rec.revision,
      rec.label,
      rec.body,
      rec.authorId,
      rec.updatedAt,
    );
  }

  /** Every stored revision of an item, newest first. Seeded items have none until they are edited. */
  history(id: string): RevisionEntry[] {
    return this.sql
      .exec("SELECT * FROM revisions WHERE item_id = ? ORDER BY revision DESC", id)
      .toArray()
      .map((r) => ({
        revision: r.revision as number,
        label: r.label as string,
        body: (r.body as string | null) ?? null,
        actorId: (r.actor_id as string | null) ?? null,
        at: r.at as number,
      }));
  }

  /**
   * UX write path for owner items and account records: a new revision (with a snapshot) for a
   * title, body, status or tag change. No author rules here, the API has already decided who may
   * call it. The expected revision still guards against a stale tab.
   */
  update(
    id: string,
    expected: number,
    patch: { title?: string; body?: string; status?: string; tags?: string[] },
    now: number,
    actorId: string,
  ): EditResult {
    const rec = this.load(id, expected);
    if ("ok" in rec) return rec;
    const label = patch.title ?? rec.label;
    const body = patch.body ?? rec.body;
    const step = commitItem({ status: rec.status }, { type: "update", status: patch.status ?? null });
    if (!step.ok)
      return {
        ok: false,
        code: "invalid_status",
        message: "That status cannot be set from here",
      };
    const status = step.state.status;
    const tags = patch.tags ?? rec.tags;
    const revision = rec.revision + 1;
    this.ctx.storage.transactionSync(() => {
      this.keepPrevious(rec);
      this.sql.exec(
        `UPDATE items SET label = ?, body = ?, status = ?, tags = ?, revision = ?, reviewed_by_2 = 0, updated_at = ?
         WHERE id = ?`,
        label,
        body,
        status,
        JSON.stringify(tags),
        revision,
        now,
        id,
      );
      this.snapshot(id, revision, label, body, actorId, now);
      this.outbox("record.updated", { id, revision }, now);
    });
    return { ok: true, revision, status };
  }

  /**
   * Working copies (drafts, preferences): replace in place, no revision. Never a candidate, never
   * listed with the owner's notes (their own kind).
   */
  scratch(n: NewItem, now: number): ItemRecord {
    this.ctx.storage.transactionSync(() => {
      const had = this.sql.exec("SELECT 1 FROM items WHERE id = ?", n.id).toArray().length > 0;
      if (had)
        this.sql.exec(
          "UPDATE items SET label = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?",
          n.label,
          n.body,
          JSON.stringify(n.tags ?? []),
          now,
          n.id,
        );
      else this.create(n, now);
    });
    return this.get(n.id) as ItemRecord;
  }

  /** Tags are metadata. Changing them is not a new revision. */
  retag(id: string, tags: string[]): boolean {
    const had = this.sql.exec("SELECT 1 FROM items WHERE id = ?", id).toArray().length > 0;
    if (had) this.sql.exec("UPDATE items SET tags = ? WHERE id = ?", JSON.stringify(tags), id);
    return had;
  }

  /** Delete one item and everything that hangs off it in this workspace. */
  remove(id: string): boolean {
    const had = this.sql.exec("SELECT 1 FROM items WHERE id = ?", id).toArray().length > 0;
    if (!had) return false;
    this.ctx.storage.transactionSync(() => {
      for (const t of ["comments", "approvals", "edits", "contributions", "revisions"])
        this.sql.exec(`DELETE FROM ${t} WHERE item_id = ?`, id);
      this.sql.exec("DELETE FROM items_fts WHERE id = ?", id);
      this.sql.exec("DELETE FROM items WHERE id = ?", id);
      this.wikiForgetSources([id], Date.now());
    });
    return true;
  }

  /** Reviewer decisions on one revision (request changes) and approvals, for the review thread. */
  decisions(id: string, revision: number): DecisionEntry[] {
    return this.sql
      .exec(
        "SELECT actor_id, kind, verdict, at FROM approvals WHERE item_id = ? AND revision = ? ORDER BY at",
        id,
        revision,
      )
      .toArray()
      .map((r) => ({
        actorId: r.actor_id as string,
        kind: r.kind as string,
        verdict: (r.verdict as string | null) ?? null,
        at: r.at as number,
      }));
  }

  private outbox(kind: string, payload: Record<string, unknown>, now: number): void {
    this.sql.exec(
      "INSERT INTO outbox (kind, payload, created_at) VALUES (?, ?, ?)",
      kind,
      JSON.stringify(payload),
      now,
    );
  }

  /** Personal Brain: remember where an item was contributed (the candidate id, never the content). */
  addContribution(itemId: string, scopeId: string, candidateId: string, now: number): void {
    this.sql.exec(
      "INSERT INTO contributions (item_id, scope_id, candidate_id, at) VALUES (?, ?, ?, ?)",
      itemId,
      scopeId,
      candidateId,
      now,
    );
  }

  contributions(itemId: string): { scopeId: string; candidateId: string; at: number }[] {
    return this.sql
      .exec(
        "SELECT scope_id, candidate_id, at FROM contributions WHERE item_id = ? ORDER BY at",
        itemId,
      )
      .toArray()
      .map((r) => ({
        scopeId: r.scope_id as string,
        candidateId: r.candidate_id as string,
        at: r.at as number,
      }));
  }

  /** Recent edits and releases, newest first. Contributions awaiting review are not activity. */
  recent(limit: number): RecentEntry[] {
    return this.sql
      .exec(
        `SELECT o.id AS oid, o.kind AS okind, o.created_at AS at, i.id, i.label, i.revision, i.target_node
         FROM outbox o JOIN items i ON i.id = json_extract(o.payload, '$.id')
         WHERE o.kind IN ('item.released', 'item.edited') ORDER BY o.id DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((r) => ({
        id: r.id as string,
        label: r.label as string,
        revision: r.revision as number,
        at: r.at as number,
        targetNode: (r.target_node as string | null) ?? null,
        kind: r.okind as string,
      }));
  }

  outboxPending(limit: number): { id: number; kind: string; payload: string }[] {
    return this.sql
      .exec("SELECT id, kind, payload FROM outbox WHERE dispatched = 0 ORDER BY id LIMIT ?", limit)
      .toArray()
      .map((r) => ({ id: r.id as number, kind: r.kind as string, payload: r.payload as string }));
  }

  /** Comments hang off any node id the API has already admitted; they need no item row. */
  comment(itemId: string, authorId: string, text: string, now: number): Comment {
    const id = this.sql
      .exec(
        "INSERT INTO comments (item_id, author_id, text, at) VALUES (?, ?, ?, ?) RETURNING id",
        itemId,
        authorId,
        text,
        now,
      )
      .one().id as number;
    return { id, itemId, authorId, text, at: now };
  }

  private load(id: string, expected: number): ItemRecord | Fail {
    const rec = this.get(id);
    if (!rec) return { ok: false, code: "not_found", message: "No such item" };
    // Wiki proposals are decided through the wiki review (it applies the diff), never as plain items.
    if (isWikiKind(rec.kind))
      return {
        ok: false,
        code: "not_pending",
        message: "Wiki proposals are decided in the wiki review",
      };
    if (rec.revision !== expected)
      return {
        ok: false,
        code: "conflict",
        message: "The item changed. Reload and retry with the current revision",
        currentRevision: rec.revision,
      };
    return rec;
  }

  /** Edit with `expected_previous_revision`. An edit starts a new revision with no approvals. */
  edit(
    id: string,
    expectedPreviousRevision: number,
    patch: { title?: string; body?: string },
    now: number,
    actorId: string,
  ): EditResult {
    const rec = this.load(id, expectedPreviousRevision);
    if ("ok" in rec) return rec;
    // H1: only the contributor changes a candidate. Anyone else comments or requests changes, so a
    // steward cannot rewrite a colleague's contribution and then release it.
    if (rec.origin === "candidate" && rec.authorId !== actorId)
      return {
        ok: false,
        code: "not_author",
        message: "Only the contributor can edit a candidate. Comment or request changes instead.",
      };
    // An approved item that changes goes back to review. Drafts and candidates keep their status.
    const edited = commitItem({ status: rec.status }, { type: "edit" });
    if (!edited.ok)
      return { ok: false, code: "not_pending", message: "The item is not awaiting review" };
    const status = edited.state.status;
    const label = patch.title ?? rec.label;
    const body = patch.body ?? rec.body;
    const revision = rec.revision + 1;
    this.ctx.storage.transactionSync(() => {
      this.keepPrevious(rec);
      this.sql.exec(
        `UPDATE items SET label = ?, body = ?, status = ?, revision = ?, reviewed_by_2 = 0, updated_at = ?
         WHERE id = ?`,
        label,
        body,
        status,
        revision,
        now,
        id,
      );
      this.sql.exec(
        "INSERT INTO edits (item_id, revision, actor_id, at) VALUES (?, ?, ?, ?)",
        id,
        revision,
        actorId,
        now,
      );
      if (rec.origin === "seed") this.reindex(id, label);
      this.snapshot(id, revision, label, body, actorId, now);
      this.outbox("item.edited", { id, revision }, now);
    });
    return { ok: true, revision, status };
  }

  /** The contributor and anyone who edited the item count as its authors, on every revision. */
  private authored(rec: ItemRecord, ids: string[]): boolean {
    if (rec.authorId !== null && ids.includes(rec.authorId)) return true;
    return (
      this.sql
        .exec(
          `SELECT 1 FROM edits WHERE item_id = ? AND actor_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
          rec.id,
          ...ids,
        )
        .toArray().length > 0
    );
  }

  review(
    id: string,
    expected: number,
    actorId: string,
    verdict: string,
    now: number,
    /** Every principal id of the same human (N-01). */
    sameHuman: string[] = [],
  ): ReviewResult {
    const rec = this.load(id, expected);
    if ("ok" in rec) return rec;
    if (this.authored(rec, [actorId, ...sameHuman]))
      return {
        ok: false,
        code: "self_approval",
        message: "You wrote or edited this item, so you cannot review it",
      };
    if (rec.status !== "candidate")
      return { ok: false, code: "not_pending", message: "The item is not awaiting review" };
    this.sql.exec(
      `INSERT INTO approvals (item_id, revision, actor_id, kind, at, verdict) VALUES (?, ?, ?, 'review', ?, ?)
       ON CONFLICT(item_id, revision, actor_id, kind) DO UPDATE SET at = excluded.at, verdict = excluded.verdict`,
      id,
      rec.revision,
      actorId,
      now,
      verdict,
    );
    return { ok: true, revision: rec.revision };
  }

  /**
   * Approve one exact revision. The contributor never counts. A release needs distinct approvers:
   * one for a scope release, two when the item is released to Company Global.
   */
  approve(
    id: string,
    expected: number,
    actorId: string,
    now: number,
    /** Every principal id of the same human, so one person cannot count as two approvers (N-01). */
    sameHuman: string[] = [],
  ): ApproveResult {
    const rec = this.load(id, expected);
    if ("ok" in rec) return rec;
    const ids = [actorId, ...sameHuman];
    if (this.authored(rec, ids))
      return {
        ok: false,
        code: "self_approval",
        message:
          "Self-approval blocked: you wrote or edited this item, so a different person must approve it",
      };
    if (rec.status !== "candidate")
      return { ok: false, code: "not_pending", message: "The item is not awaiting release" };
    if (
      this.sql
        .exec(
          `SELECT 1 FROM approvals WHERE item_id = ? AND revision = ? AND kind = 'approve'
           AND actor_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
          id,
          rec.revision,
          ...ids,
        )
        .toArray().length
    )
      return { ok: false, code: "already_done", message: "You already approved this revision" };
    const prior = this.sql
      .exec(
        "SELECT actor_id FROM approvals WHERE item_id = ? AND revision = ? AND kind = 'approve'",
        id,
        rec.revision,
      )
      .toArray()
      .map((r) => r.actor_id as string);
    const requester = prior[0];
    const asked = commitQuorum(
      requester
        ? {
            tag: "waiting",
            requester: { id: requester, subject: null, email: null, directoryEmail: null },
            requestedAt: rec.updatedAt,
          }
        : { tag: "empty" },
      {
        type: "ask",
        actor: { id: actorId, subject: null, email: null, directoryEmail: null },
        now,
      },
    );
    if (!asked.ok)
      return { ok: false, code: "not_pending", message: "The item is not awaiting release" };
    const decided = commitItem(
      { status: rec.status },
      {
        type: "approve",
        quorum: { tag: asked.decision },
        required: rec.required,
        approvals: prior.length,
      },
    );
    if (!decided.ok)
      return { ok: false, code: "not_pending", message: "The item is not awaiting release" };
    let result: ApproveResult = {
      ok: false,
      code: "not_pending",
      message: "The item is not awaiting release",
    };
    this.ctx.storage.transactionSync(() => {
      const inserted = this.sql
        .exec(
          `INSERT OR IGNORE INTO approvals (item_id, revision, actor_id, kind, at) VALUES (?, ?, ?, 'approve', ?)
           RETURNING actor_id`,
          id,
          rec.revision,
          actorId,
          now,
        )
        .toArray();
      if (!inserted.length) {
        result = { ok: false, code: "already_done", message: "You already approved this revision" };
        return;
      }
      const approvals = prior.length + 1;
      const claim = decided.effects.find((effect) => effect.type === "claim_release");
      if (!claim) {
        result = { ok: true, released: false, approvals, required: rec.required, revision: rec.revision };
        return;
      }
      const matched = this.sql
        .exec(
          "UPDATE items SET status = ?, reviewed_by_2 = ?, updated_at = ? WHERE id = ? AND status = ? RETURNING id",
          claim.to,
          approvals >= 2 ? 1 : 0,
          now,
          id,
          claim.from,
        )
        .toArray().length;
      if (claimRelease(matched).tag !== "released") {
        result = { ok: false, code: "replay", message: "The release was already taken" };
        return;
      }
      this.outbox("item.released", { id, revision: rec.revision, approvals }, now);
      result = { ok: true, released: true, approvals, required: rec.required, revision: rec.revision };
    });
    if (!result.ok && result.code === "replay") {
      console.warn(JSON.stringify({ at: "item_release", reason: "replay" }));
    }
    return result;
  }

  // ---- operations: snapshots, rights, retention ----

  exportAll(): Snapshot {
    return exportTables(this.sql, SNAPSHOT_TABLES);
  }

  /** Replace everything in this workspace from a snapshot. All or nothing. */
  importAll(data: unknown): number {
    return replaceTables(this.ctx.storage, SNAPSHOT_TABLES, data);
  }

  /** Everything a person authored here, for the data subject export. */
  authoredBy(principalId: string): {
    items: ItemRecord[];
    comments: Comment[];
    approvals: { itemId: string; revision: number; kind: string; at: number }[];
    edits: { itemId: string; revision: number; at: number }[];
    wiki: ReturnType<WikiBase["wikiAuthoredBy"]>;
  } {
    return {
      wiki: this.wikiAuthoredBy(principalId),
      items: this.sql
        .exec("SELECT * FROM items WHERE author_id = ? ORDER BY created_at, id", principalId)
        .toArray()
        .map((r) => this.record(r)),
      comments: this.sql
        .exec("SELECT * FROM comments WHERE author_id = ? ORDER BY id", principalId)
        .toArray()
        .map((r) => ({
          id: r.id as number,
          itemId: r.item_id as string,
          authorId: r.author_id as string,
          text: r.text as string,
          at: r.at as number,
        })),
      approvals: this.sql
        .exec(
          "SELECT item_id, revision, kind, at FROM approvals WHERE actor_id = ? ORDER BY at",
          principalId,
        )
        .toArray()
        .map((r) => ({
          itemId: r.item_id as string,
          revision: r.revision as number,
          kind: r.kind as string,
          at: r.at as number,
        })),
      edits: this.sql
        .exec("SELECT item_id, revision, at FROM edits WHERE actor_id = ? ORDER BY at", principalId)
        .toArray()
        .map((r) => ({
          itemId: r.item_id as string,
          revision: r.revision as number,
          at: r.at as number,
        })),
    };
  }

  /**
   * Derived stores that erasure owns in one place: the proposal snapshot review serves,
   * source text and source search, a purged item's revisions, and fields of a deleted page.
   */
  override wikiForgetSources(
    ids: string[],
    now: number,
  ): { facts: number; pages: number; proposals: number; ids: string[] } {
    const before = this.sql
      .exec("SELECT id FROM wiki_pages")
      .toArray()
      .map((row) => String(row.id));
    const out = super.wikiForgetSources(ids, now);
    const removed = before.filter(
      (id) => this.sql.exec("SELECT id FROM wiki_pages WHERE id = ?", id).toArray().length === 0,
    );
    this.forgetDerived({ type: "source", ids: out.ids, removedPages: removed });
    return out;
  }

  private forgetDerived(
    op:
      | { type: "source"; ids: string[]; removedPages: string[] }
      | { type: "items"; ids: string[] }
      | { type: "person"; from: string; to: string; aliases: string[] },
  ): void {
    if (op.type === "items") {
      for (const id of op.ids) this.sql.exec("DELETE FROM revisions WHERE item_id = ?", id);
      return;
    }
    if (op.type === "source") {
      for (const id of op.ids) {
        const item = this.sql.exec("SELECT label, body FROM items WHERE id = ?", id).toArray()[0];
        if (!item) continue;
        const label = String(item.label);
        const body = item.body === null || item.body === undefined ? null : String(item.body);
        for (const rev of this.sql
          .exec("SELECT revision, label, body FROM revisions WHERE item_id = ?", id)
          .toArray()) {
          const revBody = rev.body === null || rev.body === undefined ? null : String(rev.body);
          if (String(rev.label) === label && revBody === body) continue;
          this.sql.exec(
            "UPDATE revisions SET label = ?, body = ? WHERE item_id = ? AND revision = ?",
            label,
            body,
            id,
            rev.revision as number,
          );
        }
      }
      for (const pageId of op.removedPages)
        this.sql.exec("DELETE FROM brain_fields WHERE page_id = ?", pageId);
      return;
    }
    const names = [
      ...new Set([op.from, ...op.aliases].map((name) => name.trim()).filter((name) => name.length > 0)),
    ];
    const sources = new Set<string>();
    for (const name of names) {
      for (const row of this.sql
        .exec("SELECT id, text FROM comments WHERE instr(text, ?) > 0", name)
        .toArray()) {
        const text = boundedName(String(row.text ?? ""), name, op.to);
        if (text === String(row.text ?? "")) continue;
        this.sql.exec("UPDATE comments SET text = ? WHERE id = ?", text, row.id as number);
      }
      for (const row of this.sql
        .exec(
          "SELECT id, label, body FROM items WHERE instr(label, ?) > 0 OR instr(COALESCE(body, ''), ?) > 0",
          name,
          name,
        )
        .toArray()) {
        const label = boundedName(String(row.label ?? ""), name, op.to);
        const current = row.body === null || row.body === undefined ? null : String(row.body);
        const body = current === null ? null : boundedName(current, name, op.to);
        if (label === String(row.label ?? "") && body === current) continue;
        const id = row.id as string;
        this.sql.exec("UPDATE items SET label = ?, body = ? WHERE id = ?", label, body, id);
        if (label !== String(row.label ?? "") && this.sql.exec("SELECT id FROM items_fts WHERE id = ?", id).toArray().length)
          this.reindex(id, label);
      }
      for (const row of this.sql
        .exec(
          "SELECT id, title, body FROM source_items WHERE instr(title, ?) > 0 OR instr(COALESCE(body, ''), ?) > 0",
          name,
          name,
        )
        .toArray()) {
        const title = boundedName(String(row.title ?? ""), name, op.to);
        const current = row.body === null || row.body === undefined ? null : String(row.body);
        const body = current === null ? null : boundedName(current, name, op.to);
        if (title === String(row.title ?? "") && body === current) continue;
        this.sql.exec(
          "UPDATE source_items SET title = ?, body = ? WHERE id = ?",
          title,
          body,
          row.id as string,
        );
        sources.add(row.id as string);
      }
      for (const row of this.sql
        .exec("SELECT page_id, field_key, value FROM brain_fields WHERE instr(value, ?) > 0", name)
        .toArray()) {
        const value = boundedName(String(row.value ?? ""), name, op.to);
        if (value === String(row.value ?? "")) continue;
        this.sql.exec(
          "UPDATE brain_fields SET value = ? WHERE page_id = ? AND field_key = ?",
          value,
          row.page_id as string,
          row.field_key as string,
        );
      }
    }
    for (const id of sources) {
      const row = this.sql.exec("SELECT title, body FROM source_items WHERE id = ?", id).toArray()[0];
      if (!row) continue;
      this.sql.exec("DELETE FROM source_fts WHERE id = ?", id);
      this.sql.exec(
        "INSERT INTO source_fts (title, body, id) VALUES (?, ?, ?)",
        String(row.title ?? ""),
        row.body === null || row.body === undefined ? "" : String(row.body),
        id,
      );
    }
  }

  /**
   * Replace a person's id with a pseudonym everywhere this workspace stores it, and drop the search
   * index entries of the items they authored. A seeded item stays indexed, and the name in that
   * label is rewritten. Any other authored row is dropped from search.
   */
  pseudonymise(
    from: string,
    to: string,
    aliases: string[] = [],
  ): { items: number; comments: number; approvals: number; edits: number } {
    let out = { items: 0, comments: 0, approvals: 0, edits: 0 };
    this.ctx.storage.transactionSync(() => {
      const names = [
        ...new Set([from, ...aliases].map((x) => x.trim()).filter((x) => x.length >= 3)),
      ];
      for (const r of this.sql
        .exec("SELECT id FROM items WHERE author_id = ? AND origin != 'seed'", from)
        .toArray())
        this.sql.exec("DELETE FROM items_fts WHERE id = ?", r.id as string);
      for (const name of names) {
        for (const row of this.sql
          .exec(
            `SELECT f.id AS id, f.label AS label FROM items_fts f
             JOIN items i ON i.id = f.id
             WHERE i.origin = 'seed' AND instr(f.label, ?) > 0`,
            name,
          )
          .toArray()) {
          const label = replaceName(String(row.label ?? ""), name, to);
          if (label === String(row.label ?? "")) continue;
          this.reindex(row.id as string, label);
        }
      }
      const count = (t: string, col: string) =>
        this.sql.exec(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`, from).one().n as number;
      out = {
        items: count("items", "author_id"),
        comments: count("comments", "author_id"),
        approvals: count("approvals", "actor_id"),
        edits: count("edits", "actor_id"),
      };
      this.sql.exec("UPDATE items SET author_id = ? WHERE author_id = ?", to, from);
      this.sql.exec("UPDATE comments SET author_id = ? WHERE author_id = ?", to, from);
      this.sql.exec("UPDATE approvals SET actor_id = ? WHERE actor_id = ?", to, from);
      this.sql.exec("UPDATE edits SET actor_id = ? WHERE actor_id = ?", to, from);
      this.sql.exec("UPDATE revisions SET actor_id = ? WHERE actor_id = ?", to, from);
      for (const name of names) {
        for (const row of this.sql
          .exec(
            "SELECT item_id, revision, label, body FROM revisions WHERE instr(label, ?) > 0 OR instr(COALESCE(body, ''), ?) > 0",
            name,
            name,
          )
          .toArray()) {
          const label = replaceName(String(row.label ?? ""), name, to);
          const body = row.body === null ? null : replaceName(String(row.body), name, to);
          if (label === String(row.label ?? "") && body === row.body) continue;
          this.sql.exec(
            "UPDATE revisions SET label = ?, body = ? WHERE item_id = ? AND revision = ?",
            label,
            body,
            row.item_id as string,
            row.revision as number,
          );
        }
      }
      this.wikiPseudonymise(from, to, aliases);
      this.forgetDerived({ type: "person", from, to, aliases });
      for (const r of this.sql
        .exec("SELECT id, user_validated FROM items WHERE user_validated IS NOT NULL")
        .toArray()) {
        const read = readUserValidated(r.user_validated);
        if (read.tag === "unreadable") {
          if (from !== "" && String(r.user_validated ?? "").includes(from))
            this.sql.exec("UPDATE items SET user_validated = NULL WHERE id = ?", r.id as string);
          continue;
        }
        if (read.tag !== "ok" || read.value.by !== from) continue;
        this.sql.exec(
          "UPDATE items SET user_validated = ? WHERE id = ?",
          JSON.stringify({ ...read.value, by: to }),
          r.id as string,
        );
      }
    });
    return out;
  }

  /** Delete everything in this workspace (a person's Personal Brain). Returns the number of items removed. */
  wipe(): number {
    let n = 0;
    this.ctx.storage.transactionSync(() => {
      n = this.sql.exec("SELECT COUNT(*) AS n FROM items").one().n as number;
      for (const t of [...SNAPSHOT_TABLES, "revisions", "source_items", "source_fts"] as const)
        this.sql.exec(`DELETE FROM ${t}`);
    });
    return n;
  }

  /**
   * Retention: delete Personal Brain items of the given kinds that were last changed before the
   * cutoff for their kind. `cutoffs` maps a kind (draft, brief) to a timestamp in ms.
   * An unreadable tags cell is removed as well, and the other rows continue.
   */
  purgeExpired(cutoffs: Record<string, number>): number {
    let n = 0;
    const purged: string[] = [];
    this.ctx.storage.transactionSync(() => {
      const rows = this.sql
        .exec("SELECT id, label, tags, updated_at FROM items WHERE kind = 'personalitem'")
        .toArray();
      for (const r of rows) {
        const tags = personalTags(r.tags);
        if (tags.tag === "ok") {
          const kind = personalKindOf(r.label as string, tags.tags);
          const cutoff = cutoffs[kind];
          if (cutoff === undefined || (r.updated_at as number) >= cutoff) continue;
        }
        const id = r.id as string;
        purged.push(id);
        for (const [t, col] of [
          ["items", "id"],
          ["items_fts", "id"],
          ["comments", "item_id"],
          ["approvals", "item_id"],
          ["edits", "item_id"],
          ["contributions", "item_id"],
        ] as const)
          this.sql.exec(`DELETE FROM ${t} WHERE ${col} = ?`, id);
        n++;
      }
      // What the personal wiki learned from a purged note goes with it (M-02).
      this.forgetDerived({ type: "items", ids: purged });
      this.wikiForgetSources(purged, Date.now());
    });
    return n;
  }
}
