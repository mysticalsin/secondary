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
