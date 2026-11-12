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
  listElevations(
    now: number,
    principalId: string | null,
  ): { id: string; status: string; until: number | null }[];
  activeElevation(principalId: string, now: number): { id: string; status: string } | null;
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

test("elevation: a pending row past its window is expired for list, active, and decide, and cannot start", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const pending = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: true },
      NOW,
    );
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    db.prepare("UPDATE gov_elevations SET lapses_at = ? WHERE id = ?").run(NOW, pending.elevation.id);
    assert.equal(store.listElevations(NOW, "ada")[0]?.status, "expired");
    assert.equal(store.activeElevation("ada", NOW), null);
    const decided = store.decideElevation(pending.elevation.id, true, "bea", null, NOW);
    assert.equal(decided.ok, false);
    if (!decided.ok) assert.equal(decided.code, "expired");
    assert.equal(engineRows(db), 0);
    const again = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "follow up", maxHours: 4, needsApproval: true },
      NOW,
    );
    assert.equal(again.ok, true);
    db.close();
  } finally {
    remove();
  }
});

test("elevation: an active row with a null until grants nothing and is not rewritten", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    const sql = sqliteStorage(db);
    let ready: Promise<void> = Promise.resolve();
    const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";
    const mod = (await import(policySpecifier)) as {
      TenantPolicy: new (ctx: unknown, env: unknown) => {
        session(input: { email: string; actAs: null; now: number; limit: number }): Promise<{
          elevatedUntil: number | null;
        }>;
        gov(method: string, args: unknown[]): { id: string; status: string } | null;
      };
    };
    const policy = new mod.TenantPolicy(
      {
        storage: {
          sql,
          transactionSync<T>(fn: () => T): T {
            return fn();
          },
        },
        blockConcurrencyWhile(fn: () => Promise<void>) {
          ready = fn();
          return ready;
        },
      },
      {},
    );
    await ready;
    db.prepare("INSERT INTO principals (id, email) VALUES ('ada', 'ada@example.com')").run();
    db.prepare(
      `INSERT INTO gov_elevations
         (id, principal_id, hours, reason, status, requested_at, lapses_at, until)
       VALUES ('elv_null', 'ada', 2, 'legacy', 'active', ?, ?, NULL)`,
    ).run(NOW, NOW + 1);
    db.exec("DROP TABLE elevations");
    db.exec(
      `CREATE TABLE elevations (
         id INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL,
         until INTEGER, reason TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    );
    db.prepare(
      "INSERT INTO elevations (principal_id, until, reason, created_at) VALUES ('ada', NULL, 'legacy', ?)",
    ).run(NOW);
    const beforeGov = db.prepare("SELECT status, until FROM gov_elevations WHERE id = 'elv_null'").get() as {
      status: string;
      until: number | null;
    };
    const beforeEngine = db.prepare("SELECT until FROM elevations WHERE principal_id = 'ada'").get() as {
      until: number | null;
    };
    const active = policy.gov("activeElevation", ["ada", NOW]);
    const session = await policy.session({ email: "ada@example.com", actAs: null, now: NOW, limit: 100 });
    assert.equal(active, null);
    assert.equal(session.elevatedUntil, null);
    const afterGov = db.prepare("SELECT status, until FROM gov_elevations WHERE id = 'elv_null'").get() as {
      status: string;
      until: number | null;
    };
    const afterEngine = db.prepare("SELECT until FROM elevations WHERE principal_id = 'ada'").get() as {
      until: number | null;
    };
    assert.deepEqual(
      { status: afterGov.status, until: afterGov.until },
      { status: beforeGov.status, until: beforeGov.until },
    );
    assert.equal(afterGov.status, "active");
    assert.equal(afterGov.until, null);
    assert.equal(afterEngine.until, beforeEngine.until);
    assert.equal(afterEngine.until, null);
    db.close();
  } finally {
    remove();
  }
});

test("elevation: an active window past its end reads as expired and cannot be ended early", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const started = store.requestElevation(
      { principalId: "ada", hours: 2, reason: "incident", maxHours: 4, needsApproval: false },
      NOW,
    );
    assert.equal(started.ok, true);
    if (!started.ok) return;
    db.prepare("UPDATE gov_elevations SET until = ? WHERE id = ?").run(NOW, started.elevation.id);
    assert.equal(store.listElevations(NOW, null)[0]?.status, "expired");
    assert.equal(store.activeElevation("ada", NOW), null);
    const ended = store.endElevation(started.elevation.id, NOW);
    assert.equal(ended.ok, false);
    if (!ended.ok) assert.equal(ended.code, "not_active");
    const stored = db.prepare("SELECT status FROM gov_elevations WHERE id = ?").get(started.elevation.id) as {
      status: string;
    };
    assert.equal(stored.status, "active");
    db.close();
  } finally {
    remove();
  }
});
