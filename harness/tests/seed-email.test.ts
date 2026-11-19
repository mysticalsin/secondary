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

test("seed: a malformed address is not stored raw", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "seed-email-"));
  const file = path.join(dir, "tenant.sqlite");
  try {
    const db = openSqlite(file);
    const sql = sqliteStorage(db);
    let ready: Promise<void> = Promise.resolve();
    const ctx = {
      storage: {
        sql,
        transactionSync<T>(fn: () => T): T {
          return fn();
        },
      },
      blockConcurrencyWhile(fn: () => Promise<void>) {
        ready = fn();
        return ready;
      },
    };
    const specifier = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
    const mod = (await import(specifier)) as {
      TenantPolicy: new (ctx: unknown, env: unknown) => {
        seed: (
          config: { tenantId: string; seed: number; personalOwners: string[] },
          principals: { id: string; email: string; roleIds: string[]; memberships: [] }[],
          now: number,
        ) => number;
      };
    };
    const policy = new mod.TenantPolicy(ctx, {});
    await ready;
    policy.seed({ tenantId: "tenant_mantu_synthetic", seed: 1, personalOwners: [] }, [
      { id: "bad", email: "@folded.example", roleIds: [], memberships: [] },
    ], 1_700_000_000_000);
    const row = db.prepare("SELECT email FROM principals WHERE id = ?").get("bad") as
      | { email: string }
      | undefined;
    assert.equal(row, undefined);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
