/**
 * NEW RECONSTRUCTION. Two OAuth clients for one user, through the release edge.
 * Client identity is the DCR client id on the token, not a body field.
 * Access-token lifetime uses the pinned provider option. The minimum it accepts is 60 seconds.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const HMAC = "synthetic-oauth-two-client-hmac-32";
const ADA = "ada@tenant-a.test";
const BOB = "bob@tenant-b.test";
const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

async function bundleRelease() {
  const outfile = join(mkdtempSync(join(tmpdir(), "oauth-release-")), "entry.js");
  await build({
    absWorkingDir: root,
    entryPoints: ["reconstruction/release/entry.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile,
    external: ["cloudflare:workers"],
    plugins: [{
      name: "captured-text",
      setup(plugin) {
        plugin.onLoad({ filter: /recovered-delivery\/.+\.(html|css|js)$/ }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    }],
  });
  return readFileSync(outfile, "utf8");
}

function boot({ persist, ttl, entry, api, mcp }) {
  const origin = "http://127.0.0.1";
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const auditKey = "synthetic-audit-mcp-key-32chars!!";
  const mcpEnv = {
    ENVIRONMENT: "dev",
    MCP_PUBLIC_URL: origin,
    DEFAULT_TENANT_ID: "tenant_alpha",
    INTERNAL_HMAC_KEY: HMAC,
    AUDIT_KEY_MCP: auditKey,
    ALLOWED_REDIRECT_URIS: `${origin}/callback`,
    ...(ttl ? { ACCESS_TOKEN_TTL: String(ttl) } : {}),
  };
  return new Miniflare({
    resourcePersistencePath: persist,
    workers: [
      guarded({ name: "deny-egress", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(deny) }),
      guarded({
        name: "audit",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(resolve(root, "reconstruction/dist/audit.js"), "utf8")),
        env: {
          ...Object.fromEntries(Object.entries({
            AUDIT_KEY_MCP: auditKey,
            AUDIT_KEY_API: "synthetic-audit-api-key-32chars!!",
            AUDIT_KEY_READ: "synthetic-audit-read-key-32chars!",
          }).map(([key, value]) => [key, text(value)])),
          AUDIT_LOG: { type: "r2" },
        },
      }),
      guarded({
        name: "api",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(api),
        env: {
          ...Object.fromEntries(Object.entries({
            ENVIRONMENT: "dev",
            DO_JURISDICTION: "off",
            DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
            DEFAULT_TENANT_ID: "tenant_alpha",
            TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}',
            RATE_LIMIT_PER_MIN: "200",
            INTERNAL_HMAC_KEY: HMAC,
          }).map(([key, value]) => [key, text(value)])),
          TENANT_POLICY: { type: "durable-object", worker: "api", exportName: "TenantPolicy" },
          WORKSPACE: { type: "durable-object", worker: "api", exportName: "Workspace" },
          USAGE_LEDGER: { type: "durable-object", worker: "api", exportName: "UsageLedger" },
          BLOBS: { type: "r2" },
        },
        exports: {
          TenantPolicy: { type: "durable-object", storage: "sqlite" },
          Workspace: { type: "durable-object", storage: "sqlite" },
          UsageLedger: { type: "durable-object", storage: "sqlite" },
        },
      }),
      guarded({
        name: "mcp-auth",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(mcp),
        env: {
          ...Object.fromEntries(Object.entries(mcpEnv).map(([key, value]) => [key, text(value)])),
          OAUTH_KV: { type: "kv", id: "oauth-kv-two-clients" },
          API: { type: "worker", worker: "api" },
          AUDIT: { type: "worker", worker: "audit" },
        },
      }),
      guarded({
        name: "release-edge",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(entry),
        env: {
          ...Object.fromEntries(Object.entries({
            RELEASE_MODE: "protected-dev",
            AUTH_ISSUER: "https://issuer.test",
            AUTH_AUDIENCE: "secondary-release-test",
            LOCAL_JWKS: JSON.stringify({ keys: [] }),
            INTERNAL_HMAC_KEY: HMAC,
          }).map(([key, value]) => [key, text(value)])),
          API: { type: "worker", worker: "api" },
          MCP: { type: "worker", worker: "mcp-auth" },
        },
        triggers: [{ type: "fetch", pattern: "127.0.0.1/*" }],
      }),
    ],
  });
}

const origin = "http://127.0.0.1";
const resource = `${origin}/mcp`;
const redirect = `${origin}/callback`;

async function read(response) {
  const textBody = await response.text();
  let json = null;
  try { json = JSON.parse(textBody); } catch { json = null; }
  return { status: response.status, json, text: textBody, headers: response.headers };
}

function toolJson(raw) {
  const line = raw.split("\n").find((item) => item.startsWith("data:"));
  const envelope = JSON.parse(line.slice(5));
  return JSON.parse(envelope.result.content[0].text);
}

async function register(mf, name) {
  const response = await read(await mf.dispatchFetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      redirect_uris: [redirect],
      client_name: name,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }));
  assert.equal(response.status, 201, response.text.slice(0, 240));
  return response.json.client_id;
}

async function grant(mf, clientId, email) {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(verifier))).toString("base64url");
  const consent = await mf.dispatchFetch(`${origin}/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "secondary.read secondary.personal.write",
    resource,
  })}`, { headers: { "x-dev-email": email, origin } });
  const consentText = await consent.text();
  assert.equal(consent.status, 200, consentText.slice(0, 240));
  const handle = /name="handle" value="([^"]+)"/.exec(consentText)?.[1];
  const form = new URLSearchParams({ handle, decision: "approve" });
  form.append("scope", "secondary.read");
  form.append("scope", "secondary.personal.write");
  const approved = await mf.dispatchFetch(`${origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
      cookie: (consent.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; "),
      "x-dev-email": email,
    },
    body: form,
  });
  const code = new URL(approved.headers.get("location")).searchParams.get("code");
  const token = await read(await mf.dispatchFetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }),
  }));
  assert.equal(token.status, 200, token.text.slice(0, 300));
  return token.json;
}

async function call(mf, access, body, session) {
  const headers = {
    authorization: `Bearer ${access}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    origin,
  };
  if (session) headers["mcp-session-id"] = session;
  return mf.dispatchFetch(resource, { method: "POST", headers, body: JSON.stringify(body) });
}

async function sessionFor(mf, access) {
  const init = await call(mf, access, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "two-client", version: "0" } },
  });
  assert.equal(init.status, 200, (await init.clone().text()).slice(0, 200));
  const session = init.headers.get("mcp-session-id");
  await call(mf, access, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  return session;
}

test("two OAuth clients keep separate receipts for one user and survive restart", async () => {
  const built = bundleWorkerd();
  const entry = await bundleRelease();
  const persist = mkdtempSync(join(tmpdir(), "oauth-two-clients-"));
  const api = readFileSync(built.api, "utf8");
  const mcp = readFileSync(built.mcp, "utf8");
  let mf = boot({ persist, entry, api, mcp });
  let clientA;
  let clientB;
  let tokenB;
  let bobToken;
  let revokedAccess;
  try {
    clientA = await register(mf, "client-a");
    clientB = await register(mf, "client-b");
    assert.notEqual(clientA, clientB);
    const tokenA = await grant(mf, clientA, ADA);
    tokenB = await grant(mf, clientB, ADA);
    bobToken = await grant(mf, clientA, BOB);
    assert.equal(tokenA.scope.includes("secondary.personal.write"), true);
    const sessionA = await sessionFor(mf, tokenA.access_token);
    const sessionB = await sessionFor(mf, tokenB.access_token);
    const first = toolJson(await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "personal_import", arguments: { source: "paste", externalId: "shared-note", version: 1, text: "Same sentence", clientId: "caller-forged" } },
    }, sessionA)).text());
    const second = toolJson(await (await call(mf, tokenB.access_token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "personal_import", arguments: { source: "paste", externalId: "shared-note", version: 1, text: "Same sentence", clientId: "caller-forged" } },
    }, sessionB)).text());
    assert.equal(first.client, clientA);
    assert.equal(second.client, clientB);
    assert.notEqual(first.id, second.id);
    const retry = toolJson(await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "personal_import", arguments: { source: "paste", externalId: "shared-note", version: 1, text: "Same sentence", clientId: clientB } },
    }, sessionA)).text());
    assert.equal(retry.outcome, "duplicate");
    assert.equal(retry.id, first.id);
    assert.equal(retry.client, clientA);
    const clash = await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "personal_import", arguments: { source: "paste", externalId: "shared-note", version: 1, text: "Different sentence" } },
    }, sessionA)).text();
    assert.equal(clash.includes("version_conflict"), true);
    const listedA = toolJson(await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "personal_import_search", arguments: { q: "Same sentence" } },
    }, sessionA)).text());
    const listedB = toolJson(await (await call(mf, tokenB.access_token, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "personal_import_search", arguments: { q: "Same sentence" } },
    }, sessionB)).text());
    assert.equal(listedA.items.some((item) => item.id === first.id), true);
    assert.equal(listedA.items.some((item) => item.id === second.id), true);
    assert.equal(listedB.items.some((item) => item.id === first.id), true);
    const readB = toolJson(await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "personal_import_read", arguments: { id: second.id } },
    }, sessionA)).text());
    assert.equal(readB.item.text, "Same sentence");
    const bobSession = await sessionFor(mf, bobToken.access_token);
    const bobRead = await (await call(mf, bobToken.access_token, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "personal_import_read", arguments: { id: first.id } },
    }, bobSession)).text();
    assert.equal(bobRead.includes("not_found"), true);
    assert.equal(bobRead.includes("Same sentence"), false);
    const reported = toolJson(await (await call(mf, tokenA.access_token, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "usage_report", arguments: { eventId: "client-a-evt", outcome: "ok", inputTokens: 2, outputTokens: 2, totalTokens: 4 } },
    }, sessionA)).text());
    assert.equal(reported.event.trust, "client_reported");
    const stolen = await (await call(mf, tokenB.access_token, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "usage_report", arguments: { eventId: "client-a-evt", outcome: "ok", inputTokens: 9, outputTokens: 9, totalTokens: 18 } },
    }, sessionB)).text();
    assert.equal(stolen.includes("foreign_client") || stolen.includes("foreign_request"), true);
    const refresh = async (clientId, refreshToken) => read(await mf.dispatchFetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource }),
    }));
    const rotated = await refresh(clientA, tokenA.refresh_token);
    assert.equal(rotated.status, 200, rotated.text.slice(0, 200));
    const rotatedAgain = await refresh(clientA, rotated.json.refresh_token);
    assert.equal(rotatedAgain.status, 200, rotatedAgain.text.slice(0, 200));
    const stale = await refresh(clientA, tokenA.refresh_token);
    assert.equal(stale.status, 400);
    assert.equal(stale.json.error, "invalid_grant");
  } finally {
    await mf.dispose();
  }
  mf = boot({ persist, entry, api, mcp });
  try {
    const session = await sessionFor(mf, tokenB.access_token);
    const listed = toolJson(await (await call(mf, tokenB.access_token, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "personal_import_search", arguments: { q: "Same sentence" } },
    }, session)).text());
    assert.equal(listed.items.length >= 2, true);
    const refreshed = await read(await mf.dispatchFetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenB.refresh_token, client_id: clientB, resource }),
    }));
    assert.equal(refreshed.status, 200, refreshed.text.slice(0, 240));
    assert.equal(refreshed.json.scope.includes("secondary.personal.write"), true);
    revokedAccess = refreshed.json.access_token;
    const revoked = await read(await mf.dispatchFetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ token: refreshed.json.refresh_token, client_id: clientB }),
    }));
    assert.equal(revoked.status, 200, revoked.text.slice(0, 200));
    const dead = await call(mf, revokedAccess, { jsonrpc: "2.0", id: 14, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "two-client", version: "0" } } });
    assert.equal(dead.status, 401);
  } finally {
    await mf.dispose();
  }
  mf = boot({ persist, entry, api, mcp });
  try {
    const still = await call(mf, revokedAccess, { jsonrpc: "2.0", id: 15, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "two-client", version: "0" } } });
    assert.equal(still.status, 401, (await still.text()).slice(0, 200));
  } finally {
    await mf.dispose();
  }
});

test("a 60 second access token expires on the wall clock", async () => {
  const built = bundleWorkerd();
  const entry = await bundleRelease();
  const mf = boot({
    persist: mkdtempSync(join(tmpdir(), "oauth-ttl-")),
    ttl: 60,
    entry,
    api: readFileSync(built.api, "utf8"),
    mcp: readFileSync(built.mcp, "utf8"),
  });
  try {
    const clientId = await register(mf, "ttl-client");
    const token = await grant(mf, clientId, ADA);
    assert.equal(token.expires_in, 60);
    const live = await call(mf, token.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ttl", version: "0" } } });
    assert.equal(live.status, 200, (await live.clone().text()).slice(0, 180));
    await new Promise((resolve) => setTimeout(resolve, 62000));
    const expired = await call(mf, token.access_token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ttl", version: "0" } } });
    const expiredText = await expired.text();
    assert.equal(expired.status, 401, expiredText.slice(0, 240));
    assert.equal(expiredText.includes("invalid_token"), true);
  } finally {
    await mf.dispose();
  }
});
