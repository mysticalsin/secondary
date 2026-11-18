/**
 * OIDC callback against the real auth routes and a real login row in SQLite.
 * Every terminal path consumes the row. A second use of that state is refused.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import { installLoginTenant, type LoginTenant } from "../runtime/fake-tenant-stub.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
register(new URL("../runtime/login-stub-hook.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const routesSpecifier = "../../recovered-source/worker/src/auth/routes.ts";
const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";
const oidcSpecifier = "../../recovered-source/worker/src/auth/oidc.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const OID = "33333333-3333-3333-3333-333333333333";
const DIR = "acme";
const NOW = Date.parse("2026-11-11T00:00:00Z");
const LOGIN_COOKIE = "__Host-secondary_login";
const SESSION_COOKIE = "__Host-secondary_session";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const env = {
  AUTH_MODE: "entra",
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: CLIENT,
  ENTRA_CLIENT_SECRET: "synthetic-client-secret",
  DEFAULT_TENANT_ID: DIR,
};

type Policy = LoginTenant;

async function openPolicy(file: string): Promise<Policy> {
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
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  installLoginTenant(policy);
  return policy;
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "oidc-login-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function rowNonce(file: string, stateHash: string): string | undefined {
  const db = openSqlite(file);
  const row = db.prepare("SELECT nonce FROM login_state WHERE state_hash = ?").get(stateHash) as
    | { nonce: string }
    | undefined;
  db.close();
  return row?.nonce;
}

let gate: Promise<void> = Promise.resolve();

function serial(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    const previous = gate;
    let release: () => void = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await fn();
    } finally {
      release();
    }
  });
}

type App = {
  request: (input: string, init?: RequestInit, env?: unknown) => Promise<Response>;
};

type Routes = {
  authRoutes(deps: {
    now?: () => number;
    entra?: {
      fetch?: typeof fetch;
      jwks?: (uri: URL) => Promise<CryptoKey> | CryptoKey | (() => Promise<CryptoKey>);
    };
  }): App;
};

async function loadRoutes(): Promise<Routes> {
  return (await import(routesSpecifier)) as Routes;
}

async function sha256Hex(value: string): Promise<string> {
  const oidc = (await import(oidcSpecifier)) as {
    sha256Hex(value: string): Promise<string>;
  };
  return oidc.sha256Hex(value);
}

function discovery(): Response {
  return Response.json({
    issuer: ISSUER,
    authorization_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    jwks_uri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
  });
}

async function callback(
  app: App,
  query: Record<string, string>,
  cookieState?: string,
  bindings: unknown = env,
): Promise<{ status: number; location: string | null; logs: string[]; setCookie: string }> {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const params = new URLSearchParams(query);
    const headers = new Headers();
    if (cookieState) headers.set("cookie", `${LOGIN_COOKIE}=${cookieState}`);
    const res = await app.request(`https://api.invalid/callback?${params}`, { headers }, bindings);
    return {
      status: res.status,
      location: res.headers.get("location"),
      logs: lines,
      setCookie: res.headers.get("set-cookie") ?? "",
    };
  } finally {
    console.warn = warn;
  }
}

function noSecrets(logs: string[], secrets: string[]): void {
  const joined = logs.join("\n");
  for (const secret of secrets) assert.equal(joined.includes(secret), false, secret);
}

serial("oidc callback: an IdP error consumes the login row and logs only the reason", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const state = "secret-state-idp";
    const code = "secret-code-idp";
    const hash = await sha256Hex(state);
    policy.loginStatePut(hash, "nonce-idp", "verifier-idp", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(
      app,
      { error: "access_denied", state, code },
      state,
    );
    assert.equal(res.status, 400);
    assert.equal(rowNonce(file, hash), undefined);
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "idp_error" })]);
    noSecrets(res.logs, [state, code, "nonce-idp", "verifier-idp"]);
    const again = await callback(app, { state, code }, state);
    assert.equal(again.status, 400);
    assert.equal(rowNonce(file, hash), undefined);
    assert.equal(again.setCookie.includes(SESSION_COOKIE), false);
    noSecrets(again.logs, [state, code, "nonce-idp", "verifier-idp"]);
  } finally {
    remove();
  }
});

serial("oidc callback: a missing state consumes the cookie's login row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const state = "secret-state-missing";
    const hash = await sha256Hex(state);
    policy.loginStatePut(hash, "nonce-missing", "verifier-missing", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(app, { code: "secret-code-missing" }, state);
    assert.equal(res.status, 400);
    assert.equal(rowNonce(file, hash), undefined);
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "missing_state" })]);
    noSecrets(res.logs, [state, "secret-code-missing", "nonce-missing", "verifier-missing"]);
  } finally {
    remove();
  }
});

serial("oidc callback: a state mismatch consumes only the cookie login row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const cookieState = "secret-state-cookie";
    const queryState = "secret-state-query";
    const cookieHash = await sha256Hex(cookieState);
    const queryHash = await sha256Hex(queryState);
    policy.loginStatePut(cookieHash, "nonce-cookie", "verifier-cookie", "/", NOW, "ip");
    policy.loginStatePut(queryHash, "nonce-query", "verifier-query", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(
      app,
      { state: queryState, code: "secret-code-mismatch" },
      cookieState,
    );
    assert.equal(res.status, 400);
    assert.equal(res.setCookie.includes(SESSION_COOKIE), false);
    assert.equal(rowNonce(file, cookieHash), undefined);
    assert.equal(rowNonce(file, queryHash), "nonce-query");
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "state_mismatch" })]);
    noSecrets(res.logs, [cookieState, queryState, "secret-code-mismatch", "verifier-cookie", "nonce-query"]);
  } finally {
    remove();
  }
});

serial("oidc callback: an idp error does not consume a login row named only by the query", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const cookieState = "secret-state-idp-cookie";
    const queryState = "secret-state-idp-query";
    const cookieHash = await sha256Hex(cookieState);
    const queryHash = await sha256Hex(queryState);
    policy.loginStatePut(cookieHash, "nonce-idp-cookie", "verifier-idp-cookie", "/", NOW, "ip");
    policy.loginStatePut(queryHash, "nonce-idp-query", "verifier-idp-query", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(
      app,
      { error: "access_denied", state: queryState, code: "secret-code-idp-foreign" },
      cookieState,
    );
    assert.equal(res.status, 400);
    assert.equal(res.setCookie.includes(SESSION_COOKIE), false);
    assert.equal(rowNonce(file, cookieHash), undefined);
    assert.equal(rowNonce(file, queryHash), "nonce-idp-query");
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "idp_error" })]);
    noSecrets(res.logs, [cookieState, queryState, "secret-code-idp-foreign", "nonce-idp-query", "verifier-idp-query"]);
  } finally {
    remove();
  }
});

serial("oidc callback: a missing cookie does not consume the query login row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const queryState = "secret-state-query-only";
    const queryHash = await sha256Hex(queryState);
    policy.loginStatePut(queryHash, "nonce-query-only", "verifier-query-only", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(app, { state: queryState });
    assert.equal(res.status, 400);
    assert.equal(res.setCookie.includes(SESSION_COOKIE), false);
    assert.equal(rowNonce(file, queryHash), "nonce-query-only");
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "missing_state" })]);
    noSecrets(res.logs, [queryState, "nonce-query-only", "verifier-query-only"]);
  } finally {
    remove();
  }
});

serial("oidc callback: a failed code exchange consumes the login row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const state = "secret-state-exchange";
    const code = "secret-code-exchange";
    const hash = await sha256Hex(state);
    policy.loginStatePut(hash, "nonce-exchange", "verifier-exchange", "/done", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({
      now: () => NOW,
      entra: {
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("openid-configuration")) return discovery();
          return new Response("rejected", { status: 400 });
        },
      },
    });
    const res = await callback(app, { state, code }, state);
    assert.equal(res.status, 401);
    assert.equal(rowNonce(file, hash), undefined);
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "exchange_failed" })]);
    noSecrets(res.logs, [state, code, "nonce-exchange", "verifier-exchange"]);
  } finally {
    remove();
  }
});

serial("oidc callback: success opens a session, and a replay of that state is refused", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const state = "secret-state-ok";
    const code = "secret-code-ok";
    const nonce = "nonce-ok";
    const verifier = "verifier-ok";
    const hash = await sha256Hex(state);
    policy.loginStatePut(hash, nonce, verifier, "/done", NOW, "ip");
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const idToken = await new SignJWT({
      tid: TENANT,
      nonce,
      oid: OID,
      preferred_username: "ada@example.invalid",
      ver: "2.0",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("sub-1")
      .setIssuer(ISSUER)
      .setAudience(CLIENT)
      .setIssuedAt(Math.floor(NOW / 1000))
      .setExpirationTime(Math.floor(NOW / 1000) + 600)
      .sign(privateKey);
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({
      now: () => NOW,
      entra: {
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("openid-configuration")) return discovery();
          return Response.json({ id_token: idToken });
        },
        jwks: () => async () => publicKey,
      },
    });
    const ok = await callback(app, { state, code }, state);
    assert.equal(ok.status, 303);
    assert.equal(ok.location, "/done");
    assert.equal(ok.setCookie.includes(SESSION_COOKIE), true);
    assert.equal(rowNonce(file, hash), undefined);
    noSecrets(ok.logs, [state, code, nonce, verifier, idToken]);
    const again = await callback(app, { state, code }, state);
    assert.equal(again.status, 400);
    assert.equal(rowNonce(file, hash), undefined);
    assert.equal(again.setCookie.includes(SESSION_COOKIE), false);
    noSecrets(again.logs, [state, code, nonce, verifier, idToken]);
  } finally {
    remove();
  }
});

serial("oidc callback: a login older than 600 seconds is rejected and the row is deleted", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const state = "secret-state-expired";
    const code = "secret-code-expired";
    const hash = await sha256Hex(state);
    policy.loginStatePut(hash, "nonce-expired", "verifier-expired", "/done", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW + 601_000 });
    const res = await callback(app, { state, code }, state);
    assert.equal(res.status, 400);
    assert.equal(res.setCookie.includes(SESSION_COOKIE), false);
    assert.equal(rowNonce(file, hash), undefined);
    noSecrets(res.logs, [state, code, "nonce-expired", "verifier-expired"]);
  } finally {
    remove();
  }
});

serial("oidc callback: a disabled IdP consumes the cookie login row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const cookieState = "secret-state-disabled";
    const queryState = "secret-state-other";
    const cookieHash = await sha256Hex(cookieState);
    const queryHash = await sha256Hex(queryState);
    policy.loginStatePut(cookieHash, "nonce-disabled", "verifier-disabled", "/", NOW, "ip");
    policy.loginStatePut(queryHash, "nonce-other", "verifier-other", "/", NOW, "ip");
    const { authRoutes } = await loadRoutes();
    const app = authRoutes({ now: () => NOW });
    const res = await callback(app, { state: queryState, code: "secret-code-disabled" }, cookieState, {
      ...env,
      AUTH_MODE: "access",
    });
    assert.equal(res.status, 404);
    assert.equal(rowNonce(file, cookieHash), undefined);
    assert.equal(rowNonce(file, queryHash), "nonce-other");
    assert.deepEqual(res.logs, [JSON.stringify({ at: "entra_login", reason: "entra_disabled" })]);
    noSecrets(res.logs, [cookieState, queryState, "secret-code-disabled", "verifier-disabled"]);
  } finally {
    remove();
  }
});
