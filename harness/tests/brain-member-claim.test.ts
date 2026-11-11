/**
 * A claim is not authority. If propose throws, the claim is released.
 * Release reports state_unreadable when it matches no row.
 * The claim stores the proposal id only after propose returns.
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

type Release = { ok: true } | { ok: false; code: string };

type Brain = {
  brainRoleOf(principalIds: string[]): string | null;
  brainMemberRelease(
    principalId: string,
    hold: { ok: true; at: number; inserted: boolean; previousAt: number | null; previousState: string },
  ): Release;
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
  const dir = mkdtempSync(path.join(tmpdir(), "brain-claim-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openBrain(file: string): Promise<{ db: DatabaseSync; brain: Brain; place: Function }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as {
    BrainBase: { prototype: Brain };
    placeScopedMember: Function;
  };
  const brain = Object.create(mod.BrainBase.prototype) as Brain & { sql: SqlStorage };
  brain.sql = sql;
  return { db, brain, place: mod.placeScopedMember };
}

function member(db: DatabaseSync, id: string): { role: string; state: string; change_id: string | null } | undefined {
  return db
    .prepare("SELECT role, state, change_id FROM brain_members WHERE principal_id = ?")
    .get(id) as { role: string; state: string; change_id: string | null } | undefined;
}

test("brain claim: a thrown proposal keeps the keyed claim and grants nothing", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain, place } = await openBrain(file);
    await assert.rejects(
      () =>
        place(
          {
            propose() {
              throw new Error("proposal failed");
            },
          },
          brain,
          proposal,
          "ada",
          "owner",
          "bea",
          NOW,
        ),
      /proposal failed/,
    );
    const kept = member(db, "ada");
    assert.equal(kept?.state, "claimed");
    assert.equal(kept?.change_id, null);
    assert.equal(brain.brainRoleOf(["ada"]), null);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM wiki_log").get() as { n: number }).n,
      0,
    );
    db.close();
  } finally {
    remove();
  }
});

test("brain claim: release of a missing row is state_unreadable", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    const released = brain.brainMemberRelease("ada", {
      ok: true,
      at: NOW,
      inserted: true,
      previousAt: null,
      previousState: "claimed",
      key: "mem_missing",
      previousKey: null,
    });
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "state_unreadable");
    assert.equal(member(db, "ada"), undefined);
    db.close();
  } finally {
    remove();
  }
});

test("brain claim: the proposal id is stored only after propose returns", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain, place } = await openBrain(file);
    const placed = await place(
      {
        propose() {
          return { ok: true, change: { id: "chg_1" }, applied: true };
        },
      },
      brain,
      proposal,
      "ada",
      "owner",
      "bea",
      NOW,
    );
    assert.equal(placed.ok, true);
    const row = member(db, "ada");
    assert.equal(row?.state, "active");
    assert.equal(row?.change_id, "chg_1");
    assert.equal(brain.brainRoleOf(["ada"]), "owner");
    db.close();
  } finally {
    remove();
  }
});
