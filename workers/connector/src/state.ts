// ConnectorState: one Durable Object per tenant (EU jurisdiction). SQLite holds the source registry,
// delta cursors, local SourceRecords and the per-user permission cache. No file content lives here:
// text extracts go to the target Workspace, and binary types never leave Graph.

import { DurableObject } from "cloudflare:workers";
import type { AclEntry, Cursor, LocalRecord, SourceDef, Store } from "./types.ts";

const emptyCursor = (sourceId: string): Cursor => ({
  sourceId,
  deltaLink: null,
  nextLink: null,
  full: false,
  gen: 0,
  lastSyncAt: null,
  lastFullAt: null,
  lastError: null,
});

export class ConnectorState extends DurableObject<Env> implements Store {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS cursors (source_id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (
          item_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL,
          drive_item_id TEXT NOT NULL, parent_id TEXT, gen INTEGER NOT NULL, json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS records_source ON records (source_id, gen);
        CREATE INDEX IF NOT EXISTS records_parent ON records (source_id, parent_id);
        CREATE TABLE IF NOT EXISTS nonces (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS acl (
          item_id TEXT NOT NULL, user_key TEXT NOT NULL, allowed INTEGER NOT NULL,
          checked_at INTEGER NOT NULL, PRIMARY KEY (item_id, user_key));
      `);
    });
  }

  // ---- registry ----

  putSource(def: SourceDef): void {
    this.sql.exec(
      "INSERT INTO sources (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
      def.id,
      JSON.stringify(def),
    );
  }

  getSource(id: string): SourceDef | null {
    const r = this.sql.exec("SELECT json FROM sources WHERE id = ?", id).toArray()[0];
    return r ? (JSON.parse(r.json as string) as SourceDef) : null;
  }

  listSources(): SourceDef[] {
    return this.sql
      .exec("SELECT json FROM sources ORDER BY id")
      .toArray()
      .map((r) => JSON.parse(r.json as string) as SourceDef);
  }

  deleteSource(id: string): void {
    this.sql.exec("DELETE FROM sources WHERE id = ?", id);
    this.sql.exec("DELETE FROM cursors WHERE source_id = ?", id);
  }

  // ---- cursors ----

  getCursor(sourceId: string): Cursor {
    const r = this.sql.exec("SELECT json FROM cursors WHERE source_id = ?", sourceId).toArray()[0];
    return r ? (JSON.parse(r.json as string) as Cursor) : emptyCursor(sourceId);
  }

  setCursor(c: Cursor): void {
    this.sql.exec(
      "INSERT INTO cursors (source_id, json) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET json = excluded.json",
      c.sourceId,
      JSON.stringify(c),
    );
  }

  // ---- records ----

  getRecord(itemId: string): LocalRecord | null {
    const r = this.sql.exec("SELECT json FROM records WHERE item_id = ?", itemId).toArray()[0];
    return r ? (JSON.parse(r.json as string) as LocalRecord) : null;
  }

  putRecord(r: LocalRecord): void {
    this.sql.exec(
      `INSERT INTO records (item_id, source_id, kind, drive_item_id, parent_id, gen, json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET kind = excluded.kind, parent_id = excluded.parent_id,
         gen = excluded.gen, json = excluded.json`,
      r.itemId,
      r.sourceId,
      r.kind,
      r.driveItemId,
      r.parentId,
      r.gen,
      JSON.stringify(r),
    );
  }

  touchRecord(itemId: string, gen: number): void {
    const rec = this.getRecord(itemId);
    if (rec) this.putRecord({ ...rec, gen });
  }

  /** Item ids (this item and its descendants) in one source. A folder's children point at its drive item id. */
  private tree(itemId: string): { itemId: string; kind: string }[] {
    const root = this.getRecord(itemId);
    if (!root) return [];
    const out: { itemId: string; kind: string }[] = [{ itemId, kind: root.kind }];
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift() as LocalRecord;
      if (cur.kind !== "folder") continue;
      const kids = this.sql
        .exec(
          "SELECT json FROM records WHERE source_id = ? AND parent_id = ?",
          cur.sourceId,
          cur.driveItemId,
        )
        .toArray()
        .map((r) => JSON.parse(r.json as string) as LocalRecord);
      for (const k of kids) {
        out.push({ itemId: k.itemId, kind: k.kind });
        queue.push(k);
      }
    }
    return out;
  }

  listTree(itemId: string): string[] {
    return this.tree(itemId)
      .filter((r) => r.kind === "file")
      .map((r) => r.itemId);
  }

  deleteTree(itemId: string): void {
    this.ctx.storage.transactionSync(() => {
      for (const r of this.tree(itemId)) {
        this.sql.exec("DELETE FROM records WHERE item_id = ?", r.itemId);
        this.sql.exec("DELETE FROM acl WHERE item_id = ?", r.itemId);
      }
    });
  }

  listOlder(sourceId: string, gen: number): { itemId: string; kind: "file" | "folder" }[] {
    return this.sql
      .exec("SELECT item_id, kind FROM records WHERE source_id = ? AND gen < ?", sourceId, gen)
      .toArray()
      .map((r) => ({ itemId: r.item_id as string, kind: r.kind as "file" | "folder" }));
  }

  deleteBySource(sourceId: string): string[] {
    const ids = this.sql
      .exec("SELECT item_id, kind FROM records WHERE source_id = ?", sourceId)
      .toArray();
    this.ctx.storage.transactionSync(() => {
      for (const r of ids) this.sql.exec("DELETE FROM acl WHERE item_id = ?", r.item_id as string);
      this.sql.exec("DELETE FROM records WHERE source_id = ?", sourceId);
      this.sql.exec("DELETE FROM cursors WHERE source_id = ?", sourceId);
    });
    return ids.filter((r) => r.kind === "file").map((r) => r.item_id as string);
  }

  countRecords(sourceId: string): number {
    return this.sql
      .exec("SELECT COUNT(*) AS n FROM records WHERE source_id = ? AND kind = 'file'", sourceId)
      .one().n as number;
  }

  listFiles(sourceId: string, limit: number): LocalRecord[] {
    return this.sql
      .exec(
        "SELECT json FROM records WHERE source_id = ? AND kind = 'file' ORDER BY item_id LIMIT ?",
        sourceId,
        limit,
      )
      .toArray()
      .map((r) => JSON.parse(r.json as string) as LocalRecord);
  }

  // ---- permission cache ----

  getAcl(itemId: string, userKey: string): AclEntry | null {
    const r = this.sql
      .exec(
        "SELECT allowed, checked_at FROM acl WHERE item_id = ? AND user_key = ?",
        itemId,
        userKey,
      )
      .toArray()[0];
    return r ? { allowed: r.allowed === 1, checkedAt: r.checked_at as number } : null;
  }

  putAcl(itemId: string, userKey: string, e: AclEntry): void {
    this.sql.exec(
      `INSERT INTO acl (item_id, user_key, allowed, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id, user_key) DO UPDATE SET allowed = excluded.allowed, checked_at = excluded.checked_at`,
      itemId,
      userKey,
      e.allowed ? 1 : 0,
      e.checkedAt,
    );
  }

  deleteAclFor(itemId: string): void {
    this.sql.exec("DELETE FROM acl WHERE item_id = ?", itemId);
  }

  /** Replay cache for the signed calls from the API: true the first time a key is seen inside its TTL. */
  nonceFirst(key: string, now: number, ttlMs: number): boolean {
    this.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);
    return (
      this.sql
        .exec(
          "INSERT OR IGNORE INTO nonces (key, expires_at) VALUES (?, ?) RETURNING key",
          key,
          now + ttlMs,
        )
        .toArray().length === 1
    );
  }
}

export const stateStub = (env: Env, tenantId: string): DurableObjectStub<ConnectorState> => {
  const off = (env.DO_JURISDICTION as string) === "off" && env.ENVIRONMENT === "dev";
  const ns = off ? env.CONNECTOR_STATE : env.CONNECTOR_STATE.jurisdiction("eu");
  return ns.get(ns.idFromName(tenantId));
};
