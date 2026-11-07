/**
 * Real recovered auth, tenant, and resource gates.
 * Service bindings in this file throw or are absent. They are not live Workers.
 * The cloudflare:workers class used to load the module graph is a test stub.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { devBypassEmail, internalRouteVerdict, verifyAccessJwt } from "../../recovered-source/worker/src/auth.ts";
import { parseSessionValue } from "../../recovered-source/worker/src/auth/session.ts";
import { checkSourceAccess } from "../../recovered-source/worker/src/connector.ts";

const SECRET = "synthetic-test-secret-not-a-key!!";

function baseEnv() {
  return {
    ENVIRONMENT: "reconstruction",
    DEFAULT_TENANT_ID: "tenant_reconstruction",
    RATE_LIMIT_PER_MIN: "60",
    TENANT_DOMAINS: "{}",
  };
}

async function app() {
  const { createApp } = await import("../../reconstruction/worker-root/worker/src/index.ts");
  return createApp();
}

test("an unknown request receives 401 and no principal on /v1/me and /v1/nodes", async () => {
  const api = await app();
  const env = baseEnv();
  for (const path of ["/v1/me", "/v1/nodes/pb:u_ceo", "/v1/map"]) {
    const res = await api.request(`http://api.invalid${path}`, { method: "GET" }, env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(body, { error: "unauthorized" });
  }
});

test("dev bypass does not identify a non-dev host or a non-dev environment", async () => {
  const env = { ...baseEnv(), DEV_AUTH_BYPASS_EMAIL: "person@example.invalid" };
  assert.equal(devBypassEmail(env, "http://127.0.0.1/v1/me"), null);
  const dev = { ...env, ENVIRONMENT: "dev" };
  assert.equal(devBypassEmail(dev, "http://api.invalid/v1/me"), null);
  assert.equal(devBypassEmail(dev, "http://127.0.0.1/v1/me"), "person@example.invalid");

  const api = await app();
  const res = await api.request(
    "http://127.0.0.1/v1/me",
    { method: "GET", headers: { "X-Demo-Persona": "ceo" } },
    env,
  );
  assert.equal(res.status, 401);
  assert.equal(JSON.stringify(await res.json()).includes("person@example.invalid"), false);
});

test("Access verification fails closed before any JWKS call when Access is not configured", async () => {
  let called = false;
  const email = await verifyAccessJwt("not-a-jwt", baseEnv(), {
    jwks() {
      called = true;
      throw new Error("jwks must not be called");
    },
  });
  assert.equal(email, null);
  assert.equal(called, false);
});

test("a configured Access verifier still fails closed when the token does not verify", async () => {
  const env = {
    ...baseEnv(),
    ACCESS_TEAM_DOMAIN: "access.invalid",
    ACCESS_AUD: "synthetic-audience",
  };
  const email = await verifyAccessJwt("not-a-jwt", env, {
    jwks: () => async () => {
      throw new Error("no key material in this test");
    },
  });
  assert.equal(email, null);
});

test("a session prefix for an unknown tenant is rejected", async () => {
  const env = {
    ...baseEnv(),
    SCIM_TENANT_ID: "tenant_scim",
    TENANT_DOMAINS: JSON.stringify({ "example.invalid": "tenant_reconstruction" }),
  };
  assert.ok(await parseSessionValue("tenant_reconstruction.token-value", env));
  assert.equal(await parseSessionValue("tenant_other.token-value", env), null);
  assert.equal(await parseSessionValue("no-dot", env), null);
});

test("MCP internal routes deny unknown paths and missing scopes", () => {
  assert.equal(internalRouteVerdict("GET", "/v1/me", ["secondary.read"]), "ok");
  assert.equal(internalRouteVerdict("GET", "/v1/me", []), "no");
  assert.equal(internalRouteVerdict("GET", "/v1/admin/switches", ["secondary.read"]), "no");
  assert.equal(internalRouteVerdict("POST", "/v1/actions", ["secondary.read"]), "no");
  assert.equal(internalRouteVerdict("POST", "/v1/personal/items", ["secondary.read"]), "no");
});

test("provider list and Entra routes stay closed without a directory", async () => {
  const api = await app();
  const env = baseEnv();
  const providers = await api.request("http://api.invalid/auth/providers", { method: "GET" }, env);
  assert.equal(providers.status, 200);
  assert.deepEqual(await providers.json(), {
    entra: false,
    access: true,
    loginUrl: "/auth/login",
  });
  const login = await api.request("http://api.invalid/auth/login", { method: "GET" }, env);
  assert.equal(login.status, 404);
  assert.deepEqual(await login.json(), { error: "entra_disabled" });
  const callback = await api.request(
    "http://api.invalid/auth/callback?state=abc&code=xyz",
    { method: "GET" },
    env,
  );
  assert.equal(callback.status, 404);
});

test("an Entra callback with no login cookie is invalid_state and does not call a directory", async () => {
  const api = await app();
  let called = false;
  const env = {
    ...baseEnv(),
    AUTH_MODE: "entra",
    ENTRA_TENANT_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ENTRA_CLIENT_ID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ENTRA_CLIENT_SECRET: "synthetic-not-a-secret",
    TENANT_POLICY: {
      jurisdiction() {
        return this;
      },
      idFromName() {
        return "id";
      },
      get() {
        called = true;
        throw new Error("directory must not be called");
      },
    },
  };
  const res = await api.request(
    "http://api.invalid/auth/callback?state=abc&code=xyz",
    { method: "GET" },
    env,
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_state" });
  assert.equal(called, false);
});

test("logout from another origin is forbidden", async () => {
  const api = await app();
  const res = await api.request(
    "http://api.invalid/auth/logout",
    { method: "POST", headers: { Origin: "http://evil.invalid" } },
    baseEnv(),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden" });
});

test("readiness does not become ready when bindings are missing or reject", async () => {
  const { readiness, resetReadinessCache } = await import(
    "../../reconstruction/worker-root/worker/src/observe.ts"
  );
  // A missing namespace throws while the stub is built, before the timeout wrapper.
  resetReadinessCache();
  await assert.rejects(() => readiness(baseEnv(), 1), /jurisdiction/);

  resetReadinessCache();
  const failing = await readiness(
    {
      ...baseEnv(),
      TENANT_POLICY: {
        jurisdiction() {
          return this;
        },
        idFromName() {
          return "id";
        },
        get() {
          return { epoch: () => Promise.reject(new Error("directory down")) };
        },
      },
      BLOBS: { head: () => Promise.reject(new Error("bucket down")) },
    },
    2,
  );
  assert.deepEqual(failing, { ready: false, checks: { do: "fail", r2: "fail" } });

  const api = await app();
  resetReadinessCache();
  const res = await api.request("http://api.invalid/v1/ready", { method: "GET" }, baseEnv());
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error, "internal_error");
  assert.equal(json.ready, undefined);
  assert.equal(JSON.stringify(json).includes("jurisdiction"), false);
});

test("source access grants nothing unless the connector explicitly allows that id", async () => {
  const user = { id: "u_consultant", email: "consultant@example.invalid" };
  const ids = ["src:source1:0123456789abcdef01234567", "src:source1:abcdefabcdefabcdefabcd"];
  const missing = await checkSourceAccess(
    { ...baseEnv(), CONNECTOR_HMAC_KEY: SECRET },
    "tenant_reconstruction",
    user,
    ids,
  );
  assert.equal(missing.size, 0);

  const denied = await checkSourceAccess(
    {
      ...baseEnv(),
      CONNECTOR_HMAC_KEY: SECRET,
      CONNECTOR: {
        async fetch() {
          return new Response(JSON.stringify({ results: { [ids[0]]: { allowed: false } } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    "tenant_reconstruction",
    user,
    ids,
  );
  assert.equal(denied.size, 0);

  const one = await checkSourceAccess(
    {
      ...baseEnv(),
      CONNECTOR_HMAC_KEY: SECRET,
      CONNECTOR: {
        async fetch() {
          return new Response(
            JSON.stringify({
              results: {
                [ids[0]]: { allowed: true, body: "must-not-matter" },
                [ids[1]]: { allowed: "true" },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    },
    "tenant_reconstruction",
    user,
    ids,
  );
  assert.deepEqual([...one], [ids[0]]);
});

test("health names the environment and no person", async () => {
  const api = await app();
  const res = await api.request("http://api.invalid/v1/health", { method: "GET" }, baseEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.env, "reconstruction");
  assert.equal(JSON.stringify(body).includes("@"), false);
});
