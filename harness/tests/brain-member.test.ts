/**
 * Brain member on the real BrainBase.
 * A set writes only from the state it read. Two concurrent sets produce one row and one log.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type SetResult = { ok: true; state: string } | { ok: false; code: string };

type Store = {
  brainMemberSet(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
  ): SetResult;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-member-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function prepare(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, claim_key TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
}

async function openStore(file: string): Promise<{ store: Store; db: DatabaseSync }> {
  const db = openSqlite(file);
  prepare(db);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Store } };
  const store = Object.create(mod.BrainBase.prototype) as Store & { sql: SqlStorage };
  store.sql = sql;
  return { store, db };
}

function logs(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM wiki_log WHERE kind = 'brain.member'").get() as { n: number }).n;
}

test("brain member: an unknown stored state is refused and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'legacy', 'bea', ?)",
    ).run(NOW - 1);
    const set = store.brainMemberSet("ada", "owner", "active", "cy", NOW);
    assert.equal(set.ok, false);
    if (!set.ok) assert.equal(set.code, "state_unreadable");
    const row = db.prepare("SELECT role, state, added_by, at FROM brain_members WHERE principal_id = 'ada'").get() as {
      role: string;
      state: string;
      added_by: string;
      at: number;
    };
    assert.deepEqual(
      { role: row.role, state: row.state, added_by: row.added_by, at: row.at },
      { role: "reader", state: "legacy", added_by: "bea", at: NOW - 1 },
    );
    assert.equal(logs(db), 0);
    db.close();
  } finally {
    remove();
  }
});

test("brain member: two setters of one pending member produce one active row and one log", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    prepare(db);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'pending', 'bea', ?)",
    ).run(NOW - 1);
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string, role: string) =>
      new Promise<SetResult>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/brain-member-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, id: "ada", actor, role, now: NOW, barrier },
        });
        worker.once("message", (value: SetResult) => resolve(value));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("bea", "owner"), run("cy", "steward")]);
    const codes = [a, b].map((result) => (result.ok ? "active" : result.code)).sort();
    assert.deepEqual(codes, ["active", "replay"]);
    const check = openSqlite(file);
    const row = check.prepare("SELECT role, state FROM brain_members WHERE principal_id = 'ada'").get() as {
      role: string;
      state: string;
    };
    assert.equal(row.state, "active");
    assert.ok(row.role === "owner" || row.role === "steward");
    assert.equal(logs(check), 1);
    check.close();
  } finally {
    remove();
  }
});
