/**
 * A governance decision writes only from pending.
 * An unknown stored word has no effect and is not echoed.
 * Two approvers produce one applied change.
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
const journalSpecifier = "../../src/worker/security-journal.ts";

type Decision = { ok: true; change: { status: string } } | { ok: false; status: number; code: string; message: string };

type Store = {
  decide(id: string, approve: boolean, deciderId: string, note: string | null, now: number): Decision;
  withdraw(id: string, by: string, now: number): Decision;
  change(id: string, now: number): { status: string } | null;
  propose(
    a: {
      kind: "member_add";
      payload: Record<string, unknown>;
      scopeKey: string;
      scope: null;
      needsSecond: boolean;
      proposedBy: string;
      label: string;
    },
    now: number,
  ): { ok: true; change: { id: string; status: string }; applied: boolean } | { ok: false; code: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "governance-"));
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
    CREATE TABLE memberships (
      principal_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      PRIMARY KEY (principal_id, scope_type, scope_id));
    INSERT INTO principals (id, email, subject) VALUES
      ('ada', 'ada@example.com', 'ada'),
      ('bea', 'bea@example.com', 'bea'),
      ('cy', 'cy@example.com', 'cy'),
      ('dee', 'dee@example.com', 'dee');
  `);
}

async function openStore(file: string): Promise<{ db: DatabaseSync; store: Store }> {
  const db = openSqlite(file);
  prepare(db);
  const sql = sqliteStorage(db);
  const journalMod = (await import(journalSpecifier)) as {
    SecurityJournal: new (sql: SqlStorage) => { init(): void };
  };
  const journal = new journalMod.SecurityJournal(sql);
  journal.init();
  const govMod = (await import(storeSpecifier)) as {
    GovStore: new (
      host: { sql: SqlStorage; tx: <T>(fn: () => T) => T; bump: () => number; journal: unknown },
      defaults: readonly unknown[],
    ) => Store;
  };
  const store = new govMod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1, journal }, []);
  return { db, store };
}

const payload = JSON.stringify({ principalId: "ada", scope: { type: "department", id: "eng" } });

function insertChange(db: DatabaseSync, status: string, expiresAt: number): void {
  db.prepare(
    `INSERT INTO gov_changes
       (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
     VALUES ('chg_1', 'member_add', ?, ?, 'department:eng', 1, 'bea', ?, ?)`,
  ).run(status, payload, NOW, expiresAt);
}

function picture(db: DatabaseSync) {
  const rows = (sql: string) =>
    (db.prepare(sql).all() as Record<string, unknown>[]).map((row) => ({ ...row }));
  return {
    change: rows("SELECT status, decided_by, decided_at, note FROM gov_changes"),
    memberships: rows("SELECT principal_id, scope_type, scope_id FROM memberships"),
    notices: rows("SELECT principal_id, kind FROM gov_notifications"),
    journal: rows("SELECT kind, a, b, c, v FROM security_journal"),
  };
}

test("governance: a second person applies one pending change, and a second decision does not", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    insertChange(db, "pending", NOW + 72 * 3_600_000);
    const decided = store.decide("chg_1", true, "cy", null, NOW + 1);
    assert.equal(decided.ok, true);
    if (decided.ok) assert.equal(decided.change.status, "applied");
    const again = store.decide("chg_1", false, "dee", null, NOW + 2);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "not_pending");
    assert.equal(picture(db).memberships.length, 1);
    assert.equal(picture(db).journal.length, 1);
    db.close();
  } finally {
    remove();
  }
});

test("governance: a lapsed pending change reads as expired and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    insertChange(db, "pending", NOW);
    const before = picture(db);
    const read = store.change("chg_1", NOW);
    assert.equal(read?.status, "expired");
    const decided = store.decide("chg_1", true, "cy", null, NOW);
    assert.equal(decided.ok, false);
    if (!decided.ok) assert.equal(decided.code, "expired");
    assert.deepEqual(picture(db), before);
    db.close();
  } finally {
    remove();
  }
});

test("governance: an unknown stored status is refused and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    insertChange(db, "legacy", NOW + 72 * 3_600_000);
    const before = picture(db);
    const read = store.change("chg_1", NOW);
    assert.equal(read?.status, "unknown");
    const decided = store.decide("chg_1", true, "cy", null, NOW);
    assert.equal(decided.ok, false);
    if (!decided.ok) {
      assert.equal(decided.status, 409);
      assert.equal(decided.code, "state_unreadable");
      assert.equal(decided.message.includes("legacy"), false);
    }
    const withdrawn = store.withdraw("chg_1", "bea", NOW);
    assert.equal(withdrawn.ok, false);
    if (!withdrawn.ok) {
      assert.equal(withdrawn.code, "state_unreadable");
      assert.equal(withdrawn.message.includes("legacy"), false);
    }
    assert.deepEqual(picture(db), before);
    db.close();
  } finally {
    remove();
  }
});

test("governance: the proposer can withdraw a pending change, and a proposal that needs no second person applies", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    insertChange(db, "pending", NOW + 72 * 3_600_000);
    const withdrawn = store.withdraw("chg_1", "bea", NOW + 1);
    assert.equal(withdrawn.ok, true);
    if (withdrawn.ok) assert.equal(withdrawn.change.status, "withdrawn");
    assert.equal(picture(db).memberships.length, 0);
    const proposed = store.propose(
      {
        kind: "member_add",
        payload: { principalId: "ada", scope: { type: "department", id: "eng" } },
        scopeKey: "department:eng",
        scope: null,
        needsSecond: false,
        proposedBy: "bea",
        label: "Adding a member",
      },
      NOW + 2,
    );
    assert.equal(proposed.ok, true);
    if (proposed.ok) {
      assert.equal(proposed.applied, true);
      assert.equal(proposed.change.status, "applied");
    }
    assert.equal(picture(db).memberships.length, 1);
    db.close();
  } finally {
    remove();
  }
});

test("governance: two approvers of one pending change produce one applied change", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    insertChange(db, "pending", NOW + 72 * 3_600_000);
    void store;
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string) =>
      new Promise<Decision>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/governance-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, id: "chg_1", actor, now: NOW + 1, barrier },
        });
        worker.once("message", (value: Decision) => resolve(value));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("cy"), run("dee")]);
    const codes = [a, b].map((result) => (result.ok ? "applied" : result.code)).sort();
    assert.deepEqual(codes, ["applied", "not_pending"]);
    const check = openSqlite(file);
    const shot = picture(check);
    assert.equal(shot.change[0]?.status, "applied");
    assert.equal(shot.memberships.length, 1);
    assert.equal(shot.journal.length, 1);
    assert.equal(shot.notices.filter((row) => row.kind === "access_granted").length, 1);
    check.close();
  } finally {
    remove();
  }
});
