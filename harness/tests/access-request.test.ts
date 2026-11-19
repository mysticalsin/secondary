/**
 * Access request on the real GovStore.
 * A pending request is decided once. Reopen is legal only from approved.
 * A fulfilling change does not write a request that is already closed.
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
const storeSpecifier = "../../src/worker/admin/store.ts";

const scope = {
  type: "department" as const,
  id: "eng",
  dept: null,
  label: "Engineering",
  restricted: false,
  nda: false,
  subspace: null,
};

type RequestResult =
  | { ok: true; request: { id: string; status: string; decidedBy: string | null; changeId: string | null } }
  | { ok: false; code: string; status: number };

type Store = {
  createRequest(
    a: { principalId: string; nodeId: string; scope: typeof scope; reason: string },
    now: number,
  ): RequestResult;
  markApproved(id: string, deciderId: string, now: number): RequestResult;
  denyRequest(id: string, deciderId: string, note: string, now: number): RequestResult;
  reopenRequest(id: string): { ok: true } | { ok: false; code: string; status: number };
  request(id: string): { id: string; status: string; decidedBy: string | null; changeId: string | null } | null;
  decide(
    id: string,
    approve: boolean,
    deciderId: string,
    note: string | null,
    now: number,
  ): { ok: true } | { ok: false; code: string; status: number };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "access-request-"));
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
    CREATE TABLE memberships (
      principal_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      PRIMARY KEY (principal_id, scope_type, scope_id));
    INSERT INTO principals (id, email, subject) VALUES
      ('ada', 'ada@example.com', 'ada'),
      ('bea', 'bea@example.com', 'bea'),
      ('cy', 'cy@example.com', 'cy');
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

function notices(db: DatabaseSync, kind: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM gov_notifications WHERE kind = ?").get(kind) as { n: number }
  ).n;
}

async function pending(store: Store): Promise<string> {
  const created = store.createRequest(
    { principalId: "ada", nodeId: "node-eng", scope, reason: "need the space" },
    NOW,
  );
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("request was not created");
  return created.request.id;
}

test("access request: reopening an approved request returns it to the queue", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const id = await pending(store);
    const marked = store.markApproved(id, "bea", NOW + 1);
    assert.equal(marked.ok, true);
    db.prepare("UPDATE gov_access_requests SET change_id = 'chg_1' WHERE id = ?").run(id);
    const reopened = store.reopenRequest(id);
    assert.equal(reopened.ok, true);
    const row = store.request(id);
    assert.equal(row?.status, "pending");
    assert.equal(row?.decidedBy, null);
    assert.equal(row?.changeId, null);
    db.close();
  } finally {
    remove();
  }
});

test("access request: reopening a granted, denied, or pending request is refused and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const id = await pending(store);
    for (const status of ["granted", "denied", "pending"] as const) {
      db.prepare(
        "UPDATE gov_access_requests SET status = ?, decided_by = 'bea', decided_at = ?, change_id = 'chg_1' WHERE id = ?",
      ).run(status, NOW + 1, id);
      const reopened = store.reopenRequest(id);
      assert.equal(reopened.ok, false, status);
      if (!reopened.ok) assert.equal(reopened.status, 409, status);
      const row = store.request(id);
      assert.equal(row?.status, status, status);
      assert.equal(row?.decidedBy, "bea", status);
      assert.equal(row?.changeId, "chg_1", status);
    }
    db.close();
  } finally {
    remove();
  }
});

test("access request: a second denial is refused and notifies once", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const id = await pending(store);
    const first = store.denyRequest(id, "bea", "not now", NOW + 1);
    assert.equal(first.ok, true);
    const second = store.denyRequest(id, "cy", "still no", NOW + 2);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.status, 409);
    assert.equal(notices(db, "request_denied"), 1);
    const row = store.request(id);
    assert.equal(row?.status, "denied");
    assert.equal(row?.decidedBy, "bea");
    db.close();
  } finally {
    remove();
  }
});

test("access request: two approvers cannot both approve one pending request", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const id = await pending(store);
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string) =>
      new Promise<RequestResult>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/access-request-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, id, actor, now: NOW + 1, barrier },
        });
        worker.once("message", (value: RequestResult) => resolve(value));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("bea"), run("cy")]);
    const codes = [a, b].map((result) => (result.ok ? "approved" : result.code)).sort();
    assert.deepEqual(codes, ["approved", "not_pending"]);
    const check = openSqlite(file);
    const row = check.prepare("SELECT status, decided_by FROM gov_access_requests WHERE id = ?").get(id) as {
      status: string;
      decided_by: string;
    };
    assert.equal(row.status, "approved");
    assert.ok(row.decided_by === "bea" || row.decided_by === "cy");
    check.close();
  } finally {
    remove();
  }
});

test("access request: fulfilling a change does not rewrite or notify a request that is already granted", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const id = await pending(store);
    db.prepare(
      "UPDATE gov_access_requests SET status = 'granted', decided_by = 'bea', decided_at = ?, change_id = 'chg_1' WHERE id = ?",
    ).run(NOW + 1, id);
    db.prepare(
      `INSERT INTO gov_changes
         (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
       VALUES ('chg_1', 'member_add', 'pending', ?, 'department:eng', 1, 'bea', ?, ?)`,
    ).run(
      JSON.stringify({ principalId: "ada", scope: { type: "department", id: "eng" } }),
      NOW,
      NOW + 72 * 3_600_000,
    );
    const decided = store.decide("chg_1", true, "cy", null, NOW + 2);
    assert.equal(decided.ok, true);
    const row = store.request(id);
    assert.equal(row?.status, "granted");
    assert.equal(row?.decidedBy, "bea");
    assert.equal(notices(db, "request_granted"), 0);
    db.close();
  } finally {
    remove();
  }
});
