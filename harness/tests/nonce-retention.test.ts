/**
 * Nonce retention. The exp check is the caller's, before nonceFirst.
 * Pruning and the stored-window assert are tested on real SQLite.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

type Bound = { tokenExpMs: number; maxSkewMs: number };

type NonceHost = {
  nonceFirst(key: string, now: number, ttlMs: number, bound?: Bound): boolean;
  pruneNonces(now: number): number;
};

const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";
const authSpecifier = "../../recovered-source/worker/src/internal-auth.ts";

const SECRET = "synthetic-test-secret-not-a-key!!";
const ENDPOINT = "https://api.invalid/v1/internal/ping";
const SKEW_MS = 60_000;
const T = 1_700_000_000;

const principal = {
  v: 1 as const,
  iss: "secondary-mcp" as const,
  aud: "secondary-api" as const,
  sub: "user-1",
  email: "ada@example.invalid",
  client_id: "client",
  scope: ["read"],
  tool: "ping",
};

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
  const dir = mkdtempSync(path.join(tmpdir(), "nonce-keep-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function expiresAt(file: string, key: string): number | undefined {
  const db = openSqlite(file);
  const row = db.prepare("SELECT expires_at FROM nonces WHERE key = ?").get(key) as
    | { expires_at: number }
    | undefined;
  db.close();
  return row?.expires_at;
}

test("nonce retention: a short window is not stored", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const now = 5_000_000;
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const accepted = policy.nonceFirst("short-SECRET", now, 1_000, {
        tokenExpMs: now,
        maxSkewMs: SKEW_MS,
      });
      assert.equal(accepted, false);
      assert.equal(expiresAt(file, "short-SECRET"), undefined);
      assert.deepEqual(lines, [JSON.stringify({ at: "nonce_window_short" })]);
    } finally {
      console.warn = warn;
    }
  } finally {
    remove();
  }
});

test("nonce retention: a key inside its window is not pruned, and a pruned replay is refused by exp", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const auth = (await import(authSpecifier)) as {
      signInternalRequest(input: {
        secret: string;
        method: string;
        url: string;
        body?: string;
        principal: typeof principal;
        now?: number;
      }): Promise<Record<string, string>>;
      verifyInternalRequest(
        request: Request,
        keys: string,
        options: {
          now?: number;
          replay?: {
            first(key: string, ttlMs: number, bound?: Bound): Promise<boolean>;
          };
        },
      ): Promise<{ ok: true } | { ok: false; reason: string }>;
    };
    const body = "{}";
    const headers = await auth.signInternalRequest({
      secret: SECRET,
      method: "POST",
      url: ENDPOINT,
      body,
      principal,
      now: T,
    });
    const request = () => new Request(ENDPOINT, { method: "POST", headers, body });
    const receiptMs = T * 1000;
    let guardCalls = 0;
    const replay = {
      async first(key: string, ttlMs: number, bound?: Bound) {
        guardCalls += 1;
        return policy.nonceFirst(key, receiptMs, ttlMs, bound);
      },
    };
    const first = await auth.verifyInternalRequest(request(), SECRET, { now: T, replay });
    assert.equal(first.ok, true);
    assert.equal(guardCalls, 1);

    const keyRow = openSqlite(file);
    const rows = keyRow.prepare("SELECT key, expires_at FROM nonces").all() as {
      key: string;
      expires_at: number;
    }[];
    keyRow.close();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.ok(row.expires_at >= T * 1000 + SKEW_MS);

    assert.equal(policy.pruneNonces(receiptMs + SKEW_MS), 0);
    assert.equal(expiresAt(file, row.key), row.expires_at);
    const again = await auth.verifyInternalRequest(request(), SECRET, { now: T + 30, replay });
    assert.deepEqual(again, { ok: false, reason: "replayed" });

    assert.equal(policy.pruneNonces(row.expires_at + 1), 1);
    assert.equal(expiresAt(file, row.key), undefined);
    const callsBefore = guardCalls;
    const late = await auth.verifyInternalRequest(request(), SECRET, { now: T + 61, replay });
    assert.deepEqual(late, { ok: false, reason: "stale_timestamp" });
    assert.equal(guardCalls, callsBefore);
  } finally {
    remove();
  }
});
