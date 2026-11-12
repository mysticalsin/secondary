/**
 * pending_role and pending_at are added once, for a database that predates them.
 * A second pass leaves the table and every stored value as they are.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { register } from "node:module";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

type Workspace = {
  sql: SqlStorage;
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

function columns(db: DatabaseSync): { name: string; type: string; notnull: number }[] {
  return db
    .prepare("PRAGMA table_info(brain_members)")
    .all()
    .map((column) => {
      const row = column as { name: string; type: string; notnull: number };
      return { name: row.name, type: row.type, notnull: row.notnull };
    });
}

test("brain schema: an old member table gains the pending columns once", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT);
    INSERT INTO brain_members (principal_id, role, state, added_by, at, change_id, claim_key)
    VALUES ('ada', 'reader', 'active', 'bea', 1, 'chg_1', 'mem_old');
  `);
  const workspaceMod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const open = async (): Promise<string> => {
    const { ctx, ready } = openCtx(db);
    try {
      new workspaceMod.Workspace(ctx, { WIKI_ALARMS: "off" });
      await ready();
      return "ok";
    } catch (error) {
      return error instanceof Error ? error.message : "throw";
    }
  };
  const first = await open();
  const afterFirst = {
    columns: columns(db),
    row: {
      ...(db.prepare("SELECT * FROM brain_members WHERE principal_id = 'ada'").get() as Record<string, unknown>),
    },
  };
  const second = await open();
  const afterSecond = {
    columns: columns(db),
    row: {
      ...(db.prepare("SELECT * FROM brain_members WHERE principal_id = 'ada'").get() as Record<string, unknown>),
    },
  };
  assert.deepEqual(
    { first, afterFirst, second, afterSecond },
    {
      first: "ok",
      afterFirst: {
        columns: [
          { name: "principal_id", type: "TEXT", notnull: 0 },
          { name: "role", type: "TEXT", notnull: 1 },
          { name: "state", type: "TEXT", notnull: 1 },
          { name: "added_by", type: "TEXT", notnull: 1 },
          { name: "at", type: "INTEGER", notnull: 1 },
          { name: "change_id", type: "TEXT", notnull: 0 },
          { name: "claim_key", type: "TEXT", notnull: 0 },
          { name: "pending_role", type: "TEXT", notnull: 0 },
          { name: "pending_at", type: "INTEGER", notnull: 0 },
        ],
        row: {
          principal_id: "ada",
          role: "reader",
          state: "active",
          added_by: "bea",
          at: 1,
          change_id: "chg_1",
          claim_key: "mem_old",
          pending_role: null,
          pending_at: null,
        },
      },
      second: "ok",
      afterSecond: {
        columns: [
          { name: "principal_id", type: "TEXT", notnull: 0 },
          { name: "role", type: "TEXT", notnull: 1 },
          { name: "state", type: "TEXT", notnull: 1 },
          { name: "added_by", type: "TEXT", notnull: 1 },
          { name: "at", type: "INTEGER", notnull: 1 },
          { name: "change_id", type: "TEXT", notnull: 0 },
          { name: "claim_key", type: "TEXT", notnull: 0 },
          { name: "pending_role", type: "TEXT", notnull: 0 },
          { name: "pending_at", type: "INTEGER", notnull: 0 },
        ],
        row: {
          principal_id: "ada",
          role: "reader",
          state: "active",
          added_by: "bea",
          at: 1,
          change_id: "chg_1",
          claim_key: "mem_old",
          pending_role: null,
          pending_at: null,
        },
      },
    },
  );
  db.close();
});
