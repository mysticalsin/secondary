/**
 * The approval insert and the release claim are one transaction.
 * A throw between them rolls the approval back, so the same approver can release once.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const workspaceSpecifier = "../../src/worker/workspace.ts";

type Approve = { ok: true; released: boolean } | { ok: false; code: string };

type Workspace = {
  create(item: {
    id: string;
    label: string;
    kind: string;
    plane: string;
    origin: "candidate";
    status: string;
    authorId: string;
    body: string | null;
  }, now: number): { id: string };
  approve(id: string, expected: number, actorId: string, now: number, sameHuman?: string[]): Approve;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "release-tx-"));
  return {
    file: path.join(dir, "workspace.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function approvals(file: string): number {
  const db = openSqlite(file);
  const row = db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number };
  db.close();
  return row.n;
}

function releasedRows(file: string): number {
  const db = openSqlite(file);
  const row = db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'item.released'").get() as { n: number };
  db.close();
  return row.n;
}

async function openThrowing(file: string): Promise<{ ws: Workspace; db: DatabaseSync }> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let inserted = false;
  let thrown = false;
  const gated = {
    exec(query: string, ...bindings: Parameters<SqlStorage["exec"]> extends [string, ...infer B] ? B : never) {
      if (inserted && !thrown && query.includes("UPDATE items SET status")) {
        thrown = true;
        throw new Error("injected between insert and claim");
      }
      const result = sql.exec(query, ...bindings);
      if (query.includes("INSERT OR IGNORE INTO approvals")) inserted = true;
      return result;
    },
  };
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: gated,
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
      setAlarm() {},
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready;
  return { ws, db };
}

test("release claim: a throw between insert and claim rolls back, and the retry releases once", async () => {
  const { file, remove } = tempFile();
  try {
    const { ws, db } = await openThrowing(file);
    ws.create(
      {
        id: "scope",
        label: "Item",
        kind: "candidate",
        plane: "ACCOUNT",
        origin: "candidate",
        status: "candidate",
        authorId: "author",
        body: "body",
      },
      NOW,
    );
    assert.throws(() => ws.approve("scope", 1, "reviewer", NOW, ["reviewer"]), /injected between insert and claim/);
    assert.equal(approvals(file), 0);
    const retry = ws.approve("scope", 1, "reviewer", NOW, ["reviewer"]);
    assert.equal(retry.ok, true);
    if (retry.ok) assert.equal(retry.released, true);
    assert.equal(releasedRows(file), 1);
    assert.equal(approvals(file), 1);
    db.close();
  } finally {
    remove();
  }
});
