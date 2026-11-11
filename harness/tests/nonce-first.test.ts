/**
 * Replay nonce guard. Calls TenantPolicy.nonceFirst on Node's built-in SQLite.
 * The repo has no D1 or Miniflare test pool. node:sqlite is the runtime's SQLite.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

type NonceHost = {
  nonceFirst(key: string, now: number, ttlMs: number): boolean;
};

const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

async function openPolicy(file: string): Promise<NonceHost> {
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
  const mod = (await import(policySpecifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => NonceHost;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  return policy;
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "nonce-first-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("nonce first: a key is accepted once, and expiry does not reopen it", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    assert.equal(policy.nonceFirst("nonce-a", 1_000, 100), true);
    assert.equal(policy.nonceFirst("nonce-a", 1_050, 100), false);
    assert.equal(policy.nonceFirst("nonce-a", 1_100, 100), false);
    assert.equal(policy.nonceFirst("nonce-b", 1_100, 100), true);
  } finally {
    remove();
  }
});

test("nonce first: concurrent inserts of one key accept exactly one", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (workerData: unknown) =>
      new Promise<boolean>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/nonce-first-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData,
        });
        worker.once("message", (accepted: boolean) => resolve(accepted));
        worker.once("error", reject);
      });
    const data = { file, key: "nonce-race", now: 5_000, ttl: 100, barrier };
    const accepted = await Promise.all([run(data), run(data)]);
    assert.deepEqual(accepted.sort(), [false, true]);
  } finally {
    remove();
  }
});
