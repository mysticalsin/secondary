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
  erasePrincipal(principalId: string): number;
};

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
  let thrown: string | null = null;
  try {
    policy.erasePrincipal("user_1");
    policy.erasePrincipal("user_1");
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
