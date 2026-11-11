/**
 * Finish is keyed by the proposal id. Zero rows is a mismatch, not a plain refusal.
 * The next membership read finishes the claim when governance applied, and releases it otherwise.
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

type Place = { ok: true; status: string; changeId: string } | { ok: false; status: number; code: string; changeId?: string };

type Brain = {
  sql: SqlStorage;
  brainRoleOf(principalIds: string[]): string | null;
  brainMemberNote(
    principalId: string,
    changeId: string,
    hold: { ok: true; at: number; inserted: boolean; previousAt: number | null },
  ): { ok: boolean };
};

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

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-reconcile-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openBrain(file: string): Promise<{
  db: DatabaseSync;
  brain: Brain;
  place: Function;
  reconcile: Function;
}> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as {
    BrainBase: { prototype: Brain };
    placeScopedMember: Function;
    reconcileBrainMember: Function;
  };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sql;
  const note = brain.brainMemberNote;
  brain.brainMemberNote = function (principalId, changeId, hold) {
    const noted = note.call(this, principalId, changeId, hold);
    this.sql.exec("UPDATE brain_members SET at = ? WHERE principal_id = ?", hold.at + 1, principalId);
    return noted;
  };
  return { db, brain, place: mod.placeScopedMember, reconcile: mod.reconcileBrainMember };
}

function row(db: DatabaseSync): { role: string; state: string; change_id: string | null } | undefined {
  return db.prepare("SELECT role, state, change_id FROM brain_members WHERE principal_id = 'ada'").get() as
    | { role: string; state: string; change_id: string | null }
    | undefined;
}

function logs(db: DatabaseSync): unknown[] {
  return db.prepare("SELECT kind, detail FROM wiki_log").all();
}

async function place(applied: boolean, status: string) {
  const { file, remove } = tempFile();
  const opened = await openBrain(file);
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const placed = (await opened.place(
      {
        propose() {
          return { ok: true, change: { id: "chg_1" }, applied };
        },
        change(id: string) {
          return id === "chg_1" ? { status } : null;
        },
      },
      opened.brain,
      proposal,
      "ada",
      "owner",
      "bea",
      NOW,
    )) as Place;
    return { ...opened, placed, lines, remove, warn };
  } catch (error) {
    console.warn = warn;
    remove();
    throw error;
  }
}

test("brain reconcile: finish matches zero rows after governance applied, then the next read finishes the claim", async () => {
  const run = await place(true, "applied");
  const { db, brain, reconcile, placed, lines, remove, warn } = run;
  try {
    assert.equal(placed.ok, false);
    if (!placed.ok) {
      assert.equal(placed.status, 409);
      assert.equal(placed.code, "mismatch");
      assert.equal(placed.changeId, "chg_1");
    }
    assert.equal(brain.brainRoleOf(["ada"]), null);
    assert.equal(row(db)?.state, "claimed");
    const logged = lines.map((line) => JSON.parse(line) as { reason?: string; principalId?: string; changeId?: string; from?: string });
    const hit = logged.find((line) => line.reason === "mismatch");
    assert.equal(hit?.principalId, "ada");
    assert.equal(hit?.changeId, "chg_1");
    assert.equal(typeof hit?.from, "string");
    assert.equal(JSON.stringify(hit).includes("owner"), false);
    await reconcile(
      {
        change(id: string) {
          return id === "chg_1" ? { status: "applied" } : null;
        },
      },
      brain,
      "ada",
      NOW + 1,
    );
    assert.equal(row(db)?.state, "active");
    assert.equal(row(db)?.change_id, "chg_1");
    assert.equal(brain.brainRoleOf(["ada"]), "owner");
    await reconcile(
      {
        change(id: string) {
          return id === "chg_1" ? { status: "applied" } : null;
        },
      },
      brain,
      "ada",
      NOW + 2,
    );
    assert.equal(logs(db).length, 1);
    db.close();
  } finally {
    console.warn = warn;
    remove();
  }
});

test("brain reconcile: finish matches zero rows after a pending proposal, and the next read grants nothing", async () => {
  const run = await place(false, "pending");
  const { db, brain, reconcile, placed, remove, warn } = run;
  try {
    assert.equal(placed.ok, false);
    if (!placed.ok) assert.equal(placed.code, "mismatch");
    assert.equal(brain.brainRoleOf(["ada"]), null);
    await reconcile(
      {
        change(id: string) {
          return id === "chg_1" ? { status: "pending" } : null;
        },
      },
      brain,
      "ada",
      NOW + 1,
    );
    assert.equal(row(db)?.state, "pending");
    assert.equal(row(db)?.change_id, "chg_1");
    assert.equal(brain.brainRoleOf(["ada"]), null);
    db.close();
  } finally {
    console.warn = warn;
    remove();
  }
});

test("brain reconcile: a read while propose is in flight changes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(`
      CREATE TABLE brain_members (
        principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
        added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT);
      CREATE TABLE wiki_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL);
    `);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at, change_id) VALUES ('ada', 'owner', 'claimed', 'bea', ?, NULL)",
    ).run(NOW);
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as {
      BrainBase: { prototype: Brain & { brainMemberDropClaim(...args: unknown[]): { ok: boolean; code?: string } } };
      reconcileBrainMember: Function;
    };
    const brain = Object.create(mod.BrainBase.prototype) as Brain & {
      sql: SqlStorage;
      brainMemberDropClaim(...args: unknown[]): { ok: boolean; code?: string };
    };
    brain.sql = sql;
    const before = row(db);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    await mod.reconcileBrainMember({ change() { return null; } }, brain, "ada", NOW + 1);
    assert.deepEqual(row(db), before);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    assert.equal(logs(db).length, 0);
    const dropped = brain.brainMemberDropClaim("ada", "chg_other", "claimed");
    assert.equal(dropped.ok, false);
    assert.equal(dropped.code, "state_unreadable");
    assert.deepEqual(row(db), before);
    db.close();
  } finally {
    remove();
  }
});

test("brain reconcile: a claim with no proposal id stays and grants nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const db = openSqlite(file);
    db.exec(`
      CREATE TABLE brain_members (
        principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
        added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT);
      CREATE TABLE wiki_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL);
    `);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at, change_id) VALUES ('ada', 'owner', 'claimed', 'bea', ?, NULL)",
    ).run(NOW);
    const sql = sqliteStorage(db);
    const mod = (await import(storeSpecifier)) as {
      BrainBase: { prototype: Brain };
      reconcileBrainMember: Function;
    };
    const brain = Object.create(mod.BrainBase.prototype) as Brain;
    brain.sql = sql;
    assert.equal(brain.brainRoleOf(["ada"]), null);
    const before = row(db);
    await mod.reconcileBrainMember(
      {
        change() {
          return null;
        },
      },
      brain,
      "ada",
      NOW + 1,
    );
    assert.deepEqual(row(db), before);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    assert.equal(logs(db).length, 0);
    db.close();
  } finally {
    remove();
  }
});
