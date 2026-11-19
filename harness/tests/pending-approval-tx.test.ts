/**
 * A pending approval and its log line commit together.
 * A log failure leaves no approval row.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../src/worker/wiki/store.ts";

type Wiki = {
  sql: SqlStorage;
  ctx: { storage: { transactionSync: <T>(fn: () => T) => T } };
  get(id: string): unknown;
  wikiMeta(): { scopeId: string; tenantId: string } | null;
  proposalHash(item: { id: string; revision: number; body: string | null }): Promise<string>;
  wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
    opts: { revisionHash?: string },
  ): Promise<{ ok: true; status: string } | { ok: false; code: string; message: string }>;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "pending-approval-"));
  return {
    file: path.join(dir, "wiki.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openWiki(file: string): Promise<{ db: DatabaseSync; wiki: Wiki }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE approvals (
      item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT,
      PRIMARY KEY (item_id, revision, actor_id, kind));
    CREATE TABLE edits (item_id TEXT NOT NULL, actor_id TEXT NOT NULL);
    CREATE TRIGGER fail_approval_log BEFORE INSERT ON wiki_log
    WHEN NEW.kind LIKE '%.approval'
    BEGIN
      SELECT RAISE(ABORT, 'log failed');
    END;
  `);
  const mod = (await import(storeSpecifier)) as { WikiBase: { prototype: Wiki } };
  const wiki = Object.create(mod.WikiBase.prototype) as Wiki;
  wiki.sql = sqliteStorage(db);
  wiki.ctx = {
    storage: {
      transactionSync<T>(fn: () => T): T {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
  };
  return { db, wiki };
}

test("pending approval: a log failure after the insert leaves no approval row", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, wiki } = await openWiki(file);
    const proposal = {
      v: 1,
      kind: "wiki_ingest",
      title: "Home",
      rationale: "",
      origin: "human",
      pages: [],
      facts: [],
      invalidate: [],
      confirm: [],
      archive: [],
      reingest: [],
      sources: [],
      findingKey: null,
    };
    const item = {
      id: "prop_1",
      label: "Home",
      kind: "wiki_ingest",
      plane: "internal",
      origin: "human",
      status: "candidate",
      revision: 1,
      authorId: "bea",
      tags: [],
      body: JSON.stringify(proposal),
      targetNode: null,
      releaseTarget: null,
      userValidated: null,
      sensitivityFlags: [],
      reviewedBy2: false,
      approvals: 0,
      required: 2,
      createdAt: NOW,
      updatedAt: NOW,
    };
    wiki.get = (id: string) => (id === item.id ? item : null);
    wiki.wikiMeta = () => ({ scopeId: "team:mantu", tenantId: "ten" });
    const hash = await wiki.proposalHash(item);
    await assert.rejects(() => wiki.wikiDecide(item.id, "approve", "ada", NOW, { revisionHash: hash }));
    const row = db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number };
    assert.equal({ ...row }.n, 0);
    db.close();
  } finally {
    remove();
  }
});
