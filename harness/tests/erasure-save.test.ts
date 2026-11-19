/**
 * A receipt-ledger write carries a version. An older version that arrives
 * later does not replace the newer row. Writing the newer version again
 * leaves that row.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const policySpecifier = "../../src/worker/tenant-policy.ts";

type Policy = {
  erasureSave(principalId: string, status: string, ledger: string, updatedAt: number): void;
};

function ledger(version: number, cursor: string): string {
  return JSON.stringify({
    v: version,
    order: ["receipts"],
    mark: { receipts: "pending" },
    receipts: { tag: "partial", rewritten: version, cursor },
  });
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

test("an older erasure ledger version does not replace a newer one", async () => {
  const db = new DatabaseSync(":memory:");
  const policy = await openPolicy(db);
  const newer = ledger(2, "c2");
  const older = ledger(1, "c1");
  policy.erasureSave("user_1", "running", newer, 20);
  policy.erasureSave("user_1", "running", older, 10);
  const afterOlder = db
    .prepare("SELECT status, ledger, updated_at FROM erasure_requests WHERE principal_id = 'user_1'")
    .get() as { status: string; ledger: string; updated_at: number };
  policy.erasureSave("user_1", "running", newer, 20);
  const final = db
    .prepare("SELECT status, ledger, updated_at FROM erasure_requests WHERE principal_id = 'user_1'")
    .get() as { status: string; ledger: string; updated_at: number };
  const picture = (row: { status: string; ledger: string; updated_at: number }) => ({
    ...(row as { status: string; ledger: string; updated_at: number }),
  });
  assert.deepEqual(
    { afterOlder: picture(afterOlder), final: picture(final) },
    {
      afterOlder: { status: "running", ledger: newer, updated_at: 20 },
      final: { status: "running", ledger: newer, updated_at: 20 },
    },
  );
  db.close();
});

test("an unversioned erasure ledger cannot replace a versioned row", async () => {
  const db = new DatabaseSync(":memory:");
  const policy = await openPolicy(db);
  const versioned = ledger(2, "c2");
  const bare = JSON.stringify({ order: ["receipts"], mark: { receipts: "done" } });
  policy.erasureSave("user_1", "running", versioned, 20);
  policy.erasureSave("user_1", "completed", bare, 30);
  policy.erasureSave("user_1", "completed", bare, 31);
  const row = db
    .prepare("SELECT status, ledger, updated_at FROM erasure_requests WHERE principal_id = 'user_1'")
    .get() as { status: string; ledger: string; updated_at: number };
  assert.deepEqual(
    { ...(row as { status: string; ledger: string; updated_at: number }) },
    { status: "running", ledger: versioned, updated_at: 20 },
  );
  db.close();
});
