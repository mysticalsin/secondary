/**
 * Direct brainMemberDropClaim calls. A null or empty key is state_unreadable.
 * A whitespace-only key is state_unreadable. It writes nothing.
 * Neither path writes.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const storeSpecifier = "../../src/worker/brains/store.ts";

type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type MemberRow = {
  principal_id: string;
  role: string;
  state: string;
  added_by: string;
  at: number;
  change_id: string | null;
  claim_key: string | null;
  pending_role: string | null;
  pending_at: number | null;
};

type Brain = {
  sql: SqlStorage;
  brainMemberDropClaim(
    principalId: string,
    key: string | null,
    previousState: string,
  ): { ok: boolean; code?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-drop-direct-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const SCHEMA = `
  CREATE TABLE brain_members (
    principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
    added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT,
    pending_role TEXT, pending_at INTEGER);
`;

function columns(db: DatabaseSync): Column[] {
  return db.prepare("PRAGMA table_info(brain_members)").all() as Column[];
}

type MasterRow = { type: string; name: string; tbl_name: string; sql: string | null };

function schemaOf(db: DatabaseSync): { master: MasterRow[]; columns: Column[] } {
  return {
    master: db
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
      .all() as MasterRow[],
    columns: columns(db),
  };
}

function members(db: DatabaseSync): MemberRow[] {
  return db
    .prepare(
      `SELECT principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at
       FROM brain_members ORDER BY principal_id`,
    )
    .all() as MemberRow[];
}

async function brainOn(db: DatabaseSync): Promise<Brain> {
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sql;
  return brain;
}

test("brain drop: a null key is state_unreadable and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'active', 'bea', 1, 'chg_1', 'mem_real', NULL, NULL)`,
    ).run();
    const beforeColumns = columns(db);
    const beforeRows = members(db);
    const brain = await brainOn(db);
    const dropped = brain.brainMemberDropClaim("ada", null, "active");
    assert.equal(dropped.ok, false);
    assert.equal(dropped.code, "state_unreadable");
    assert.deepEqual(columns(db), beforeColumns);
    assert.deepEqual(members(db), beforeRows);
    db.close();
  } finally {
    remove();
  }
});

test("brain drop: an empty key is state_unreadable and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'active', 'bea', 1, 'chg_1', 'mem_real', NULL, NULL)`,
    ).run();
    const beforeColumns = columns(db);
    const beforeRows = members(db);
    const brain = await brainOn(db);
    const dropped = brain.brainMemberDropClaim("ada", "", "active");
    assert.equal(dropped.ok, false);
    assert.equal(dropped.code, "state_unreadable");
    assert.deepEqual(columns(db), beforeColumns);
    assert.deepEqual(members(db), beforeRows);
    db.close();
  } finally {
    remove();
  }
});

function seedPendingAndClaimed(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO brain_members
      (principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at)
     VALUES
      ('ada', 'reader', 'active', 'bea', 1, 'chg_pending', 'mem_pending', 'owner', 9),
      ('cy', 'owner', 'claimed', 'bea', 2, NULL, 'mem_claimed', NULL, NULL)`,
  ).run();
}

async function whitespaceKey(label: string, key: string): Promise<void> {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(SCHEMA);
    seedPendingAndClaimed(db);
    const brain = await brainOn(db);
    for (const principal of [
      { id: "ada", previousState: "active" },
      { id: "cy", previousState: "claimed" },
    ]) {
      const beforeSchema = schemaOf(db);
      const beforeRows = members(db);
      const dropped = brain.brainMemberDropClaim(principal.id, key, principal.previousState);
      assert.equal(dropped.ok, false, label);
      assert.equal(dropped.code, "state_unreadable", label);
      assert.deepEqual(schemaOf(db), beforeSchema, label);
      assert.deepEqual(members(db), beforeRows, label);
    }
    db.close();
  } finally {
    remove();
  }
}

test("brain drop: a space key is state_unreadable and writes nothing", async () => {
  await whitespaceKey("space", " ");
});

test("brain drop: a tab key is state_unreadable and writes nothing", async () => {
  await whitespaceKey("tab", "\t");
});

test("brain drop: a newline key is state_unreadable and writes nothing", async () => {
  await whitespaceKey("newline", "\n");
});

test("brain drop: a whitespace key is state_unreadable and writes nothing", async () => {
  await whitespaceKey("whitespace", " \t\n ");
});

test("brain drop: an absent principal is claim_not_found and creates no row", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(SCHEMA);
    const beforeColumns = columns(db);
    const brain = await brainOn(db);
    const dropped = brain.brainMemberDropClaim("nobody", "mem_missing", "claimed");
    assert.equal(dropped.ok, false);
    assert.equal(dropped.code, "claim_not_found");
    assert.deepEqual(columns(db), beforeColumns);
    assert.deepEqual(members(db), []);
    const count = db.prepare("SELECT COUNT(*) AS n FROM brain_members").get() as { n: number };
    assert.equal(count.n, 0);
    db.close();
  } finally {
    remove();
  }
});

test("brain drop: a no-match on a present row is claim_not_found and adds no principal", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'active', 'bea', 1, 'chg_1', 'mem_real', 'owner', 9)`,
    ).run();
    const beforeColumns = columns(db);
    const beforeRows = members(db);
    const beforeCount = (db.prepare("SELECT COUNT(*) AS n FROM brain_members").get() as { n: number }).n;
    const brain = await brainOn(db);
    const dropped = brain.brainMemberDropClaim("ada", "mem_other", "active");
    assert.equal(dropped.ok, false);
    assert.equal(dropped.code, "claim_not_found");
    assert.deepEqual(columns(db), beforeColumns);
    assert.deepEqual(members(db), beforeRows);
    const afterCount = (db.prepare("SELECT COUNT(*) AS n FROM brain_members").get() as { n: number }).n;
    assert.equal(afterCount, beforeCount);
    assert.equal(afterCount, 1);
    db.close();
  } finally {
    remove();
  }
});
