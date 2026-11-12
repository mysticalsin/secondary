/**
 * A non-finite cutoff is no cutoff. A classified draft stays, and the purge deletes nothing.
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

test("a non-finite draft cutoff keeps the draft and deletes nothing", async () => {
  const db = new DatabaseSync(":memory:");
  const ws = await openWorkspace(db);
  const item = db.prepare(
    `INSERT INTO items (id, label, kind, plane, origin, status, revision, author_id, tags, body, created_at, updated_at)
     VALUES (?, 'draft page', 'personalitem', 'PERSONAL', 'human', 'published', 1, 'user_1', '["draft"]', ?, 1, 1)`,
  );
  item.run("inf", "SECRET-INF");
  item.run("nan", "SECRET-NAN");
  const infinite = ws.purgeExpired({ draft: Number.POSITIVE_INFINITY });
  const againInfinite = ws.purgeExpired({ draft: Number.POSITIVE_INFINITY });
  const nan = ws.purgeExpired({ draft: Number.NaN });
  const againNan = ws.purgeExpired({ draft: Number.NaN });
  const ids = db
    .prepare("SELECT id FROM items ORDER BY id")
    .all()
    .map((row) => (row as { id: string }).id);
  assert.deepEqual(
    { infinite, againInfinite, nan, againNan, ids },
    { infinite: 0, againInfinite: 0, nan: 0, againNan: 0, ids: ["inf", "nan"] },
  );
  db.close();
});
