/**
 * A leftover claim key on an applied member is not a first-time placeholder.
 * DropClaim leaves that row and its role alone.
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

const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type Brain = {
  sql: SqlStorage;
  brainMemberDropClaim(
    principalId: string,
    key: string | null,
    previousState: string,
  ): { ok: boolean; code?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-drop-active-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("brain drop: an applied row with a leftover key keeps its role", async () => {
  const { file, remove } = tempFile();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const db = openSqlite(file);
    db.exec(`
      CREATE TABLE brain_members (
        principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
        added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT,
        pending_role TEXT, pending_at INTEGER);
    `);
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, change_id, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'active', 'bea', 1, 'chg_1', 'mem_left', NULL, NULL)`,
    ).run();
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Brain } };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sql;
    const dropped = brain.brainMemberDropClaim("ada", "mem_left", "active");
    const stored = db
      .prepare(
        `SELECT role, state, claim_key, pending_role, pending_at, change_id, at
         FROM brain_members WHERE principal_id = 'ada'`,
      )
      .get() as Record<string, unknown> | undefined;
    assert.deepEqual(
      {
        dropped: dropped.ok ? "ok" : dropped.code,
        row: stored ? { ...stored } : null,
        logged: warnings.map((line) => JSON.parse(line) as { principalId?: string; claimKey?: string; role?: string }),
      },
      {
        dropped: "ok",
        row: {
          role: "reader",
          state: "active",
          claim_key: "mem_left",
          pending_role: null,
          pending_at: null,
          change_id: "chg_1",
          at: 1,
        },
        logged: [{ at: "brain_member", principalId: "ada", claimKey: "mem_left" }],
      },
    );
    db.close();
  } finally {
    console.warn = original;
    remove();
  }
});
