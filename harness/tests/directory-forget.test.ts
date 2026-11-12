/**
 * Directory erase removes the person from invite lists.
 * A mixed-case member and an unreadable list that names them do not survive.
 * A second erase leaves the lists.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

type Policy = {
  erasePrincipal(principalId: string, pseudonym: string): Promise<number>;
};

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

async function openPolicy(db: DatabaseSync): Promise<Policy> {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: sqliteStorage(db),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
    blockConcurrencyWhile(fn: () => Promise<unknown>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(policySpecifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  return policy;
}

test("directory erase removes a cohort member in any case, and an unreadable list that names them", async () => {
  const db = new DatabaseSync(":memory:");
  const policy = await openPolicy(db);
  db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'Ada@Example.com')").run();
  const insert = db.prepare(
    "INSERT INTO pilot_cohorts (id, name, members, flags, created_at) VALUES (?, ?, ?, '{}', 1)",
  );
  insert.run("team", "Team", JSON.stringify(["Ada@Example.com", "other@example.com"]));
  insert.run("plain", "Plain", JSON.stringify(["kept@example.com"]));
  insert.run("bad", "Bad", '["kept@example.com", Ada@Example.com');
  const pz = await pseudonym("user_1");
  let thrown: string | null = null;
  try {
    await policy.erasePrincipal("user_1", pz);
    await policy.erasePrincipal("user_1", pz);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  const cohorts = db
    .prepare("SELECT id, members FROM pilot_cohorts ORDER BY id")
    .all()
    .map((row) => ({ ...(row as { id: string; members: string }) }));
  assert.deepEqual(
    { thrown, cohorts },
    {
      thrown: null,
      cohorts: [
        { id: "bad", members: "[]" },
        { id: "plain", members: JSON.stringify(["kept@example.com"]) },
        { id: "team", members: JSON.stringify(["other@example.com"]) },
      ],
    },
  );
  db.close();
});

test("directory erase uses the pseudonym it was given and does not read the key itself", async () => {
  const pz = await pseudonym("user_1");
  const db = new DatabaseSync(":memory:");
  const policy = await openPolicy(db);
  db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'ada@example.invalid')").run();
  const detail = JSON.stringify({
    reason: "r",
    expiresAt: null,
    grantedBy: "user_1",
    approvedBy: "boss",
    grantedAt: 1,
  });
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'status', 'user_1', '', '', 0)",
  ).run();
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'nda', 'other', 'acct', ?, 0)",
  ).run(detail);
  db.prepare(
    "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'legacy', 'other', 'handbook', '', 0)",
  ).run();
  await policy.erasePrincipal("user_1", pz);
  await policy.erasePrincipal("user_1", pz);
  const rows = db
    .prepare("SELECT kind, a, b, c FROM security_journal ORDER BY seq")
    .all()
    .map((row) => ({ ...(row as { kind: string; a: string; b: string; c: string }) }));
  assert.deepEqual(rows, [
    {
      kind: "nda",
      a: "other",
      b: "acct",
      c: JSON.stringify({ reason: "r", expiresAt: null, grantedBy: pz, approvedBy: "boss", grantedAt: 1 }),
    },
    { kind: "legacy", a: "other", b: "handbook", c: "" },
  ]);
  db.close();
});
