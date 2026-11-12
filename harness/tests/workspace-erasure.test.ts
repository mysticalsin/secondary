/**
 * Workspace erasure writes: revision text, seed search text, an unreadable
 * validation, and the personal wipe. A second call leaves the same rows.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

type Counts = { items: number; comments: number; approvals: number; edits: number };

type Workspace = {
  pseudonymise(from: string, to: string, aliases?: string[]): Counts;
  wipe(): number;
  get(id: string): { userValidated: unknown } | null;
};

async function openWorkspace(db: DatabaseSync): Promise<Workspace> {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
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
  };
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready;
  return ws;
}

function revisions(db: DatabaseSync): { item_id: string; label: string; body: string | null; actor_id: string | null }[] {
  return db
    .prepare("SELECT item_id, label, body, actor_id FROM revisions ORDER BY item_id")
    .all()
    .map((row) => ({ ...(row as { item_id: string; label: string; body: string | null; actor_id: string | null }) }));
}

test("a revision actor and its text are pseudonymised once", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const insert = db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES (?, 1, ?, ?, ?, 1)",
  );
  insert.run("named", "Notes on Ada", "Ada wrote it", "user_1");
  insert.run("other", "Steady", "Steady note", "other");
  ws.pseudonymise("user_1", "pz_user", ["Ada"]);
  const second = ws.pseudonymise("user_1", "pz_user", ["Ada"]);
  assert.deepEqual(
    { rows: revisions(db), second },
    {
      rows: [
        { item_id: "named", label: "Notes on pz_user", body: "pz_user wrote it", actor_id: "pz_user" },
        { item_id: "other", label: "Steady", body: "Steady note", actor_id: "other" },
      ],
      second: { items: 0, comments: 0, approvals: 0, edits: 0 },
    },
  );
  db.close();
});

test("seed search text is pseudonymised and other search rows are forgotten", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, created_at, updated_at)
     VALUES (?, ?, 'record', 'INTERNAL', ?, 'published', 1, 'user_1', 1, 1)`,
  );
  item.run("seed1", "Notes on Ada", "seed");
  item.run("plain", "Handbook", "seed");
  item.run("mine", "Ada draft", "human");
  const index = db.prepare("INSERT INTO items_fts (label, id) VALUES (?, ?)");
  index.run("Notes on Ada", "seed1");
  index.run("Handbook", "plain");
  index.run("Ada draft", "mine");
  ws.pseudonymise("user_1", "pz_user", ["Ada"]);
  const second = ws.pseudonymise("user_1", "pz_user", ["Ada"]);
  const search = db
    .prepare("SELECT id, label FROM items_fts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; label: string }) }));
  assert.deepEqual(
    { search, second },
    {
      search: [
        { id: "plain", label: "Handbook" },
        { id: "seed1", label: "Notes on pz_user" },
      ],
      second: { items: 0, comments: 0, approvals: 0, edits: 0 },
    },
  );
  db.close();
});

test("an unreadable validation is left unreadable and a real one is rewritten", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, user_validated, created_at, updated_at)
     VALUES (?, 'Item', 'record', 'INTERNAL', 'human', 'published', 1, 'user_1', ?, 1, 1)`,
  );
  const valid = JSON.stringify({ by: "user_1", at: "2020-01-01T00:00:00.000Z", revision: 1 });
  item.run("valid", valid);
  item.run("bad", "not-json");
  item.run("odd", JSON.stringify({ by: 1 }));
  let thrown: string | null = null;
  try {
    ws.pseudonymise("user_1", "pz_user", []);
    ws.pseudonymise("user_1", "pz_user", []);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  let read: unknown = null;
  try {
    read = ws.get("bad")?.userValidated ?? null;
  } catch (e) {
    read = e instanceof Error ? e.name : "threw";
  }
  const stored = db
    .prepare("SELECT id, user_validated FROM items ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; user_validated: string }) }));
  assert.deepEqual(
    { thrown, read, stored },
    {
      thrown: null,
      read: { tag: "unreadable" },
      stored: [
        { id: "bad", user_validated: "not-json" },
        { id: "odd", user_validated: JSON.stringify({ by: 1 }) },
        {
          id: "valid",
          user_validated: JSON.stringify({ by: "pz_user", at: "2020-01-01T00:00:00.000Z", revision: 1 }),
        },
      ],
    },
  );
  db.close();
});

test("a personal wipe removes revisions and source rows, and a second wipe returns 0", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, created_at, updated_at)
     VALUES ('i', 'Ada note', 'personalitem', 'PERSONAL', 'personal', 'draft', 1, 'user_1', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('i', 1, 'Ada note', 'Ada wrote it', 'user_1', 1)",
  ).run();
  db.prepare(
    `INSERT INTO source_items (id, source_id, gate_node_id, plane, title, body, size, etag, synced_at)
     VALUES ('s', 'src_1', 'g', 'PERSONAL', 'Ada file', 'secret', 1, 'e', 1)`,
  ).run();
  db.prepare("INSERT INTO source_fts (title, body, id) VALUES ('Ada file', 'secret', 's')").run();
  const first = ws.wipe();
  const second = ws.wipe();
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.deepEqual(
    {
      first,
      second,
      items: count("items"),
      revisions: count("revisions"),
      sources: count("source_items"),
      sourceSearch: count("source_fts"),
    },
    { first: 1, second: 0, items: 0, revisions: 0, sources: 0, sourceSearch: 0 },
  );
  db.close();
});
