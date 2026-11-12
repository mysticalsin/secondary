/**
 * One unreadable tags cell must not abort the personal purge.
 * That row is removed, and the other rows are still purged.
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

type Workspace = {
  purgeExpired(cutoffs: Record<string, number>): number;
};

async function openWorkspace(db: DatabaseSync): Promise<Workspace> {
  let ready: Promise<unknown> = Promise.resolve();
  let depth = 0;
  const ctx = {
    storage: {
      sql: sqliteStorage(db),
      transactionSync<T>(fn: () => T): T {
        const nested = depth > 0;
        const save = `purge_tx_${depth}`;
        if (nested) db.exec(`SAVEPOINT ${save}`);
        else db.exec("BEGIN");
        depth += 1;
        try {
          const result = fn();
          depth -= 1;
          if (nested) db.exec(`RELEASE ${save}`);
          else db.exec("COMMIT");
          return result;
        } catch (error) {
          depth -= 1;
          if (nested) db.exec(`ROLLBACK TO ${save}`);
          else db.exec("ROLLBACK");
          throw error;
        }
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

test("an unreadable tags cell is removed and the other personal rows are still purged", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES (?, ?, 'personalitem', 'PERSONAL', 'human', 'published', 1, 'user_1', ?, ?, 1, ?)`,
  );
  item.run("old", "draft page", '["draft"]', "SECRET-NOTE", 1);
  item.run("bad", "Broken", "not-json", "SECRET-BAD", 1);
  item.run("fresh", "Fresh", '["note"]', "kept fresh", NOW);
  let thrown: string | null = null;
  try {
    ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
    ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const ids = db
    .prepare("SELECT id FROM items ORDER BY id")
    .all()
    .map((row) => (row as { id: string }).id);
  assert.deepEqual({ thrown, ids }, { thrown: null, ids: ["fresh"] });
  db.close();
});

test("retention keeps a recent unreadable cell, deletes an old one, and keeps notes", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES (?, ?, 'personalitem', 'PERSONAL', 'human', 'published', 1, 'user_1', ?, ?, 1, ?)`,
  );
  item.run("recent", "Broken recent", "not-json", "SECRET-RECENT", NOW);
  item.run("stale", "Broken old", "not-json", "SECRET-OLD", 1);
  item.run("note", "Private note", '["note"]', "KEEP-NOTE", 1);
  item.run("draft", "draft page", '["draft"]', "OLD-DRAFT", 1);
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  let purged = 0;
  let second = 0;
  try {
    purged = ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
    second = ws.purgeExpired({ note: 1_000, brief: 1_000, draft: 1_000, view: 1_000 });
  } finally {
    console.warn = original;
  }
  const ids = db
    .prepare("SELECT id FROM items ORDER BY id")
    .all()
    .map((row) => (row as { id: string }).id);
  const logged = warnings.map((line) => JSON.parse(line) as { at?: string; id?: string });
  assert.deepEqual(
    {
      purged,
      second,
      ids,
      logged,
      leaked: warnings.some(
        (line) => line.includes("SECRET") || line.includes("Broken") || line.includes("Private") || line.includes("not-json"),
      ),
    },
    {
      purged: 2,
      second: 0,
      ids: ["note", "recent"],
      logged: [
        { at: "retention", id: "recent" },
        { at: "retention", id: "recent" },
      ],
      leaked: false,
    },
  );
  db.close();
});

test("retention deletes an unreadable cell only when it is older than every cutoff", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const day = 86_400_000;
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES (?, ?, 'personalitem', 'PERSONAL', 'human', 'published', 1, 'user_1', 'not-json', ?, 1, ?)`,
  );
  item.run("d100", "Broken hundred", "SECRET-100", NOW - 100 * day);
  item.run("d60", "Broken sixty", "SECRET-60", NOW - 60 * day);
  item.run("d10", "Broken ten", "SECRET-10", NOW - 10 * day);
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  let purged = 0;
  let second = 0;
  try {
    const cutoffs = { draft: NOW - 90 * day, brief: NOW - 30 * day };
    purged = ws.purgeExpired(cutoffs);
    second = ws.purgeExpired(cutoffs);
  } finally {
    console.warn = original;
  }
  const ids = db
    .prepare("SELECT id FROM items ORDER BY id")
    .all()
    .map((row) => (row as { id: string }).id);
  const logged = warnings
    .map((line) => JSON.parse(line) as { at?: string; id?: string })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  assert.deepEqual(
    {
      purged,
      second,
      ids,
      logged,
      leaked: warnings.some((line) => line.includes("SECRET") || line.includes("Broken") || line.includes("not-json")),
    },
    {
      purged: 1,
      second: 0,
      ids: ["d10", "d60"],
      logged: [
        { at: "retention", id: "d10" },
        { at: "retention", id: "d10" },
        { at: "retention", id: "d60" },
        { at: "retention", id: "d60" },
      ],
      leaked: false,
    },
  );
  db.close();
});
