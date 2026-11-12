/**
 * A stored membership grants a role only when it is finished and active.
 * A claim and a pending row grant nothing. Every access read uses grantsMemberRole.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import { grantsMemberRole } from "../../src/state/brain-member.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const storeSpecifier = "../../recovered-source/worker/src/brains/store.ts";

type Store = {
  brainRoleOf(principalIds: string[]): string | null;
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-grant-"));
  return {
    file: path.join(dir, "brain.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openStore(file: string): Promise<{ store: Store; db: DatabaseSync }> {
  const db = openSqlite(file);
  db.exec(`
    CREATE TABLE brain_members (
      principal_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT NOT NULL,
      added_by TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as { BrainBase: { prototype: Store } };
  const store = Object.create(mod.BrainBase.prototype) as Store & { sql: SqlStorage };
  store.sql = sql;
  return { store, db };
}

test("brain member grant: only an active row grants, through one predicate", () => {
  assert.equal(grantsMemberRole("active"), true);
  assert.equal(grantsMemberRole("pending"), false);
  assert.equal(grantsMemberRole("claimed"), false);
  assert.equal(grantsMemberRole("legacy"), false);
  assert.equal(grantsMemberRole(null), false);
});

test("brain member grant: a claimed or pending row grants nothing, and an active row does", async () => {
  const { file, remove } = tempFile();
  try {
    const { store, db } = await openStore(file);
    const insert = db.prepare(
      "INSERT INTO brain_members (principal_id, role, state, added_by, at) VALUES (?, 'owner', ?, 'bea', 1)",
    );
    insert.run("pending-ada", "pending");
    insert.run("claimed-ada", "claimed");
    insert.run("active-bea", "active");
    assert.equal(store.brainRoleOf(["pending-ada"]), null);
    assert.equal(store.brainRoleOf(["claimed-ada"]), null);
    assert.equal(store.brainRoleOf(["active-bea"]), "owner");
    assert.equal(store.brainRoleOf(["pending-ada", "active-bea"]), "owner");
    db.close();
  } finally {
    remove();
  }
});

test("brain access: the member list and the reader count reconcile through the one predicate", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const routes = readFileSync(path.join(root, "recovered-source/worker/src/brains/routes.ts"), "utf8");
  const access = routes.slice(
    routes.indexOf('r.get("/brains/:id/access"'),
    routes.indexOf('r.put("/brains/:id/access"'),
  );
  assert.equal(access.includes("reconcileStoredMembers"), true);
  const extra = access.slice(access.indexOf("for (const m of stored)"));
  assert.equal(extra.includes("grantsMemberRole"), true);
  const shared = readFileSync(path.join(root, "recovered-source/worker/src/brains/shared.ts"), "utf8");
  const card = shared.slice(shared.indexOf("export async function cardOf"), shared.indexOf("export async function rateLimit"));
  assert.equal(card.includes("reconcileStoredMembers"), true);
  assert.equal(shared.includes("grantsMemberRole"), true);
});

test("brain member grant: access reads call grantsMemberRole and do not compare the state word", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const files = [
    "recovered-source/worker/src/brains/store.ts",
    "recovered-source/worker/src/brains/routes.ts",
    "recovered-source/worker/src/brains/shared.ts",
  ];
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.equal(text.includes("grantsMemberRole"), true, rel);
    assert.equal(text.includes('state === "active"'), false, rel);
    assert.equal(text.includes("state == 'active'"), false, rel);
  }
});
