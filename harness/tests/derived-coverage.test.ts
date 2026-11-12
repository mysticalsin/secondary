/**
 * Wipe and the erasure path cover every derived table the schema creates.
 * A new derived table fails this test until both paths clear it.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

const DERIVED = [
  "brain_fields",
  "items_fts",
  "revisions",
  "source_fts",
  "wiki_fts",
  "wiki_page_revisions",
];

type Workspace = {
  wipe(): number;
  wikiForgetSources(ids: string[], now: number): { facts: number; pages: number; proposals: number };
  purgeExpired(cutoffs: Record<string, number>): number;
  pseudonymise(from: string, to: string, aliases?: string[]): {
    items: number;
    comments: number;
    approvals: number;
    edits: number;
  };
};

function openCtx(db: DatabaseSync): { ctx: unknown; ready: () => Promise<unknown> } {
  let ready: Promise<unknown> = Promise.resolve();
  return {
    ctx: {
      storage: {
        sql: sqliteStorage(db),
        transactionSync<T>(fn: () => T): T {
          return fn();
        },
        setAlarm() {},
      },
      blockConcurrencyWhile(fn: () => Promise<unknown>) {
        ready = fn();
        return ready;
      },
    },
    ready: () => ready,
  };
}

async function openWorkspace(db: DatabaseSync): Promise<Workspace> {
  const { ctx, ready } = openCtx(db);
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready();
  return ws;
}

function derivedTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type IN ('table', 'virtual')
           AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE '%\\_data' ESCAPE '\\'
           AND name NOT LIKE '%\\_idx' ESCAPE '\\'
           AND name NOT LIKE '%\\_content' ESCAPE '\\'
           AND name NOT LIKE '%\\_docsize' ESCAPE '\\'
           AND name NOT LIKE '%\\_config' ESCAPE '\\'
           AND (
             name LIKE '%\\_fts' ESCAPE '\\'
             OR name LIKE '%\\_revisions' ESCAPE '\\'
             OR name = 'revisions'
             OR name = 'brain_fields'
           )
         ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function dump(db: DatabaseSync, table: string): string {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
}

test("wipe empties every derived table the schema creates", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const found = derivedTables(db);
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('p', 'note', 'SECRET-FIELD', 'ada', 1)",
  ).run();
  db.prepare("INSERT INTO items_fts (label, id) VALUES ('SECRET-ITEM', 'item')").run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('item', 1, 'SECRET-REV', 'SECRET-REV', 'ada', 1)",
  ).run();
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES ('SECRET-SOURCE', 'SECRET-SOURCE', 'src')").run();
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('SECRET-WIKI', '', 'SECRET-WIKI', 'page')").run();
  db.prepare(
    "INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at) VALUES ('page', 1, 'Page', 'SECRET-PAGE', 'ada', 1)",
  ).run();
  ws.wipe();
  ws.wipe();
  assert.deepEqual(
    { found, left: found.map((table) => count(db, table)) },
    { found: DERIVED, left: DERIVED.map(() => 0) },
  );
  db.close();
});

test("the erasure path clears every derived table the schema creates", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const found = derivedTables(db);
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('kept', 'concept', 'Kept', ?, '', 1, 'published', 1, 1)`,
  ).run("Keep\nSECRET-PAGE {src:src_1}");
  db.prepare(
    "INSERT INTO wiki_page_revisions (page_id, revision, title, markdown, actor, at) VALUES ('kept', 1, 'Kept', ?, 'ada', 1)",
  ).run("Keep\nSECRET-PAGE {src:src_1}");
  db.prepare("INSERT INTO wiki_fts (title, summary, body, id) VALUES ('Kept', '', 'SECRET-PAGE', 'kept')").run();
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('gone', 'concept', 'Gone', '{src:src_1}', '', 1, 'published', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES ('gone', 'note', 'SECRET-FIELD', 'ada', 1)",
  ).run();
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES ('draft1', 'draft page', 'personalitem', 'PERSONAL', 'human', 'draft', 1, 'bea', '["draft"]', 'body', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('draft1', 1, 'draft page', 'SECRET-REV', 'bea', 1)",
  ).run();
  db.prepare("INSERT INTO items_fts (label, id) VALUES ('SECRET-ITEM', 'draft1')").run();
  db.prepare(
    `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, size, etag, synced_at)
     VALUES ('srcrow', 'src', 'gate', 'PERSONAL', 'SECRET-SOURCE', 'body', 1, 'e', 1)`,
  ).run();
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES ('SECRET-SOURCE', 'body', 'srcrow')").run();

  ws.wikiForgetSources(["src_1"], NOW);
  ws.wikiForgetSources(["src_1"], NOW + 1);
  const purged = ws.purgeExpired({ draft: NOW });
  const again = ws.purgeExpired({ draft: NOW });
  ws.pseudonymise("SECRET-SOURCE", "pz_source");
  ws.pseudonymise("SECRET-SOURCE", "pz_source");

  const left = Object.fromEntries(found.map((table) => [table, dump(db, table)]));
  const leaked = found.filter((table) => /SECRET-/.test(left[table] ?? ""));
  assert.deepEqual(
    { found, purged, again, leaked, kept: left.wiki_page_revisions },
    {
      found: DERIVED,
      purged: 1,
      again: 0,
      leaked: [],
      kept: JSON.stringify([
        {
          page_id: "kept",
          revision: 1,
          title: "Kept",
          markdown: "Keep",
          actor: "ada",
          at: 1,
          proposal_id: null,
          hidden_at: null,
          hidden_by: null,
          hidden_reason: null,
        },
      ]),
    },
  );
  db.close();
});
