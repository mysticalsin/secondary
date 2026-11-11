/**
 * A scoped brain role and the governance change succeed or fail together.
 * A refused member write must not leave a governance row or a log line.
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
const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";
const govSpecifier = "../../recovered-source/worker/src/admin/store.ts";
const journalSpecifier = "../../recovered-source/worker/src/security-journal.ts";

const proposal = {
  kind: "member_add" as const,
  payload: { principalId: "ada", scope: { type: "department", id: "eng" }, subspace: null },
  scopeKey: "department:eng",
  scope: {
    type: "department" as const,
    id: "eng",
    dept: null,
    label: "Engineering",
    restricted: false,
    nda: false,
    subspace: null,
  },
  needsSecond: false,
  proposedBy: "bea",
  label: "Adding a member of Engineering",
};

type Place = { ok: true; status: string; changeId: string } | { ok: false; status: number; code: string };

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-link-"));
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
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
    INSERT INTO principals (id, email, subject) VALUES
      ('ada', 'ada@example.com', 'ada'),
      ('bea', 'bea@example.com', 'bea');
  `);
}

type Hosts = {
  gov: { propose(a: typeof proposal, now: number): unknown };
  brain: {
    brainMemberSet(
      principalId: string,
      role: string,
      state: "active" | "pending",
      actor: string,
      now: number,
    ): { ok: true; state: string } | { ok: false; code: string };
  };
  place(
    gov: Hosts["gov"],
    brain: Hosts["brain"],
    body: typeof proposal,
    principalId: string,
    role: string,
    actor: string,
    now: number,
  ): Promise<Place>;
};

async function openHosts(file: string): Promise<{ db: DatabaseSync; hosts: Hosts }> {
  const db = openSqlite(file);
  prepare(db);
  const sql = sqliteStorage(db);
  const journalMod = (await import(journalSpecifier)) as {
    SecurityJournal: new (sql: SqlStorage) => { init(): void };
  };
  const journal = new journalMod.SecurityJournal(sql);
  journal.init();
  const govMod = (await import(govSpecifier)) as {
    GovStore: new (
      host: { sql: SqlStorage; tx: <T>(fn: () => T) => T; bump: () => number; journal: unknown },
      defaults: readonly unknown[],
    ) => Hosts["gov"];
  };
  const storeMod = (await import(storeSpecifier)) as {
    BrainBase: { prototype: Hosts["brain"] };
    placeScopedMember: Hosts["place"];
  };
  const gov = new govMod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1, journal }, []);
  const brain = Object.create(storeMod.BrainBase.prototype) as Hosts["brain"] & { sql: SqlStorage };
  brain.sql = sql;
  return { db, hosts: { gov, brain, place: storeMod.placeScopedMember } };
}

function picture(db: DatabaseSync) {
  const rows = (sql: string) =>
    (db.prepare(sql).all() as Record<string, unknown>[]).map((row) => ({ ...row }));
  return {
    changes: rows("SELECT kind, status, payload, scope_key FROM gov_changes ORDER BY id"),
    memberships: rows("SELECT principal_id, scope_type, scope_id FROM memberships ORDER BY 1, 2, 3"),
    notices: rows("SELECT principal_id, kind FROM gov_notifications ORDER BY id"),
    journal: rows("SELECT kind, a, b, c, v FROM security_journal ORDER BY seq"),
    wiki: rows("SELECT actor, kind, detail FROM wiki_log ORDER BY id"),
    brain: rows("SELECT principal_id, role, state, added_by, at FROM brain_members ORDER BY principal_id"),
  };
}

test("brain link: a legacy member state refuses with 409 and leaves governance and both logs untouched", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, hosts } = await openHosts(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'legacy', 'bea', ?)",
    ).run(NOW - 1);
    const before = picture(db);
    const placed = await hosts.place(hosts.gov, hosts.brain, proposal, "ada", "owner", "bea", NOW);
    assert.equal(placed.ok, false);
    if (!placed.ok) {
      assert.equal(placed.status, 409);
      assert.equal(placed.code, "state_unreadable");
    }
    assert.deepEqual(picture(db), before);
    db.close();
  } finally {
    remove();
  }
});

test("brain link: a pending member and an applied governance change become one active role", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, hosts } = await openHosts(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'pending', 'bea', ?)",
    ).run(NOW - 1);
    const placed = await hosts.place(hosts.gov, hosts.brain, proposal, "ada", "owner", "bea", NOW);
    assert.equal(placed.ok, true);
    if (placed.ok) assert.equal(placed.status, "applied");
    const shot = picture(db);
    assert.equal(shot.memberships.length, 1);
    assert.equal(shot.journal.filter((row) => row.kind === "member").length, 1);
    assert.equal(shot.wiki.length, 1);
    assert.equal(shot.brain[0]?.state, "active");
    assert.equal(shot.brain[0]?.role, "owner");
    db.close();
  } finally {
    remove();
  }
});

test("brain link: a duplicate governance change does not move the member or write a log", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, hosts } = await openHosts(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'pending', 'bea', ?)",
    ).run(NOW - 1);
    db.prepare(
      `INSERT INTO gov_changes
         (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
       VALUES ('chg_old', 'member_add', 'pending', ?, 'department:eng', 0, 'bea', ?, ?)`,
    ).run(JSON.stringify(proposal.payload), NOW - 1, NOW + 72 * 3_600_000);
    const before = picture(db);
    const placed = await hosts.place(hosts.gov, hosts.brain, proposal, "ada", "owner", "bea", NOW);
    assert.equal(placed.ok, false);
    if (!placed.ok) assert.equal(placed.code, "duplicate");
    assert.deepEqual(picture(db), before);
    db.close();
  } finally {
    remove();
  }
});

test("brain link: two admissions of one pending member produce one governance change", async () => {
  const { file, remove } = tempFile();
  try {
    const { db } = await openHosts(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES ('ada', 'reader', 'pending', 'bea', ?)",
    ).run(NOW - 1);
    db.close();
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string) =>
      new Promise<Place>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/brain-link-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, id: "ada", actor, role: "owner", now: NOW, proposal, barrier },
        });
        worker.once("message", (value: Place) => resolve(value));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("bea"), run("cy")]);
    const codes = [a, b].map((result) => (result.ok ? result.status : result.code)).sort();
    assert.deepEqual(codes, ["applied", "replay"]);
    const check = openSqlite(file);
    const shot = picture(check);
    assert.equal(shot.changes.length, 1);
    assert.equal(shot.journal.filter((row) => row.kind === "member").length, 1);
    assert.equal(shot.wiki.length, 1);
    check.close();
  } finally {
    remove();
  }
});
