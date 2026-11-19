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
const CONNECTOR_SECRET = "synthetic-connector-hmac-secret-32";
const PRINCIPAL = "u_consultant";
const SOURCE_ID = "src:sharep:0123456789abcdef01234567";
const ITEM_ID = "pi:abcd1234";
const NOW = 1_700_000_000_000;

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
  seed: (
    config: { tenantId: string; seed: number; personalOwners: string[] },
    principals: {
      id: string;
      email: string;
      roleIds: string[];
      memberships: { scope_type: "circle"; scope_id: string }[];
    }[],
    now: number,
  ) => number;
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

async function policy(
  off: readonly string[],
  seeded = false,
): Promise<{ binding: unknown; remove: () => void }> {
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
  if (seeded) {
    object.seed(
      { tenantId: TENANT, seed: 20261104, personalOwners: [PRINCIPAL] },
      [
        {
          id: PRINCIPAL,
          email: EMAIL,
          roleIds: ["consultant"],
          memberships: [
            { scope_type: "circle", scope_id: "c_delivery" },
            { scope_type: "circle", scope_id: "c_eng" },
          ],
        },
      ],
      NOW,
    );
  }
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

function workspace(ready: boolean) {
  const store = {
    jurisdiction() {
      return store;
    },
    idFromName() {
      return "ws";
    },
    get() {
      return {
        get: async (id: string) =>
          ready && id === ITEM_ID
            ? { id, kind: "personalitem", label: "Note", body: "Plain note", revision: 1 }
            : null,
        sourceGet: async (id: string) =>
          ready && id === SOURCE_ID
            ? {
                id,
                title: "Synthetic file",
                gateNodeId: "c_delivery",
                plane: "TEAM_RESTRICTED",
                webUrl: "https://synthetic.example/file",
                mime: "text/plain",
                size: 4,
                body: "note",
                syncedAt: NOW,
              }
            : null,
        create: async () => ({ id: "cand:c_delivery:abcd1234", status: "candidate", revision: 1 }),
        addContribution: async () => undefined,
      };
    },
  };
  return store;
}

function env(binding: unknown, ready = false) {
  return {
    ENVIRONMENT: "test",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    DEFAULT_TENANT_ID: TENANT,
    TENANT_DOMAINS: JSON.stringify({ [TEAM]: TENANT }),
    OPS_HMAC_KEY: OPS_SECRET,
    INTERNAL_HMAC_KEY: MCP_SECRET,
    CONNECTOR_HMAC_KEY: CONNECTOR_SECRET,
    TENANT_POLICY: binding,
    WORKSPACE: workspace(ready),
    AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
    CONNECTOR: {
      fetch: async () => Response.json({ results: { [SOURCE_ID]: { allowed: true } } }),
    },
  };
}

async function app(jwks: (team: string) => unknown, now?: () => number): Promise<App> {
  const specifier = new URL("../../src/worker/index.ts", import.meta.url).href;
  const loaded = (await import(specifier)) as {
    createApp: (deps: { jwks: (team: string) => unknown; now?: () => number }) => App;
  };
  return loaded.createApp({ jwks, ...(now ? { now } : {}) });
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
    assert.equal(seen.routes.at(-1), "/v1/sources/:id");
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
    const doubledOps = await api.request("http://127.0.0.1/v1/internal//ops/targets", {}, bindings);
    assert.equal(doubledOps.status, 401);
    assert.equal((await json(doubledOps)).error, "unauthorized");
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

test("a forged Access token and a malformed string are both 401", async () => {
  const signed = await token();
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(other.privateKey);
  const api = await app(signed.jwks);
  const held = await policy([]);
  try {
    for (const jwt of [forged, "not-a-jwt"]) {
      const res = await api.request(
        "http://127.0.0.1/v1/sources/s1",
        { headers: { "Cf-Access-Jwt-Assertion": jwt } },
        env(held.binding),
      );
      assert.equal(res.status, 401, jwt.slice(0, 12));
      assert.deepEqual(await json(res), { error: "unauthorized" });
    }
  } finally {
    held.remove();
  }
});

test("the real handlers return the source and the contribution when the switches are on", async () => {
  const signed = await token();
  const api = await app(signed.jwks, () => NOW);
  const held = await policy([], true);
  const seen = captureRoutes();
  try {
    const auth = { "Cf-Access-Jwt-Assertion": signed.jwt };
    const source = await api.request(
      `http://127.0.0.1/v1/sources/${SOURCE_ID}`,
      { headers: auth },
      env(held.binding, true),
    );
    assert.equal(seen.routes.at(-1), "/v1/sources/:id");
    assert.equal(source.status, 200);
    const file = await json(source);
    assert.equal(file.id, SOURCE_ID);
    assert.equal(file.title, "Synthetic file");
    assert.equal(file.kind, "source");

    const post = await api.request(
      `http://127.0.0.1/v1/personal/items/${ITEM_ID}/contribute`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          targetScopeId: "c_delivery",
          user_validated: { by: PRINCIPAL, at: new Date(NOW).toISOString(), revision: 1 },
        }),
      },
      env(held.binding, true),
    );
    assert.equal(seen.routes.at(-1), "/v1/personal/items/:id/contribute");
    assert.equal(post.status, 201);
    const made = await json(post);
    assert.equal(made.ok, true);
    assert.equal(made.status, "candidate");
    assert.equal(typeof made.candidateId, "string");
  } finally {
    seen.restore();
    held.remove();
  }
});
});
