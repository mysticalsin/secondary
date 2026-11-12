/**
 * The unscoped finish writes the pending role stored by the claim.
 * The role argument is not a second source.
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
const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type Hold = { ok: true; at: number; key: string } | { ok: false; code: string };

type Brain = {
  sql: SqlStorage;
  brainMemberClaim(principalId: string, role: string, actor: string, now: number): Hold;
  brainMemberFinish(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
    hold: Extract<Hold, { ok: true }>,
  ): { ok: boolean; code?: string; state?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-legacy-finish-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain legacy finish: the stored pending role wins over the caller's role", async () => {
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
    const hold = brain.brainMemberClaim("ada", "owner", "bea", NOW);
    assert.equal(hold.ok, true);
    if (!hold.ok) return;
    const finished = brain.brainMemberFinish("ada", "steward", "active", "cy", NOW + 1, hold);
    const again = brain.brainMemberFinish("ada", "editor", "active", "cy", NOW + 2, hold);
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
        again: again.ok ? again.state : again.code,
        row: { ...stored },
        logged: logged.map((line) => JSON.parse(line.detail).role),
      },
      {
        finished: true,
        again: "replay",
        row: { role: "owner", state: "active", pending_role: null, pending_at: null },
        logged: ["owner"],
      },
    );
    db.close();
  } finally {
    remove();
  }
});
