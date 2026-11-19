/**
 * Removing an item drops its revision and its search row.
 * A second call finds nothing to remove.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const workspaceSpecifier = "../../src/worker/workspace.ts";

type Workspace = {
  remove(id: string): boolean;
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

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

test("remove leaves no revision and no search row, and a second call returns false", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES ('note1', 'Note', 'personalitem', 'PERSONAL', 'human', 'draft', 1, 'ada', '["note"]', 'SECRET-NOTE', 1, 1)`,
  ).run();
  db.prepare(
    "INSERT INTO revisions (item_id, revision, label, body, actor_id, at) VALUES ('note1', 1, 'Note', 'SECRET-NOTE', 'ada', 1)",
  ).run();
  db.prepare("INSERT INTO items_fts (label, id) VALUES ('SECRET-NOTE', 'note1')").run();
  const first = ws.remove("note1");
  const second = ws.remove("note1");
  assert.deepEqual(
    {
      first,
      second,
      revisions: count(db, "revisions"),
      search: count(db, "items_fts"),
      item: count(db, "items"),
    },
    { first: true, second: false, revisions: 0, search: 0, item: 0 },
  );
  db.close();
});
