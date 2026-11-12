/**
 * Journal forget removes the person and leaves a switch row.
 * An NDA detail that names them is rewritten. An unknown row that quotes
 * them is kept, and that exact value becomes the pseudonym.
 * A second call leaves the same rows.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SecurityJournal } from "../../recovered-source/worker/src/security-journal.ts";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const detail = JSON.stringify({
  reason: "r",
  expiresAt: null,
  grantedBy: "user_1",
  approvedBy: "boss",
  grantedAt: 1,
});

test("journal forget removes the person, keeps a switch, and redacts an NDA detail", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  const journal = new SecurityJournal(sqliteStorage(db));
  journal.init();
  const insert = db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, ?, ?, ?, ?, 0)",
  );
  insert.run("status", "user_1", "", "");
  insert.run("switch", "user_1", "", "");
  insert.run("nda", "other", "acct", detail);
  insert.run("legacy", "other", '"user_1"', "");
  insert.run("legacy", "other", "handbook", "");
  journal.forget("user_1", pz);
  journal.forget("user_1", pz);
  const rows = db
    .prepare("SELECT kind, a, b, c FROM security_journal ORDER BY seq")
    .all()
    .map((row) => ({ ...(row as { kind: string; a: string; b: string; c: string }) }));
  assert.deepEqual(rows, [
    { kind: "switch", a: "user_1", b: "", c: "" },
    {
      kind: "nda",
      a: "other",
      b: "acct",
      c: JSON.stringify({ reason: "r", expiresAt: null, grantedBy: pz, approvedBy: "boss", grantedAt: 1 }),
    },
    { kind: "legacy", a: "other", b: JSON.stringify(pz), c: "" },
    { kind: "legacy", a: "other", b: "handbook", c: "" },
  ]);
  db.close();
});

const KEY = "0123456789abcdef0123456789abcdef";

async function pseudonym(id: string): Promise<string> {
  const spec = "../../recovered-source/worker/src/ops-rights.ts";
  const { pseudonymFor } = (await import(spec)) as {
    pseudonymFor: (
      env: { PSEUDONYM_KEY?: string },
      tenantId: string,
      principalId: string,
    ) => Promise<string | null>;
  };
  const value = await pseudonymFor({ PSEUDONYM_KEY: KEY }, "acme", id);
  if (value === null) throw new Error("pseudonym missing");
  return value;
}

function journal(db: DatabaseSync): SecurityJournal & { forget(id: string, pseudonym: string): void } {
  const created = new SecurityJournal(sqliteStorage(db));
  created.init();
  return created as SecurityJournal & { forget(id: string, pseudonym: string): void };
}

test("an NDA whose reason is the erased id survives, is pseudonymised, and replays as a grant", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE nda_grants (
      principal_id TEXT NOT NULL, account_id TEXT NOT NULL, reason TEXT, expires_at INTEGER,
      granted_by TEXT, approved_by TEXT, granted_at INTEGER,
      PRIMARY KEY (principal_id, account_id));
  `);
  const book = journal(db);
  const detail = JSON.stringify({
    reason: "user_1",
    expiresAt: null,
    grantedBy: "boss",
    approvedBy: null,
    grantedAt: 1,
  });
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'nda', 'other', 'acct', ?, 1)",
  ).run(detail);
  book.forget("user_1", pz);
  book.forget("user_1", pz);
  const stored = db.prepare("SELECT c FROM security_journal").get() as { c: string } | undefined;
  book.replay();
  const found = db
    .prepare("SELECT principal_id, account_id, reason, granted_by FROM nda_grants")
    .get() as { principal_id: string; account_id: string; reason: string; granted_by: string } | undefined;
  const grant = found ? { ...found } : undefined;
  const parsed = stored ? (JSON.parse(stored.c) as { reason: string; grantedBy: string }) : null;
  assert.deepEqual(
    { reason: parsed?.reason, grantedBy: parsed?.grantedBy, grant },
    {
      reason: pz,
      grantedBy: "boss",
      grant: { principal_id: "other", account_id: "acct", reason: pz, granted_by: "boss" },
    },
  );
  db.close();
});

test("a membership whose scope is the erased id survives and replays under the pseudonym", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE memberships (
      principal_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      PRIMARY KEY (principal_id, scope_type, scope_id));
  `);
  const book = journal(db);
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'member', 'other', 'account', 'user_1', 1)",
  ).run();
  book.forget("user_1", pz);
  book.forget("user_1", pz);
  const foundRow = db.prepare("SELECT a, b, c FROM security_journal").get() as
    | { a: string; b: string; c: string }
    | undefined;
  const row = foundRow ? { ...foundRow } : undefined;
  book.replay();
  const foundMember = db.prepare("SELECT principal_id, scope_type, scope_id FROM memberships").get() as
    | { principal_id: string; scope_type: string; scope_id: string }
    | undefined;
  const member = foundMember ? { ...foundMember } : undefined;
  assert.deepEqual(
    { row, member },
    {
      row: { a: "other", b: "account", c: pz },
      member: { principal_id: "other", scope_type: "account", scope_id: pz },
    },
  );
  db.close();
});

test("a membership whose scope is the erased id replays as the pseudonym and grants nothing", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE memberships (
      principal_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      PRIMARY KEY (principal_id, scope_type, scope_id));
  `);
  const book = new SecurityJournal(sqliteStorage(db));
  book.init();
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'member', 'other', 'account', 'user_1', 1)",
  ).run();
  book.forget("user_1", pz);
  book.forget("user_1", pz);
  book.replay();
  const found = db.prepare("SELECT scope_id FROM memberships").get() as { scope_id: string } | undefined;
  const scopeId = found ? { ...found }.scope_id : "";
  const original = db.prepare("SELECT scope_id FROM memberships WHERE scope_id = ?").get("user_1");
  assert.deepEqual({ scopeId, original: original ?? null }, { scopeId: pz, original: null });
  db.close();
});

test("prose that mentions the erased id is kept as written", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  const book = journal(db);
  const detail = JSON.stringify({
    reason: "hello user_1",
    expiresAt: null,
    grantedBy: "boss",
    approvedBy: null,
    grantedAt: 1,
  });
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'nda', 'other', 'acct', ?, 1)",
  ).run(detail);
  book.forget("user_1", pz);
  book.forget("user_1", pz);
  const stored = db.prepare("SELECT c FROM security_journal").get() as { c: string } | undefined;
  const reason = stored ? (JSON.parse(stored.c) as { reason: string }).reason : null;
  assert.equal(reason, "hello user_1");
  db.close();
});
