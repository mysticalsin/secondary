/**
 * A pending claim does not replace an existing member's grant.
 * Rejected, expired, and withdrawn drops clear the in-flight columns and leave the row.
 * A first-time row is deleted.
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
  needsSecond: true,
  proposedBy: "bea",
  label: "Adding a member of Engineering",
};

type Brain = {
  sql: SqlStorage;
  brainRoleOf(principalIds: string[]): string | null;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-drop-"));
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
      added_by TEXT NOT NULL, at INTEGER NOT NULL, change_id TEXT, claim_key TEXT);
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
  return { db, brain, place: mod.placeScopedMember, reconcile: mod.reconcileBrainMember };
}

function row(db: DatabaseSync, id: string): Record<string, unknown> | null {
  const found = db
    .prepare(
      `SELECT role, state, claim_key, pending_role, pending_at, at
       FROM brain_members WHERE principal_id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!found) return null;
  return {
    role: found.role,
    state: found.state,
    pending_role: found.pending_role,
    pending_at: found.pending_at,
    claim: found.claim_key ? "set" : found.claim_key,
    at: found.at,
  };
}

test("brain drop: a pending claim keeps an existing grant and deletes only a first-time row", async () => {
  const statuses = ["rejected", "expired", "withdrawn"] as const;
  const seen: Record<string, unknown> = {};
  for (const status of statuses) {
    const { file, remove } = tempFile();
    try {
      const { db, brain, place, reconcile } = await openBrain(file);
      db.prepare(
        `INSERT INTO brain_members (principal_id, role, state, added_by, at)
         VALUES ('ada', 'reader', 'active', 'bea', 1)`,
      ).run();
      const gov = {
        propose() {
          return { ok: true, change: { id: `chg_${status}` }, applied: false };
        },
        changeByKey() {
          return { id: `chg_${status}`, status };
        },
      };
      const held = await place(gov, brain, proposal, "ada", "owner", "bea", NOW);
      const first = await place(gov, brain, { ...proposal, payload: { principalId: "cy" } }, "cy", "owner", "bea", NOW);
      const during = { ada: row(db, "ada"), cy: row(db, "cy"), held: held.ok, first: first.ok };
      await reconcile(gov, brain, "ada", NOW + 1);
      await reconcile(gov, brain, "cy", NOW + 1);
      await reconcile(gov, brain, "ada", NOW + 2);
      seen[status] = {
        during,
        ada: row(db, "ada"),
        cy: row(db, "cy"),
        role: brain.brainRoleOf(["ada"]),
        firstRole: brain.brainRoleOf(["cy"]),
      };
      db.close();
    } finally {
      remove();
    }
  }
  const kept = {
    role: "reader",
    state: "active",
    pending_role: null,
    pending_at: null,
    claim: null,
    at: 1,
  };
  const pending = {
    role: "reader",
    state: "active",
    pending_role: "owner",
    pending_at: NOW,
    claim: "set",
    at: 1,
  };
  assert.deepEqual(seen, {
    rejected: {
      during: {
        ada: pending,
        cy: { role: "owner", state: "pending", pending_role: null, pending_at: null, claim: "set", at: NOW },
        held: true,
        first: true,
      },
      ada: kept,
      cy: null,
      role: "reader",
      firstRole: null,
    },
    expired: {
      during: {
        ada: pending,
        cy: { role: "owner", state: "pending", pending_role: null, pending_at: null, claim: "set", at: NOW },
        held: true,
        first: true,
      },
      ada: kept,
      cy: null,
      role: "reader",
      firstRole: null,
    },
    withdrawn: {
      during: {
        ada: pending,
        cy: { role: "owner", state: "pending", pending_role: null, pending_at: null, claim: "set", at: NOW },
        held: true,
        first: true,
      },
      ada: kept,
      cy: null,
      role: "reader",
      firstRole: null,
    },
  });
});
