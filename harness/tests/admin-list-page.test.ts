/**
 * Admin lists page in SQL after the filter.
 * A newest-N window taken first hides an older pending, active, or unread row.
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
const storeSpecifier = "../../src/worker/admin/store.ts";

type ChangeRow = { id: string; status: string; proposedBy: string; scopeKey: string };
type RequestRow = { id: string; status: string };
type ElevationRow = { id: string; status: string } | null;
type Notice = { id: number; read: boolean };

type Store = {
  listChanges(
    now: number,
    f: {
      status?: string | null;
      scopeKeys?: string[] | null;
      kinds?: string[] | null;
      mine?: string | null;
    },
  ): ChangeRow[];
  listRequests(f: {
    principalId?: string | null;
    scopeKeys?: string[] | null;
    status?: string | null;
  }): RequestRow[];
  listElevations(now: number, principalId: string | null): { id: string; status: string }[];
  activeElevation(principalId: string, now: number): ElevationRow;
  inbox(principalIds: string | readonly string[]): { unread: number; items: Notice[] };
};

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "admin-list-"));
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
    CREATE TABLE elevations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL,
      until INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
}

async function openStore(file: string): Promise<{ db: DatabaseSync; store: Store }> {
  const db = openSqlite(file);
  prepare(db);
  const sql = sqliteStorage(db);
  const mod = (await import(storeSpecifier)) as {
    GovStore: new (
      host: { sql: SqlStorage; tx: <T>(fn: () => T) => T; bump: () => number },
      defaults: readonly unknown[],
    ) => Store;
  };
  const store = new mod.GovStore({ sql, tx: (fn) => fn(), bump: () => 1 }, []);
  return { db, store };
}

const payload = JSON.stringify({ principalId: "ada" });
const scope = JSON.stringify({ type: "department", id: "eng", subspace: null });

test("300 applied plus one older pending returns that pending change", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const insert = db.prepare(
      `INSERT INTO gov_changes
         (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
       VALUES (?, 'member_add', ?, ?, 'department:eng', 0, 'bea', ?, ?)`,
    );
    insert.run("chg_pending", "pending", payload, NOW - 1, NOW + 86_400_000);
    for (let i = 0; i < 300; i++)
      insert.run(`chg_applied_${i}`, "applied", payload, NOW + 1 + i, NOW + 86_400_000);
    const listed = store.listChanges(NOW, { status: "pending" });
    assert.equal(listed.length, 1, `300 applied plus one older pending returns ${listed.length}`);
    assert.equal(listed[0]?.id, "chg_pending");
    db.close();
  } finally {
    remove();
  }
});

test("pending request behind 300 denied rows is still listed", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const insert = db.prepare(
      `INSERT INTO gov_access_requests
         (id, principal_id, node_id, scope_key, scope, scope_label, reason, status, created_at)
       VALUES (?, 'ada', 'd_eng', 'department:eng', ?, 'Eng', 'because', ?, ?)`,
    );
    insert.run("req_pending", scope, "pending", NOW - 1);
    for (let i = 0; i < 300; i++) insert.run(`req_denied_${i}`, scope, "denied", NOW + 1 + i);
    const listed = store.listRequests({ status: "pending" });
    assert.equal(
      listed.length,
      1,
      `pending request behind 300 denied rows returns ${listed.length}`,
    );
    assert.equal(listed[0]?.id, "req_pending");
    db.close();
  } finally {
    remove();
  }
});

test("active elevation behind 50 ended rows is present", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const insert = db.prepare(
      `INSERT INTO gov_elevations
         (id, principal_id, hours, reason, status, requested_at, lapses_at, decided_at, until)
       VALUES (?, 'ada', 1, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 50; i++)
      insert.run(`elv_end_${i}`, "ended", "ended", NOW + 10 + i, NOW + 10 + i, NOW, NOW);
    insert.run("elv_active", "still open", "active", NOW - 1, NOW + 86_400_000, NOW - 1, NOW + 3_600_000);
    const active = store.activeElevation("ada", NOW);
    assert.equal(active?.id ?? null, "elv_active", "active elevation behind 50 ended rows is absent");
    db.close();
  } finally {
    remove();
  }
});

test("inbox unread badge counts notices the newest 50 do not show", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const insert = db.prepare(
      `INSERT INTO gov_notifications (principal_id, kind, title, ref, at, read_at)
       VALUES ('ada', 'note', ?, NULL, ?, ?)`,
    );
    for (let i = 0; i < 10; i++) insert.run(`unread ${i}`, NOW - 100 + i, null);
    for (let i = 0; i < 50; i++) insert.run(`read ${i}`, NOW + i, NOW);
    const box = store.inbox("ada");
    const shown = box.items.filter((item) => !item.read).length;
    assert.equal(box.unread, 10);
    assert.equal(shown, 10, `inbox unread badge ${box.unread} with ${shown} unread items in the 50 shown`);
    db.close();
  } finally {
    remove();
  }
});

test("a pending change at its expiry is not listed as pending", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    db.prepare(
      `INSERT INTO gov_changes
         (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
       VALUES ('chg_lapsed', 'member_add', 'pending', ?, 'department:eng', 0, 'bea', ?, ?)`,
    ).run(payload, NOW, NOW);
    assert.equal(store.listChanges(NOW, { status: "pending" }).length, 0);
    assert.equal(store.listChanges(NOW, { status: "expired" })[0]?.id, "chg_lapsed");
    db.close();
  } finally {
    remove();
  }
});

test("a proposer's own change stays visible outside the caller's scope keys", async () => {
  const { file, remove } = tempFile();
  try {
    const { db, store } = await openStore(file);
    const insert = db.prepare(
      `INSERT INTO gov_changes
         (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at)
       VALUES (?, 'member_add', 'pending', ?, ?, 1, ?, ?, ?)`,
    );
    insert.run("chg_mine", payload, "department:eng", "bea", NOW, NOW + 86_400_000);
    insert.run("chg_other", payload, "department:eng", "cy", NOW, NOW + 86_400_000);
    const listed = store.listChanges(NOW, { scopeKeys: ["department:other"], mine: "bea" });
    assert.deepEqual(
      listed.map((row) => row.id),
      ["chg_mine"],
    );
    db.close();
  } finally {
    remove();
  }
});
