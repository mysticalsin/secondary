/**
 * A first-time finish keeps the role the claim inserted.
 * The caller's role is not written onto that row.
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

const NOW = 1_700_000_000_000;
const storeSpecifier = "../../src/worker/brains/store.ts";

type Brain = {
  sql: SqlStorage;
  brainMemberFinishProposal(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
    changeId: string,
    at: number | null,
    key: string,
    previousState: string,
  ): { ok: boolean; code?: string; state?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-first-finish-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain finish: a first-time row keeps the role the claim inserted", async () => {
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
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'claimed', 'bea', ?, 'mem_first', NULL, NULL)`,
    ).run(NOW);
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sql;
    const finished = brain.brainMemberFinishProposal(
      "ada",
      "steward",
      "active",
      "cy",
      NOW + 1,
      "chg_1",
      NOW,
      "mem_first",
      "claimed",
    );
    const stored = db
      .prepare(
        `SELECT role, state, pending_role, pending_at FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as Record<string, unknown>;
    const logged = db
      .prepare("SELECT detail FROM wiki_log WHERE kind = 'brain.member'")
      .all() as { detail: string }[];
    assert.deepEqual(
      {
        finished: finished.ok,
        row: { ...stored },
        logged: logged.map((line) => JSON.parse(line.detail).role),
      },
      {
        finished: true,
        row: { role: "reader", state: "active", pending_role: null, pending_at: null },
        logged: ["reader"],
      },
    );
    db.close();
  } finally {
    remove();
  }
});
