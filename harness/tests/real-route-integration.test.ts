import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const EMAIL = "ada@synthetic.example";
const TENANT = "synthetic";
const TEAM = "synthetic.example";
const AUD = "synthetic-aud";
const OPS_SECRET = "synthetic-ops-hmac-secret-value-32";
const MCP_SECRET = "synthetic-mcp-hmac-secret-value-32";

type App = {
  request: (input: string, init: RequestInit | undefined, env: unknown) => Promise<Response>;
};

type Policy = {
  setSwitch: (
    name: string,
    enabled: boolean,
    actor: string,
    now: number,
    twoPerson: boolean,
  ) => { status: string };
};

async function token(): Promise<{ jwt: string; jwks: (team: string) => unknown }> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const jwt = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(privateKey);
  return { jwt, jwks: () => keys };
}

async function policy(off: readonly string[]): Promise<{ binding: unknown; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "real-route-"));
  const db = openSqlite(path.join(dir, "tenant.sqlite"));
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
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const object = new mod.TenantPolicy(ctx, {});
  await ready;
  const now = Date.now();
  for (const name of off) {
    const turned = object.setSwitch(name, false, "ada", now, false);
    assert.equal(turned.status, "applied", name);
  }
  const binding = {
    jurisdiction() {
      return binding;
    },
    idFromName() {
      return "tenant";
    },
    get() {
      return object;
    },
  };
  return { binding, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

const workspace = {
  jurisdiction() {
    return workspace;
  },
  idFromName() {
    return "ws";
  },
  get() {
    return { get: async () => null };
  },
};

function env(binding: unknown) {
  return {
    ENVIRONMENT: "test",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    DEFAULT_TENANT_ID: TENANT,
    TENANT_DOMAINS: JSON.stringify({ [TEAM]: TENANT }),
    OPS_HMAC_KEY: OPS_SECRET,
    INTERNAL_HMAC_KEY: MCP_SECRET,
    TENANT_POLICY: binding,
    WORKSPACE: workspace,
  };
}

async function app(jwks: (team: string) => unknown): Promise<App> {
  const specifier = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(specifier)) as {
    createApp: (deps: { jwks: (team: string) => unknown }) => App;
  };
  return loaded.createApp({ jwks });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

async function signedOps(url: string, secret: string): Promise<Record<string, string>> {
  const specifier = new URL("../../packages/contracts/src/ops-auth.ts", import.meta.url).href;
  const ops = (await import(specifier)) as {
    signOpsRequest: (input: {
      secret: string;
      method: string;
      url: string;
      now: number;
    }) => Promise<Record<string, string>>;
  };
  return ops.signOpsRequest({
    secret,
    method: "GET",
    url,
    now: Math.floor(Date.now() / 1000),
  });
}

function captureRoutes(): { routes: string[]; restore: () => void } {
  const routes: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    try {
      const body = JSON.parse(line) as { route?: string };
      if (typeof body.route === "string") routes.push(body.route);
    } catch {
      // Not a request log.
    }
    original.apply(console, args as []);
  };
  return {
    routes,
    restore: () => {
      console.log = original;
    },
  };
}

describe("real v1 wiring", { concurrency: false }, () => {
test("signed session: sources and contribute follow the TenantPolicy switches", async () => {
  const signed = await token();
  const api = await app(signed.jwks);
  const closed = await policy(["connector", "contribute"]);
  const open = await policy([]);
  const seen = captureRoutes();
  try {
    const auth = { "Cf-Access-Jwt-Assertion": signed.jwt };
    const offSources = await api.request(
      "http://127.0.0.1/v1/sources/s1",
      { headers: auth },
      env(closed.binding),
    );
    assert.equal(seen.routes.at(-1), "/v1/sources/:id");
    assert.equal(offSources.status, 503);
    assert.deepEqual(await json(offSources), { error: "switched_off", switch: "connector" });

    for (const path of ["/v1/sources/s1/", "/v1/sources/s1//", "/v1/sources/s1//x"]) {
      const res = await api.request(`http://127.0.0.1${path}`, { headers: auth }, env(closed.binding));
      assert.equal(res.status, 503, path);
      assert.deepEqual(await json(res), { error: "switched_off", switch: "connector" });
    }
    const doubled = await api.request(
      "http://127.0.0.1/v1//sources/s1",
      { headers: auth },
      env(closed.binding),
    );
    assert.equal(doubled.status, 404);

    const onSources = await api.request(
      "http://127.0.0.1/v1/sources/s1",
      { headers: auth },
      env(open.binding),
    );
    assert.equal(onSources.status, 404);
    assert.deepEqual(await json(onSources), { error: "not_found" });

    const contribute = {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    };
    const offPost = await api.request(
      "http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute",
      contribute,
      env(closed.binding),
    );
    assert.equal(offPost.status, 503);
    assert.deepEqual(await json(offPost), { error: "switched_off", switch: "contribute" });
    const slashed = await api.request(
      "http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute/////",
      contribute,
      env(closed.binding),
    );
    assert.equal(slashed.status, 503);
    assert.deepEqual(await json(slashed), { error: "switched_off", switch: "contribute" });

    const onPost = await api.request(
      "http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute",
      contribute,
      env(open.binding),
    );
    assert.equal(seen.routes.at(-1), "/v1/personal/items/:id/contribute");
    assert.equal(onPost.status, 404);
    assert.deepEqual(await json(onPost), { error: "not_found" });
  } finally {
    seen.restore();
    closed.remove();
    open.remove();
  }
});

test("no Access token is 401 before the switch gate", async () => {
  const signed = await token();
  const api = await app(signed.jwks);
  const held = await policy(["connector", "contribute"]);
  try {
    const sources = await api.request("http://127.0.0.1/v1/sources/s1", {}, env(held.binding));
    assert.equal(sources.status, 401);
    assert.deepEqual(await json(sources), { error: "unauthorized" });
    const post = await api.request(
      "http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      env(held.binding),
    );
    assert.equal(post.status, 401);
    assert.deepEqual(await json(post), { error: "unauthorized" });
  } finally {
    held.remove();
  }
});

test("internal ops and mcp skip switchGate and answer with their own HMAC", async () => {
  const signed = await token();
  const api = await app(signed.jwks);
  const held = await policy(["mcp", "connector", "ai", "contribute"]);
  try {
    const bindings = env(held.binding);
    const opsUrl = "http://127.0.0.1/v1/internal/ops/targets";
    const mcpUrl = "http://127.0.0.1/v1/internal/mcp/switches?tenant=synthetic";
    const unsignedOps = await api.request(opsUrl, {}, bindings);
    assert.equal(unsignedOps.status, 401);
    assert.equal((await json(unsignedOps)).error, "unauthorized");
    const unsignedMcp = await api.request(mcpUrl, {}, bindings);
    assert.equal(unsignedMcp.status, 401);
    assert.equal((await json(unsignedMcp)).error, "unauthorized");

    const opsHeaders = await signedOps(opsUrl, OPS_SECRET);
    const ops = await api.request(opsUrl, { headers: opsHeaders }, bindings);
    assert.equal(ops.status, 200);
    const opsBody = await json(ops);
    assert.equal(opsBody.error, undefined);

    const mcpHeaders = await signedOps(mcpUrl, MCP_SECRET);
    const mcp = await api.request(mcpUrl, { headers: mcpHeaders }, bindings);
    assert.equal(mcp.status, 200);
    const flags = (await json(mcp)).switches as Record<string, boolean>;
    assert.deepEqual(flags, { mcp: false, connector: false, ai: false, contribute: false });
  } finally {
    held.remove();
  }
});
});
