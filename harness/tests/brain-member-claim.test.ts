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
    hold: {
      ok: true;
      at: number;
      inserted: boolean;
      previousAt: number | null;
      previousState: string;
      key: string;
      previousKey: string | null;
    },
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

test("brain claim: a claim replaced during propose is left in place", async () => {
  const { file, remove } = tempFile();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const { db, brain, place } = await openBrain(file);
    let n = 0;
    const gov = {
      changeByKey() {
        return null;
      },
      propose() {
        n += 1;
        db.prepare("UPDATE brain_members SET claim_key = ? WHERE principal_id = 'ada'").run(`mem_other_${n}`);
        return { ok: true, change: { id: `chg_${n}` }, applied: false };
      },
    };
    const first = await place(gov, brain, proposal, "ada", "owner", "bea", NOW);
    const second = await place(gov, brain, proposal, "ada", "owner", "bea", NOW + 1);
    const row = db
      .prepare("SELECT state, claim_key, change_id FROM brain_members WHERE principal_id = 'ada'")
      .get() as { state: string; claim_key: string; change_id: string | null };
    const logged = warnings.map((line) => JSON.parse(line) as { reason?: string; principalId?: string });
    assert.deepEqual(
      {
        first: first.ok,
        second: second.ok,
        row: { ...row },
        logged: logged.map((line) => ({ reason: line.reason ?? null, principalId: line.principalId ?? null })),
        leaked: warnings.some((line) => line.includes("Engineering") || line.includes("Adding")),
      },
      {
        first: false,
        second: false,
        row: { state: "claimed", claim_key: "mem_other_2", change_id: null },
        logged: [
          { reason: "illegal_move", principalId: "ada" },
          { reason: "illegal_move", principalId: "ada" },
        ],
        leaked: false,
      },
    );
  } finally {
    console.warn = original;
    remove();
  }
});

test("brain claim: a second role cannot take the claim while propose is open", async () => {
  const { file, remove } = tempFile();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const { db, brain, place } = await openBrain(file);
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let inside = false;
    const firstGov = {
      changeByKey() {
        return null;
      },
      async propose() {
        inside = true;
        await gate;
        return { ok: true, change: { id: "chg_owner" }, applied: true };
      },
    };
    const secondGov = {
      changeByKey() {
        return null;
      },
      propose() {
        return { ok: true, change: { id: "chg_reader" }, applied: true };
      },
    };
    const first = place(firstGov, brain, proposal, "ada", "owner", "bea", NOW);
    while (!inside) await new Promise((resolve) => setImmediate(resolve));
    const second = await place(secondGov, brain, proposal, "ada", "reader", "bea", NOW + 1);
    releaseFirst();
    const owner = await first;
    const row = db
      .prepare("SELECT role, state, change_id FROM brain_members WHERE principal_id = 'ada'")
      .get() as { role: string; state: string; change_id: string | null };
    const logged = warnings.map((line) => JSON.parse(line) as { reason?: string; principalId?: string });
    assert.deepEqual(
      {
        owner,
        secondOk: second.ok,
        row: { ...row },
        logged: logged.map((line) => ({ reason: line.reason ?? null, principalId: line.principalId ?? null })),
        leaked: warnings.some((line) => line.includes("Engineering") || line.includes("Adding")),
      },
      {
        owner: { ok: true, status: "applied", changeId: "chg_owner" },
        secondOk: false,
        row: { role: "owner", state: "active", change_id: "chg_owner" },
        logged: [{ reason: "illegal_move", principalId: "ada" }],
        leaked: false,
      },
    );
  } finally {
    console.warn = original;
    remove();
  }
});

test("brain claim: an active member keeps the in-flight role while propose is open", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain, place } = await openBrain(file);
    db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at, claim_key) VALUES ('ada', 'reader', 'active', 'bea', 1, NULL)",
    ).run();
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let inside = false;
    const first = place(
      {
        changeByKey() {
          return null;
        },
        async propose() {
          inside = true;
          await gate;
          return { ok: true, change: { id: "chg_owner" }, applied: true };
        },
      },
      brain,
      proposal,
      "ada",
      "owner",
      "bea",
      NOW,
    );
    while (!inside) await new Promise((resolve) => setImmediate(resolve));
    const held = db
      .prepare("SELECT role, state FROM brain_members WHERE principal_id = 'ada'")
      .get() as { role: string; state: string };
    const second = await place(
      {
        changeByKey() {
          return null;
        },
        propose() {
          return { ok: true, change: { id: "chg_reader" }, applied: true };
        },
      },
      brain,
      proposal,
      "ada",
      "reader",
      "bea",
      NOW + 1,
    );
    releaseFirst();
    const owner = await first;
    const row = db
      .prepare("SELECT role, state, change_id FROM brain_members WHERE principal_id = 'ada'")
      .get() as { role: string; state: string; change_id: string | null };
    assert.deepEqual(
      { held: { ...held }, owner, secondOk: second.ok, row: { ...row } },
      {
        held: { role: "owner", state: "claimed" },
        owner: { ok: true, status: "applied", changeId: "chg_owner" },
        secondOk: false,
        row: { role: "owner", state: "active", change_id: "chg_owner" },
      },
    );
  } finally {
    remove();
  }
});
