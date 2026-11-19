/**
 * A member who already existed is finished pending and the claim key is cleared.
 * DropClaim of the old key matches nothing and leaves the row alone.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../src/worker/brains/store.ts";

type MemberRow = {
  role: string;
  state: string;
  claim_key: string | null;
  pending_role: string | null;
  pending_at: number | null;
  added_by: string;
  at: number;
};

type Hold = { ok: true; key: string; at: number; inserted: boolean } | { ok: false; code: string };

type Brain = {
  sql: SqlStorage;
  brainMemberClaim(principalId: string, role: "reader", actor: string, now: number): Hold;
  brainMemberFinish(
    principalId: string,
    role: "reader",
    state: "active" | "pending",
    actor: string,
    now: number,
    hold: Extract<Hold, { ok: true }>,
  ): { ok: true; state: "active" | "pending" } | { ok: false; code: string };
  brainMemberDropClaim(
    principalId: string,
    key: string | null,
    previousState: string,
  ): { ok: boolean; code?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-drop-existing-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain drop: a pre-existing member finished pending keeps the row", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(`
      CREATE TABLE brain_members (
        principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
        added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT,
        pending_role TEXT, pending_at INTEGER);
      CREATE TABLE wiki_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL);
    `);
    db.prepare(
      `INSERT INTO brain_members (principal_id, role, state, added_by, at)
       VALUES ('ada', 'reader', 'active', 'bea', 1)`,
    ).run();
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sql;
    const hold = brain.brainMemberClaim("ada", "reader", "cy", NOW);
    assert.equal(hold.ok, true);
    if (!hold.ok) return;
    const set = brain.brainMemberFinish("ada", "reader", "pending", "cy", NOW, hold);
    assert.equal(set.ok, true);
    const before = db
      .prepare(
        `SELECT role, state, claim_key, pending_role, pending_at, added_by, at
         FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as MemberRow;
    assert.equal(before.state, "pending");
    assert.equal(before.pending_role, null);
    assert.equal(before.claim_key === null, true);
    const dropped = brain.brainMemberDropClaim("ada", hold.key, before.state);
    const after = db
      .prepare(
        `SELECT role, state, claim_key, pending_role, pending_at, added_by, at
         FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as MemberRow | undefined;
    assert.deepEqual(
      { dropped: dropped.ok ? "ok" : dropped.code, row: after ?? null },
      { dropped: "state_unreadable", row: before },
    );
    db.close();
  } finally {
    remove();
  }
});
