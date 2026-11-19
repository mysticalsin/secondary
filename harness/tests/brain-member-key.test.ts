/**
 * A claim mints an opaque key and stores it before propose.
 * propose(key) returns the existing governance change. Legacy rows keep a null key.
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
const govSpecifier = "../../src/worker/admin/store.ts";
const journalSpecifier = "../../src/worker/security-journal.ts";

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

function tempFile(prefix: string): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return {
    file: path.join(dir, "state.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function brainSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
}

async function openGov(file: string, legacy = false): Promise<{ db: DatabaseSync; gov: { propose(a: typeof proposal & { claimKey?: string }, now: number): { ok: true; change: { id: string }; applied: boolean } | { ok: false; code: string } } }> {
  const db = openSqlite(file);
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
      ('bea', 'bea@example.com', 'bea');
  `);
  if (legacy) {
    db.exec(`
      CREATE TABLE gov_changes (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
        scope_key TEXT NOT NULL, needs_second INTEGER NOT NULL, proposed_by TEXT NOT NULL,
        proposed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_by TEXT,
        decided_at INTEGER, note TEXT, base_version INTEGER);
      INSERT INTO gov_changes
        (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
      VALUES ('chg_old', 'member_add', 'applied', '{}', 'department:eng', 0, 'bea', ${NOW - 1}, ${NOW + 1});
    `);
  }
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
    ) => { propose(a: typeof proposal & { claimKey?: string }, now: number): { ok: true; change: { id: string }; applied: boolean } | { ok: false; code: string } };
  };
  const gov = new govMod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1, journal }, []);
  return { db, gov };
}

test("brain claim: the key is on the row before propose runs", async () => {
  const { file, remove } = tempFile("brain-key-");
  try {
    const db = openSqlite(file);
    brainSchema(db);
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as {
      BrainBase: { prototype: { sql: SqlStorage } };
      placeScopedMember: Function;
    };
    const brain = Object.create(mod.BrainBase.prototype) as { sql: SqlStorage };
    brain.sql = sql;
    await assert.rejects(
      () =>
        mod.placeScopedMember(
          {
            propose() {
              const row = db.prepare("SELECT state, claim_key FROM brain_members WHERE principal_id = 'ada'").get() as {
                state: string;
                claim_key: string | null;
              };
              assert.equal(row.state, "claimed");
              assert.equal(typeof row.claim_key, "string");
              assert.ok(row.claim_key && row.claim_key.length > 0);
              throw new Error("stop before propose returns");
            },
          },
          brain,
          proposal,
          "ada",
          "owner",
          "bea",
          NOW,
        ),
      /stop before propose returns/,
    );
    const after = db.prepare("SELECT state, claim_key, role FROM brain_members WHERE principal_id = 'ada'").get() as
      | { state: string; claim_key: string | null; role: string }
      | undefined;
    assert.equal(after, undefined);
    const store = brain as unknown as { brainRoleOf(ids: string[]): string | null };
    assert.equal(store.brainRoleOf(["ada"]), null);
    db.close();
  } finally {
    remove();
  }
});

test("governance propose: the same claim key returns the existing change", async () => {
  const { file, remove } = tempFile("gov-key-");
  try {
    const { db, gov } = await openGov(file);
    const first = gov.propose({ ...proposal, claimKey: "mem_same" }, NOW);
    const second = gov.propose({ ...proposal, claimKey: "mem_same" }, NOW + 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) assert.equal(second.change.id, first.change.id);
    const rows = db.prepare("SELECT id, claim_key FROM gov_changes").all() as { id: string; claim_key: string | null }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.claim_key, "mem_same");
    db.close();
  } finally {
    remove();
  }
});

test("governance propose: a legacy null claim key is not rewritten", async () => {
  const { file, remove } = tempFile("gov-legacy-");
  try {
    const { db, gov } = await openGov(file, true);
    const legacy = db.prepare("SELECT claim_key FROM gov_changes WHERE id = 'chg_old'").get() as { claim_key: string | null };
    assert.equal(legacy.claim_key, null);
    const made = gov.propose(proposal, NOW);
    assert.equal(made.ok, true);
    if (made.ok) assert.notEqual(made.change.id, "chg_old");
    const still = db.prepare("SELECT claim_key FROM gov_changes WHERE id = 'chg_old'").get() as { claim_key: string | null };
    assert.equal(still.claim_key, null);
    if (made.ok) {
      const fresh = db.prepare("SELECT claim_key FROM gov_changes WHERE id = ?").get(made.change.id) as { claim_key: string | null };
      assert.equal(fresh.claim_key, null);
    }
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'gov_changes_claim_key'").get() as { sql: string } | undefined;
    assert.match(index?.sql ?? "", /UNIQUE/i);
    db.close();
  } finally {
    remove();
  }
});

async function openPair(file: string): Promise<{
  db: DatabaseSync;
  gov: {
    propose(a: typeof proposal & { claimKey?: string }, now: number): { ok: true; change: { id: string; status?: string }; applied: boolean } | { ok: false; code: string };
    changeByKey(key: string, now: number): { id: string; status: string } | null;
  };
  brain: { sql: SqlStorage; brainRoleOf(ids: string[]): string | null };
  place: Function;
}> {
  const db = openSqlite(file);
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
      ('bea', 'bea@example.com', 'bea');
  `);
  brainSchema(db);
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
    ) => {
      propose(a: typeof proposal & { claimKey?: string }, now: number): { ok: true; change: { id: string; status?: string }; applied: boolean } | { ok: false; code: string };
      changeByKey(key: string, now: number): { id: string; status: string } | null;
    };
  };
  const storeMod = (await import(storeSpecifier)) as {
    BrainBase: { prototype: { sql: SqlStorage; brainRoleOf(ids: string[]): string | null } };
    placeScopedMember: Function;
  };
  const gov = new govMod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1, journal }, []);
  const brain = Object.create(storeMod.BrainBase.prototype) as { sql: SqlStorage; brainRoleOf(ids: string[]): string | null };
  brain.sql = sql;
  return { db, gov, brain, place: storeMod.placeScopedMember };
}

test("brain claim: a proposal that throws after commit is finished by a retry with the same key", async () => {
  const { file, remove } = tempFile("brain-retry-");
  try {
    const { db, gov, brain, place } = await openPair(file);
    let thrown = false;
    const govFace = {
      propose(a: typeof proposal & { claimKey?: string }, now: number) {
        const result = gov.propose(a, now);
        if (!thrown) {
          thrown = true;
          throw new Error("after commit");
        }
        return result;
      },
      changeByKey(key: string, now: number) {
        return gov.changeByKey(key, now);
      },
    };
    await assert.rejects(() => place(govFace, brain, proposal, "ada", "owner", "bea", NOW), /after commit/);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    const held = db.prepare("SELECT state, claim_key FROM brain_members WHERE principal_id = 'ada'").get() as {
      state: string;
      claim_key: string;
    };
    assert.equal(held.state, "claimed");
    const before = db.prepare("SELECT id, claim_key FROM gov_changes").all() as { id: string; claim_key: string }[];
    assert.equal(before.length, 1);
    assert.equal(before[0]?.claim_key, held.claim_key);
    const again = await place(govFace, brain, proposal, "ada", "owner", "bea", NOW + 1);
    assert.equal(again.ok, true);
    assert.equal(again.changeId, before[0]?.id);
    assert.equal(brain.brainRoleOf(["ada"]), "owner");
    const after = db.prepare("SELECT id, claim_key FROM gov_changes").all() as { id: string; claim_key: string }[];
    assert.equal(after.length, 1);
    assert.equal(after[0]?.claim_key, held.claim_key);
    db.close();
  } finally {
    remove();
  }
});

test("brain claim: a crash between claim and propose reuses the key on the next attempt", async () => {
  const { file, remove } = tempFile("brain-crash-");
  try {
    const { db, gov, brain, place } = await openPair(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at, claim_key) VALUES ('ada', 'owner', 'claimed', 'bea', ?, 'mem_crash')",
    ).run(NOW);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    const placed = await place(gov, brain, proposal, "ada", "owner", "bea", NOW + 1);
    assert.equal(placed.ok, true);
    const rows = db.prepare("SELECT id, claim_key, status FROM gov_changes").all() as { id: string; claim_key: string; status: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.claim_key, "mem_crash");
    assert.equal(brain.brainRoleOf(["ada"]), "owner");
    const member = db.prepare("SELECT state, claim_key FROM brain_members WHERE principal_id = 'ada'").get() as {
      state: string;
      claim_key: string;
    };
    assert.equal(member.state, "active");
    assert.equal(member.claim_key, "mem_crash");
    db.close();
  } finally {
    remove();
  }
});
