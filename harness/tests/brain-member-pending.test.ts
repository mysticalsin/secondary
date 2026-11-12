/**
 * An in-flight claim on an existing member keeps the granted role.
 * pending_role and pending_at ride the same compare-and-set, and a claim with no
 * governance row is released after two governance lifetimes.
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
const govSpecifier = "../../recovered-source/worker/src/admin/store.ts";

type ClaimHold = {
  ok: true;
  at: number;
  inserted: boolean;
  previousAt: number | null;
  previousState: string;
  key: string;
  previousKey: string | null;
  previousRole: string | null;
  inflightState: string;
  pendingRole?: string | null;
  pendingAt?: number | null;
};

type Brain = {
  sql: SqlStorage;
  brainMembers(): { principalId: string; role: string; state: string; addedBy: string; at: number }[];
  brainRoleOf(principalIds: string[]): string | null;
  brainMemberClaim(
    principalId: string,
    role: string,
    actor: string,
    now: number,
  ): { ok: true } & ClaimHold | { ok: false; code: string };
  brainMemberRelease(principalId: string, hold: ClaimHold): { ok: boolean; code?: string };
  brainMemberFinishProposal(
    principalId: string,
    role: string,
    state: "active" | "pending",
    actor: string,
    now: number,
    changeId: string,
    at: number | null,
    key: string,
    previousState: string,
  ): { ok: boolean; code?: string };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-pending-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openBrain(file: string): Promise<{ db: DatabaseSync; brain: Brain; reconcile: Function }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT,
      pending_role TEXT, pending_at INTEGER);
    CREATE TABLE wiki_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as {
    BrainBase: { prototype: Brain };
    reconcileBrainMember: Function;
  };
  const brain = Object.create(mod.BrainBase.prototype) as Brain;
  brain.sql = sql;
  return { db, brain, reconcile: mod.reconcileBrainMember };
}

function pendingRow(db: DatabaseSync, id: string): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT role, state, claim_key, pending_role, pending_at, at
       FROM brain_members WHERE principal_id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? { ...row } : null;
}

test("brain claim: a stale claim with no governance row is released after two lifetimes", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain, reconcile } = await openBrain(file);
    const { CHANGE_TTL_MS } = (await import(govSpecifier)) as { CHANGE_TTL_MS: number };
    const leaseMs = 2 * CHANGE_TTL_MS;
    const claimAt = NOW;
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, claim_key, pending_role, pending_at)
       VALUES
        ('fresh', 'owner', 'claimed', 'bea', ?, 'mem_fresh', NULL, NULL),
        ('stale_new', 'owner', 'claimed', 'bea', ?, 'mem_stale', NULL, NULL),
        ('stale_held', 'reader', 'active', 'bea', 1, 'mem_old', 'owner', ?),
        ('still_pending', 'reader', 'active', 'bea', 1, 'mem_pend', 'steward', ?),
        ('rejected', 'reader', 'active', 'bea', 1, 'mem_rej', 'editor', ?)`,
    ).run(claimAt, claimAt, claimAt, claimAt, claimAt);
    const gov = {
      changeByKey(key: string) {
        if (key === "mem_pend") return { id: "chg_pend", status: "pending" };
        if (key === "mem_rej") return { id: "chg_rej", status: "rejected" };
        return null;
      },
    };
    const atLease = claimAt + leaseMs;
    await reconcile(gov, brain, "fresh", atLease - 1);
    await reconcile(gov, brain, "stale_new", atLease);
    await reconcile(gov, brain, "stale_held", atLease);
    await reconcile(gov, brain, "still_pending", atLease);
    await reconcile(gov, brain, "rejected", atLease);
    assert.deepEqual(
      {
        fresh: pendingRow(db, "fresh"),
        staleNew: pendingRow(db, "stale_new"),
        staleHeld: pendingRow(db, "stale_held"),
        stillPending: pendingRow(db, "still_pending"),
        rejected: pendingRow(db, "rejected"),
      },
      {
        fresh: {
          role: "owner",
          state: "claimed",
          claim_key: "mem_fresh",
          pending_role: null,
          pending_at: null,
          at: claimAt,
        },
        staleNew: null,
        staleHeld: {
          role: "reader",
          state: "active",
          claim_key: null,
          pending_role: null,
          pending_at: null,
          at: 1,
        },
        stillPending: {
          role: "reader",
          state: "active",
          claim_key: "mem_pend",
          pending_role: "steward",
          pending_at: claimAt,
          at: 1,
        },
        rejected: {
          role: "reader",
          state: "active",
          claim_key: null,
          pending_role: null,
          pending_at: null,
          at: 1,
        },
      },
    );
    db.close();
  } finally {
    remove();
  }
});

test("brain claim: pending role is set once, hidden from reads, and cleared on finish and release", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, brain } = await openBrain(file);
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, claim_key, pending_role, pending_at)
       VALUES ('ada', 'reader', 'active', 'bea', 1, NULL, NULL, NULL)`,
    ).run();
    const hold = brain.brainMemberClaim("ada", "owner", "bea", NOW);
    assert.equal(hold.ok, true);
    if (!hold.ok) return;
    const second = brain.brainMemberClaim("ada", "steward", "bea", NOW + 1);
    const first = brain.brainMemberClaim("bea", "owner", "cy", NOW);
    assert.equal(first.ok, true);
    const listed = brain.brainMembers();
    assert.deepEqual(
      {
        ada: pendingRow(db, "ada"),
        secondOk: second.ok,
        secondCode: second.ok ? null : second.code,
        bea: pendingRow(db, "bea"),
        role: brain.brainRoleOf(["ada"]),
        exposed: listed.map((member) => Object.keys(member).sort()),
      },
      {
        ada: {
          role: "reader",
          state: "active",
          claim_key: hold.key,
          pending_role: "owner",
          pending_at: NOW,
          at: 1,
        },
        secondOk: false,
        secondCode: "replay",
        bea: {
          role: "owner",
          state: "claimed",
          claim_key: first.ok ? first.key : null,
          pending_role: null,
          pending_at: null,
          at: NOW,
        },
        role: "reader",
        exposed: [
          ["addedBy", "at", "principalId", "role", "state"],
          ["addedBy", "at", "principalId", "role", "state"],
        ],
      },
    );
    const finished = brain.brainMemberFinishProposal(
      "ada",
      "owner",
      "active",
      "bea",
      NOW + 2,
      "chg_ada",
      hold.at,
      hold.key,
      hold.inflightState,
    );
    assert.equal(finished.ok, true);
    assert.deepEqual(pendingRow(db, "ada"), {
      role: "owner",
      state: "active",
      claim_key: null,
      pending_role: null,
      pending_at: null,
      at: NOW + 2,
    });
    db.prepare(
      `INSERT INTO brain_members
        (principal_id, role, state, added_by, at, claim_key, pending_role, pending_at)
       VALUES ('cy', 'reader', 'active', 'bea', 5, 'mem_rel', 'owner', ?)`,
    ).run(NOW);
    const released = brain.brainMemberRelease("cy", {
      ok: true,
      at: 5,
      inserted: false,
      previousAt: 1,
      previousState: "active",
      key: "mem_rel",
      previousKey: "mem_prev",
      previousRole: "reader",
      inflightState: "active",
      pendingRole: "owner",
      pendingAt: NOW,
    });
    assert.equal(released.ok, true);
    assert.deepEqual(pendingRow(db, "cy"), {
      role: "reader",
      state: "active",
      claim_key: "mem_prev",
      pending_role: null,
      pending_at: null,
      at: 5,
    });
    db.close();
  } finally {
    remove();
  }
});
