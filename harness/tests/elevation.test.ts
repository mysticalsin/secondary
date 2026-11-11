/**
 * Elevation on the real GovStore. A pending request can start once.
 * A second start, and a start from any other status, must refuse and write nothing.
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
const storeSpecifier = "../../recovered-source/worker/src/admin/store.ts";

type ElevationResult =
  | { ok: true; elevation: { id: string; status: string; until: number | null } }
  | { ok: false; code: string; status: number };

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
  ): ElevationResult;
  decideElevation(
    id: string,
    approve: boolean,
    deciderId: string,
    note: string | null,
    now: number,
  ): ElevationResult;
  endElevation(id: string, now: number): ElevationResult;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "elevation-"));
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

async function openStore(file: string): Promise<{ store: Store; db: DatabaseSync }> {
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
  return { store, db };
}

function engineRows(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM elevations").get() as { n: number }).n;
}

test("elevation: a request that needs no approval starts one window", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const started = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: false },
      NOW,
    );
    assert.equal(started.ok, true);
    if (started.ok) assert.equal(started.elevation.status, "active");
    assert.equal(engineRows(db), 1);
    db.close();
  } finally {
    remove();
  }
});

test("elevation: approving a denied request does not start a window", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const pending = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: true },
      NOW,
    );
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    db.prepare("UPDATE gov_elevations SET status = 'denied' WHERE id = ?").run(pending.elevation.id);
    const again = store.decideElevation(pending.elevation.id, true, "bea", null, NOW + 1);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 409);
    assert.equal(engineRows(db), 0);
    db.close();
  } finally {
    remove();
  }
});

test("elevation: two approvers cannot both start one pending window", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const pending = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: true },
      NOW,
    );
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string) =>
      new Promise<ElevationResult>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/elevation-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, id: pending.elevation.id, actor, now: NOW + 1, barrier },
        });
        worker.once("message", (value: ElevationResult) => resolve(value));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("bea"), run("cy")]);
    const codes = [a, b].map((result) => (result.ok ? "started" : result.code)).sort();
    assert.deepEqual(codes, ["not_startable", "started"]);
    const check = openSqlite(file);
    assert.equal(engineRows(check), 1);
    const status = check.prepare("SELECT status FROM gov_elevations WHERE id = ?").get(pending.elevation.id) as {
      status: string;
    };
    assert.equal(status.status, "active");
    check.close();
  } finally {
    remove();
  }
});
