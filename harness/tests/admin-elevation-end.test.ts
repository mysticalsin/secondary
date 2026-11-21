/**
 * Ending one elevation window must leave every other open window for that person alone.
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
const END = 1_700_000_001_000;
const HOUR = 3_600_000;
const storeSpecifier = "../../src/worker/admin/store.ts";

type Store = {
  requestElevation(
    a: {
      principalId: string;
      hours: number;
      reason: string;
      maxHours: number;
      needsApproval: boolean;
    },
    now: number,
  ): { ok: true; elevation: { id: string } } | { ok: false; code: string };
  endElevation(
    id: string,
    now: number,
  ): { ok: true; elevation: { until: number | null } } | { ok: false; code: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "admin-end-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function prepare(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE nda_grants (
      principal_id TEXT NOT NULL, account_id TEXT NOT NULL,
      reason TEXT, expires_at INTEGER, granted_by TEXT, approved_by TEXT, granted_at INTEGER,
      PRIMARY KEY (principal_id, account_id));
    CREATE TABLE principals (id TEXT PRIMARY KEY, email TEXT NOT NULL, subject TEXT);
    CREATE TABLE role_assignments (principal_id TEXT, role_id TEXT);
    CREATE TABLE elevations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL,
      until INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
}

async function openStore(file: string): Promise<{ db: DatabaseSync; store: Store }> {
  const db = openSqlite(file);
  prepare(db);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as {
    GovStore: new (
      host: { sql: SqlStorage; tx: <T>(fn: () => T) => T; bump: () => number },
      defaults: readonly unknown[],
    ) => Store;
  };
  const store = new mod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1 }, []);
  return { db, store };
}

test("endElevation closes only the targeted window", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const started = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: false },
      NOW,
    );
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const otherUntil = NOW + 5 * HOUR;
    db.prepare(
      "INSERT INTO elevations (principal_id, until, reason, created_at) VALUES ('ada', ?, 'direct window', ?)",
    ).run(otherUntil, NOW);
    const ended = store.endElevation(started.elevation.id, END);
    assert.equal(ended.ok, true);
    const rows = db.prepare("SELECT reason, until FROM elevations ORDER BY reason").all() as {
      reason: string;
      until: number;
    }[];
    assert.deepEqual(rows, [
      { reason: "direct window", until: otherUntil },
      { reason: "incident", until: END },
    ]);
    db.close();
  } finally {
    remove();
  }
});
