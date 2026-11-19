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
import {
  CLOCK_GRANULARITY_MS,
  MAX_SKEW_SECONDS,
} from "../../recovered-source/shared/packages/contracts/src/signed-call.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

type Bound = { tokenExpMs: number; maxSkewMs: number };

type NonceHost = {
  nonceFirst(key: string, now: number, ttlMs: number, bound?: Bound): boolean;
  pruneNonces(now: number): number;
};

const policySpecifier = "../../src/worker/tenant-policy.ts";
const authSpecifier = "../../src/worker/internal-auth.ts";
const opsSpecifier = "../../recovered-source/shared/packages/contracts/src/ops-auth.ts";

const SECRET = "synthetic-test-secret-not-a-key!!";
const ENDPOINT = "https://api.invalid/v1/internal/ping";
const SKEW_MS = MAX_SKEW_SECONDS * CLOCK_GRANULARITY_MS;
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

test("nonce retention: an unsafe bound is not stored", async () => {
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
      for (const bound of [
        { tokenExpMs: now, maxSkewMs: -1 },
        { tokenExpMs: Number.NaN, maxSkewMs: SKEW_MS },
      ]) {
        const accepted = policy.nonceFirst("short-SECRET", now, 1_000, bound);
        assert.equal(accepted, false);
        assert.equal(expiresAt(file, "short-SECRET"), undefined);
      }
      assert.deepEqual(lines, [
        JSON.stringify({ at: "nonce_window_short" }),
        JSON.stringify({ at: "nonce_window_short" }),
      ]);
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
    const receiptMs = T * CLOCK_GRANULARITY_MS;
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
    assert.ok(row.expires_at >= T * CLOCK_GRANULARITY_MS + SKEW_MS);

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

/**
 * Receipt time is milliseconds. The verifier's `now` is the floored unix second, matching
 * auth.ts and ops-internal.ts. nonceFirst receives the same receipt the production store does.
 */
function replayAt(policy: NonceHost, atMs: { value: number }, calls: { n: number }) {
  return {
    async first(key: string, ttlMs: number, bound?: Bound) {
      calls.n += 1;
      return policy.nonceFirst(key, atMs.value, ttlMs, bound);
    },
  };
}

test("nonce retention: an early accept stays refused at the far second after a mid-window prune", async () => {
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
    const ops = (await import(opsSpecifier)) as {
      signOpsRequest(input: {
        secret: string;
        method: string;
        url: string;
        body?: string;
        now?: number;
      }): Promise<Record<string, string>>;
      verifyOpsRequest(
        request: Request,
        keys: string,
        options: {
          now?: number;
          replay?: {
            first(key: string, ttlMs: number, bound?: Bound): Promise<boolean>;
          };
        },
      ): Promise<boolean>;
    };
    const earlyMs = (T - MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS;
    const pruneMs = (T + MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS + 500;
    const farMs = (T + MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS;
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
    const at = { value: earlyMs };
    const calls = { n: 0 };
    const replay = replayAt(policy, at, calls);
    const first = await auth.verifyInternalRequest(request(), SECRET, {
      now: Math.floor(earlyMs / CLOCK_GRANULARITY_MS),
      replay,
    });
    assert.equal(first.ok, true);
    const rows = openSqlite(file).prepare("SELECT key, expires_at FROM nonces").all() as {
      key: string;
      expires_at: number;
    }[];
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    const pruned = policy.pruneNonces(pruneMs);
    at.value = farMs;
    const again = await auth.verifyInternalRequest(request(), SECRET, {
      now: T + MAX_SKEW_SECONDS,
      replay,
    });
    assert.equal(again.ok, false);
    assert.equal(pruned, 0);
    assert.equal(expiresAt(file, row.key), row.expires_at);

    const opsBody = "{}";
    const opsUrl = "https://api.invalid/v1/ops/export";
    const opsHeaders = await ops.signOpsRequest({
      secret: SECRET,
      method: "POST",
      url: opsUrl,
      body: opsBody,
      now: T,
    });
    const opsRequest = () => new Request(opsUrl, { method: "POST", headers: opsHeaders, body: opsBody });
    const opsAt = { value: earlyMs };
    const opsCalls = { n: 0 };
    const opsReplay = replayAt(policy, opsAt, opsCalls);
    const opsFirst = await ops.verifyOpsRequest(opsRequest(), SECRET, {
      now: Math.floor(earlyMs / CLOCK_GRANULARITY_MS),
      replay: opsReplay,
    });
    assert.equal(opsFirst, true);
    const opsRows = openSqlite(file).prepare("SELECT key, expires_at FROM nonces").all() as {
      key: string;
      expires_at: number;
    }[];
    const opsRow = opsRows.find((item) => item.key !== row.key);
    assert.ok(opsRow);
    const opsPruned = policy.pruneNonces(pruneMs);
    opsAt.value = farMs;
    const opsAgain = await ops.verifyOpsRequest(opsRequest(), SECRET, {
      now: T + MAX_SKEW_SECONDS,
      replay: opsReplay,
    });
    assert.equal(opsAgain, false);
    assert.equal(opsPruned, 0);
    assert.equal(expiresAt(file, opsRow.key), opsRow.expires_at);
  } finally {
    remove();
  }
});

test("nonce retention: the row survives every accepted instant, and one millisecond later is stale", async () => {
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
    const at = { value: (T - MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS };
    const calls = { n: 0 };
    const replay = replayAt(policy, at, calls);
    const first = await auth.verifyInternalRequest(request(), SECRET, {
      now: Math.floor(at.value / CLOCK_GRANULARITY_MS),
      replay,
    });
    assert.equal(first.ok, true);
    const stored = openSqlite(file).prepare("SELECT expires_at FROM nonces").all() as {
      expires_at: number;
    }[];
    assert.equal(stored.length, 1);
    const expires = stored[0]?.expires_at;
    assert.equal(typeof expires, "number");
    for (let second = T - MAX_SKEW_SECONDS; second <= T + MAX_SKEW_SECONDS; second += 1) {
      assert.equal(policy.pruneNonces(second * CLOCK_GRANULARITY_MS), 0, String(second));
      assert.equal(
        policy.pruneNonces(second * CLOCK_GRANULARITY_MS + (CLOCK_GRANULARITY_MS - 1)),
        0,
        String(second),
      );
    }
    const left = openSqlite(file).prepare("SELECT COUNT(*) AS n FROM nonces").get() as { n: number };
    assert.equal(left.n, 1);
    const before = calls.n;
    const lateMs = (T + MAX_SKEW_SECONDS) * CLOCK_GRANULARITY_MS + CLOCK_GRANULARITY_MS;
    at.value = lateMs;
    const late = await auth.verifyInternalRequest(request(), SECRET, {
      now: Math.floor(lateMs / CLOCK_GRANULARITY_MS),
      replay,
    });
    assert.deepEqual(late, { ok: false, reason: "stale_timestamp" });
    assert.equal(calls.n, before);
    assert.equal(expires, (T + MAX_SKEW_SECONDS + 1) * CLOCK_GRANULARITY_MS);
  } finally {
    remove();
  }
});
