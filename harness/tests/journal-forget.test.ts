/**
 * Journal forget removes the person and leaves a switch row.
 * An NDA detail that names them is rewritten. An unknown row that names
 * them is deleted. A second call leaves the same rows.
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

test("journal forget removes the person, keeps a switch, and redacts an NDA detail", () => {
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
  journal.forget("user_1");
  journal.forget("user_1");
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
      c: JSON.stringify({ reason: "r", expiresAt: null, grantedBy: "", approvedBy: "boss", grantedAt: 1 }),
    },
    { kind: "legacy", a: "other", b: "handbook", c: "" },
  ]);
  db.close();
});
