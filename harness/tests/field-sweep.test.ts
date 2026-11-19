/**
 * The daily field sweep drops an orphan page's values and, on a live page,
 * only the key that is past its retention.
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
const DAY = 86_400_000;
const workspaceSpecifier = "../../src/worker/workspace.ts";

type Workspace = {
  brainPurgeFields(now: number): number;
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

test("the daily field sweep clears an orphan page and only the expired key on a live page", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  db.prepare("INSERT INTO wiki_meta (key, value) VALUES ('brain_fields', ?)").run(
    JSON.stringify([
      { key: "note", retentionDays: 30 },
      { key: "keep", retentionDays: 30 },
    ]),
  );
  db.prepare(
    `INSERT INTO wiki_pages (id, type, title, markdown, summary, revision, status, created_at, updated_at)
     VALUES ('live', 'concept', 'Live', 'Keep', '', 1, 'published', 1, 1)`,
  ).run();
  const insert = db.prepare(
    "INSERT INTO brain_fields (page_id, field_key, value, written_by, written_at) VALUES (?, ?, ?, 'ada', ?)",
  );
  insert.run("live", "note", "SECRET-EXPIRED", NOW - 31 * DAY);
  insert.run("live", "keep", "KEEP-LIVE", NOW);
  insert.run("orphan", "note", "SECRET-ORPHAN", NOW);
  insert.run("orphan", "keep", "SECRET-ORPHAN-OLD", NOW - 31 * DAY);
  const first = ws.brainPurgeFields(NOW);
  const second = ws.brainPurgeFields(NOW);
  const left = db
    .prepare("SELECT page_id, field_key, value FROM brain_fields ORDER BY page_id, field_key")
    .all()
    .map((row) => ({ ...(row as { page_id: string; field_key: string; value: string }) }));
  assert.deepEqual(
    { first, second, left },
    { first: 2, second: 0, left: [{ page_id: "live", field_key: "keep", value: "KEEP-LIVE" }] },
  );
  db.close();
});
