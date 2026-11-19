import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const { openSqlite, sqliteStorage } = await import("../runtime/sqlite-storage.ts");

const TENANT = "synthetic";
const OPS = "synthetic-ops-hmac-secret-value-32";
const MCP = "synthetic-mcp-hmac-secret-value-32";
const OPS_URL = "http://127.0.0.1/v1/internal/ops/targets";
const MCP_URL = "http://127.0.0.1/v1/internal/mcp/switches?tenant=synthetic";

type App = {
  request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
};

async function sign(url: string, secret: string, now?: number): Promise<Record<string, string>> {
  const opsUrl = new URL("../../packages/contracts/src/ops-auth.ts", import.meta.url).href;
  const mod = (await import(opsUrl)) as {
    signOpsRequest: (input: {
      secret: string;
      method: string;
      url: string;
      now?: number;
    }) => Promise<Record<string, string>>;
    OPS_HEADER_NONCE: string;
    OPS_HEADER_KID: string;
    OPS_HEADER_SIGNATURE: string;
  };
  const headers = await mod.signOpsRequest({ secret, method: "GET", url, ...(now ? { now } : {}) });
  return headers;
}

async function boot(): Promise<{ api: App; env: unknown; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "residual-signed-"));
  const db = openSqlite(path.join(dir, "tenant.sqlite"));
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: sqliteStorage(db),
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  const policyUrl = new URL("../../src/worker/tenant-policy.ts", import.meta.url).href;
  const Policy = (await import(policyUrl)).TenantPolicy;
  const directory = new Policy(ctx, {});
  await ready;
  directory.seed(
    { tenantId: TENANT, seed: 20261104, personalOwners: ["u_consultant"] },
    [
      {
        id: "u_consultant",
        email: "consultant@synthetic.example",
        roleIds: ["consultant"],
        memberships: [{ scope_type: "circle", scope_id: "c_delivery" }],
      },
    ],
    Date.now(),
  );
  const binding = {
    jurisdiction() {
      return binding;
    },
    idFromName: (name: string) => name,
    get: () => directory,
  };
  const appUrl = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(appUrl)) as {
    createApp: () => App;
  };
  return {
    api: loaded.createApp(),
    env: {
      ENVIRONMENT: "test",
      AUTH_MODE: "access",
      DEFAULT_TENANT_ID: TENANT,
      TENANT_DOMAINS: "{}",
      OPS_HMAC_KEY: OPS,
      INTERNAL_HMAC_KEY: MCP,
      TENANT_POLICY: binding,
      WORKSPACE: binding,
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function status(api: App, env: unknown, url: string, headers: Record<string, string>) {
  const res = await api.request(url, { headers }, env);
  return res.status;
}

test("a signature from the other channel's key is 401 on ops and on mcp", async () => {
  const held = await boot();
  try {
    const opsWithMcp = await sign(OPS_URL, MCP);
    const mcpWithOps = await sign(MCP_URL, OPS);
    assert.equal(await status(held.api, held.env, OPS_URL, opsWithMcp), 401);
    assert.equal(await status(held.api, held.env, MCP_URL, mcpWithOps), 401);
    const opsOk = await sign(OPS_URL, OPS);
    const mcpOk = await sign(MCP_URL, MCP);
    assert.equal(await status(held.api, held.env, OPS_URL, opsOk), 200);
    assert.equal(await status(held.api, held.env, MCP_URL, mcpOk), 200);
  } finally {
    held.remove();
  }
});

test("signed mcp negatives are 401: forged signature, future time, missing nonce, missing kid", async () => {
  const held = await boot();
  try {
    const forged = await sign(MCP_URL, MCP);
    const sig = forged["x-secondary-ops-signature"] ?? "";
    const flipped = sig.endsWith("a") ? `${sig.slice(0, -1)}b` : `${sig.slice(0, -1)}a`;
    forged["x-secondary-ops-signature"] = flipped;
    assert.equal(await status(held.api, held.env, MCP_URL, forged), 401);

    const future = await sign(MCP_URL, MCP, Math.floor(Date.now() / 1000) + 120);
    assert.equal(await status(held.api, held.env, MCP_URL, future), 401);

    const noNonce = await sign(MCP_URL, MCP);
    delete noNonce["x-secondary-ops-nonce"];
    assert.equal(await status(held.api, held.env, MCP_URL, noNonce), 401);

    const noKid = await sign(MCP_URL, MCP);
    delete noKid["x-secondary-ops-key-id"];
    assert.equal(await status(held.api, held.env, MCP_URL, noKid), 401);
  } finally {
    held.remove();
  }
});

test("replaying an identical signed mcp request is 401", async () => {
  const held = await boot();
  try {
    const headers = await sign(MCP_URL, MCP);
    assert.equal(await status(held.api, held.env, MCP_URL, headers), 200);
    assert.equal(await status(held.api, held.env, MCP_URL, headers), 401);
  } finally {
    held.remove();
  }
});

test("changing tenant after the mcp signature is 401", async () => {
  const held = await boot();
  try {
    const headers = await sign(MCP_URL, MCP);
    const tampered = "http://127.0.0.1/v1/internal/mcp/switches?tenant=otherten";
    assert.equal(await status(held.api, held.env, tampered, headers), 401);
  } finally {
    held.remove();
  }
});
