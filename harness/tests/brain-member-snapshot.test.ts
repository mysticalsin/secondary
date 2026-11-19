/**
 * An admin snapshot is a backup. Restoring it does not promote a pending role.
 * The claim stays until the membership lease, which clears an existing grant
 * and deletes a first-time row.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { register } from "node:module";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const workspaceSpecifier = "../../src/worker/workspace.ts";
const storeSpecifier = "../../src/worker/brains/store.ts";
const govSpecifier = "../../src/worker/admin/store.ts";

type Workspace = {
  sql: SqlStorage;
  exportAll(): Record<string, Record<string, unknown>[]>;
  importAll(data: unknown): number;
  brainRoleOf(principalIds: string[]): string | null;
};

function openCtx(db: DatabaseSync): { ctx: unknown; ready: () => Promise<unknown> } {
  let ready: Promise<unknown> = Promise.resolve();
  return {
    ctx: {
      storage: {
        sql: sqliteStorage(db),
        transactionSync<T>(fn: () => T): T {
          return fn();
        },
        setAlarm() {},
      },
      blockConcurrencyWhile(fn: () => Promise<unknown>) {
        ready = fn();
        return ready;
      },
    },
    ready: () => ready,
  };
}

function row(db: DatabaseSync, id: string): Record<string, unknown> | null {
  const found = db
    .prepare(
      `SELECT role, state, claim_key, pending_role, pending_at, at
       FROM brain_members WHERE principal_id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return found ? { ...found } : null;
}

test("brain snapshot: restoring a pending claim does not apply the role", async () => {
  const db = new DatabaseSync(":memory:");
  const { ctx, ready } = openCtx(db);
  const workspaceMod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const storeMod = (await import(storeSpecifier)) as { reconcileBrainMember: Function };
  const { CHANGE_TTL_MS } = (await import(govSpecifier)) as { CHANGE_TTL_MS: number };
  const ws = new workspaceMod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready();
  const claimAt = NOW;
  db.prepare(
    `INSERT INTO brain_members
      (principal_id, role, state, added_by, at, claim_key, pending_role, pending_at)
     VALUES
      ('ada', 'reader', 'active', 'bea', 1, 'mem_held', 'owner', ?),
      ('cy', 'owner', 'claimed', 'bea', ?, 'mem_new', NULL, NULL)`,
  ).run(claimAt, claimAt);
  const snapshot = ws.exportAll();
  const backed = (snapshot.brain_members ?? []).map((member) => ({ ...member }));
  db.prepare("UPDATE brain_members SET role = 'owner', pending_role = NULL, pending_at = NULL").run();
  ws.importAll(snapshot);
  const gov = { changeByKey() { return null; } };
  await storeMod.reconcileBrainMember(gov, ws, "ada", claimAt + 2 * CHANGE_TTL_MS - 1);
  await storeMod.reconcileBrainMember(gov, ws, "cy", claimAt + 2 * CHANGE_TTL_MS - 1);
  const within = { ada: row(db, "ada"), cy: row(db, "cy"), role: ws.brainRoleOf(["ada"]) };
  await storeMod.reconcileBrainMember(gov, ws, "ada", claimAt + 2 * CHANGE_TTL_MS);
  await storeMod.reconcileBrainMember(gov, ws, "cy", claimAt + 2 * CHANGE_TTL_MS);
  assert.deepEqual(
    {
      backup: backed.map((member) => member.principal_id).sort(),
      keptPending: backed.some((member) => member.principal_id === "ada" && member.pending_role === "owner" && member.pending_at === claimAt),
      within,
      after: { ada: row(db, "ada"), cy: row(db, "cy"), role: ws.brainRoleOf(["ada"]) },
    },
    {
      backup: ["ada", "cy"],
      keptPending: true,
      within: {
        ada: {
          role: "reader",
          state: "active",
          claim_key: "mem_held",
          pending_role: "owner",
          pending_at: claimAt,
          at: 1,
        },
        cy: {
          role: "owner",
          state: "claimed",
          claim_key: "mem_new",
          pending_role: null,
          pending_at: null,
          at: claimAt,
        },
        role: "reader",
      },
      after: {
        ada: {
          role: "reader",
          state: "active",
          claim_key: null,
          pending_role: null,
          pending_at: null,
          at: 1,
        },
        cy: null,
        role: "reader",
      },
    },
  );
  db.close();
});
