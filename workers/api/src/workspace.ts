// Workspace: one Durable Object per scope (personal:<userId>, global, or a department, circle,
// account or region id), named per tenant. SQLite holds the items with revision and conflict
// detection, comments, review candidates, approvals, a label search index (FTS5) and an outbox.
// It makes no access decisions about who may call it: the API checks packages/policy first and
// only addresses workspaces the caller's admitted view reaches. It does enforce the invariants
// that belong to the data: exact revision, one approval per person, no self-approval.

import { DurableObject } from "cloudflare:workers";
import type { SensitivityFlag } from "./sensitivity.ts";

export type Origin = "seed" | "personal" | "candidate";
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
  userValidated: UserValidated | null;
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

export type Comment = { id: number; itemId: string; authorId: string; text: string; at: number };

export type Fail = {
  ok: false;
  code: "not_found" | "conflict" | "self_approval" | "not_pending" | "already_done" | "exists";
  message: string;
  currentRevision?: number;
};
export type EditResult = { ok: true; revision: number; status: string } | Fail;
export type ReviewResult = { ok: true; revision: number } | Fail;
export type ApproveResult =
  | { ok: true; released: boolean; approvals: number; required: number; revision: number }
  | Fail;

const requiredFor = (releaseTarget: string, plane: string): number =>
  releaseTarget === "global" || plane === "GLOBAL_NONPERSONAL" ? 2 : 1;

export class Workspace extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
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
        CREATE TABLE IF NOT EXISTS contributions (
          item_id TEXT NOT NULL, scope_id TEXT NOT NULL, candidate_id TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS contributions_item ON contributions (item_id);
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
        for (const t of ["items", "items_fts", "comments", "approvals", "outbox", "contributions"])
          this.sql.exec(`DELETE FROM ${t}`);
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

  // ---- reads ----

  /** `match` is an FTS5 expression built by the API from sanitised tokens. */
  search(match: string, limit: number): { id: string; rank: number }[] {
    return this.sql
      .exec(
        `SELECT id, bm25(items_fts) AS rank FROM items_fts WHERE items_fts MATCH ?
         ORDER BY rank, id LIMIT ?`,
        match,
        limit,
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
      userValidated: r.user_validated
        ? (JSON.parse(r.user_validated as string) as UserValidated)
        : null,
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
      if (n.origin === "candidate")
        this.outbox("candidate.created", { id: n.id, target: n.targetNode ?? null }, now);
    });
    return this.get(n.id) as ItemRecord;
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
  ): EditResult {
    const rec = this.load(id, expectedPreviousRevision);
    if ("ok" in rec) return rec;
    // An approved item that changes goes back to review. Drafts and candidates keep their status.
    const status = rec.status === "approved" ? "candidate" : rec.status;
    const label = patch.title ?? rec.label;
    const body = patch.body ?? rec.body;
    const revision = rec.revision + 1;
    this.ctx.storage.transactionSync(() => {
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
      if (rec.origin === "seed") this.reindex(id, label);
      this.outbox("item.edited", { id, revision }, now);
    });
    return { ok: true, revision, status };
  }

  review(
    id: string,
    expected: number,
    actorId: string,
    verdict: string,
    now: number,
  ): ReviewResult {
    const rec = this.load(id, expected);
    if ("ok" in rec) return rec;
    if (rec.authorId === actorId)
      return {
        ok: false,
        code: "self_approval",
        message: "You cannot review your own contribution",
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
  approve(id: string, expected: number, actorId: string, now: number): ApproveResult {
    const rec = this.load(id, expected);
    if ("ok" in rec) return rec;
    if (rec.authorId === actorId)
      return {
        ok: false,
        code: "self_approval",
        message: "Self-approval blocked: a second person must approve this contribution",
      };
    if (rec.status !== "candidate")
      return { ok: false, code: "not_pending", message: "The item is not awaiting release" };
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
    if (!inserted.length)
      return { ok: false, code: "already_done", message: "You already approved this revision" };
    const approvals = rec.approvals + 1;
    const released = approvals >= rec.required;
    if (released) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE items SET status = 'approved', reviewed_by_2 = ?, updated_at = ? WHERE id = ?",
          approvals >= 2 ? 1 : 0,
          now,
          id,
        );
        this.outbox("item.released", { id, revision: rec.revision, approvals }, now);
      });
    }
    return { ok: true, released, approvals, required: rec.required, revision: rec.revision };
  }
}
