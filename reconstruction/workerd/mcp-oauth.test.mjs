/**
 * NEW RECONSTRUCTION harness. The recovered MCP worker is unchanged.
 * This runs its OAuthProvider and Streamable HTTP handler in local workerd.
 * Identity is the recovered dev loopback header, not a forged bearer.
 * compatibility_date 2026-11-07 is the reconstruction date.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const ORIGIN = "http://localhost";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = `${ORIGIN}/callback`;
const HMAC = "synthetic-mcp-internal-hmac-key-32";
const AUDIT_MCP = "synthetic-audit-mcp-key-32chars!!";
const EMAIL = "consultant@example.invalid";
const OTHER = "synthetic.other@example.invalid";

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

function text(value) {
  return { type: "text", value };
}

function guarded(config) {
  return {
    config,
    dev: { outboundService: { type: "worker", worker: "deny-egress" } },
  };
}

let mf;

test.before(async () => {
  const built = bundleWorkerd();
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const probe = `export default { async fetch() {
    const res = await fetch("https://example.invalid/synthetic-egress-probe");
    return new Response(await res.text(), { status: res.status });
  } };`;
  const script = (file) => readFileSync(file, "utf8");
  const module = (contents) => ({
    mainModule: "index.js",
    modules: { "index.js": { type: "esm", contents } },
  });
  mf = new Miniflare({
    workers: [
      guarded({
        name: "deny-egress",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: module(deny),
      }),
      guarded({
        name: "egress-probe",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: module(probe),
        triggers: [{ type: "fetch", pattern: "egress-probe.local/*" }],
      }),
      guarded({
        name: "audit",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: module(script(resolve(root, "reconstruction/dist/audit.js"))),
        env: {
          ...Object.fromEntries(
            Object.entries({
              AUDIT_KEY_MCP: AUDIT_MCP,
              AUDIT_KEY_API: "synthetic-audit-api-key-32chars!!",
              AUDIT_KEY_READ: "synthetic-audit-read-key-32chars!",
            }).map(([key, value]) => [key, text(value)]),
          ),
          AUDIT_LOG: { type: "r2" },
        },
        triggers: [{ type: "fetch", pattern: "audit.local/*" }],
      }),
      guarded({
        name: "api",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: module(script(built.api)),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DO_JURISDICTION: "off",
              DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
              DEFAULT_TENANT_ID: "tenant_reconstruction",
              TENANT_DOMAINS: '{"example.invalid":"tenant_reconstruction"}',
              RATE_LIMIT_PER_MIN: "60",
              INTERNAL_HMAC_KEY: HMAC,
            }).map(([key, value]) => [key, text(value)]),
          ),
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
        triggers: [{ type: "fetch", pattern: "127.0.0.1/*" }],
      }),
      guarded({
        name: "mcp-auth",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: module(script(built.mcp)),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DEFAULT_TENANT_ID: "tenant_reconstruction",
              INTERNAL_HMAC_KEY: HMAC,
              AUDIT_KEY_MCP: AUDIT_MCP,
              ALLOWED_REDIRECT_URIS: REDIRECT,
              MCP_PUBLIC_URL: ORIGIN,
            }).map(([key, value]) => [key, text(value)]),
          ),
          OAUTH_KV: { type: "kv", id: "oauth-kv-local-synthetic" },
          API: { type: "worker", worker: "api" },
          AUDIT: { type: "worker", worker: "audit" },
        },
        triggers: [{ type: "fetch", pattern: "localhost/*" }],
      }),
    ],
  });
  await mf.ready;
});

test.after(async () => {
  await mf?.dispose();
});

async function read(response) {
  const textBody = await response.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch {
    json = null;
  }
  return { status: response.status, text: textBody, json, headers: response.headers };
}

function cookies(response) {
  const list = response.headers.getSetCookie?.() ?? [];
  return list.map((item) => item.split(";")[0]).join("; ");
}

async function registerClient() {
  const res = await read(
    await mf.dispatchFetch(`${ORIGIN}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        client_name: "synthetic-local-mcp",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }),
  );
  assert.equal(res.status, 201, res.text);
  assert.equal(typeof res.json.client_id, "string");
  return res.json.client_id;
}

async function authorizationCode(clientId, email, scopes = ["secondary.read"]) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: scopes.join(" "),
    state,
    resource: RESOURCE,
  });
  const consent = await read(
    await mf.dispatchFetch(`${ORIGIN}/authorize?${query}`, {
      headers: { "x-dev-email": email, "x-dev-persona": "consultant", origin: ORIGIN },
    }),
  );
  assert.equal(consent.status, 200, consent.text.slice(0, 300));
  const handle = /name="handle" value="([^"]+)"/.exec(consent.text)?.[1];
  assert.equal(typeof handle, "string");
  const approved = await read(
    await mf.dispatchFetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
        cookie: cookies(consent),
        "x-dev-email": email,
        "x-dev-persona": "consultant",
      },
      body: (() => {
        const form = new URLSearchParams({ handle, decision: "approve" });
        for (const scope of scopes) form.append("scope", scope);
        return form;
      })(),
    }),
  );
  assert.equal(approved.status, 302, approved.text.slice(0, 300));
  const location = new URL(approved.headers.get("location"));
  assert.equal(location.origin + location.pathname, REDIRECT);
  assert.equal(location.searchParams.get("state"), state);
  return { verifier, code: location.searchParams.get("code") };
}

async function exchange(clientId, code, verifier) {
  const token = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
    }),
  );
  assert.equal(token.status, 200, token.text.slice(0, 400));
  assert.equal(token.json.token_type, "bearer");
  assert.equal(typeof token.json.access_token, "string");
  assert.equal(token.text.includes(EMAIL) === false || token.json.access_token.includes(EMAIL) === false, true);
  return token.json.access_token;
}

async function mcp(token, body, session) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    origin: ORIGIN,
  };
  if (session) headers["mcp-session-id"] = session;
  return read(
    await mf.dispatchFetch(RESOURCE, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function rpc(message) {
  if (message.json?.result || message.json?.error) return message.json;
  const data = message.text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return data.length ? JSON.parse(data.at(-1)) : null;
}

test("a forged bearer never reaches MCP tools when the local issuer is configured", async () => {
  const missing = await read(await mf.dispatchFetch(RESOURCE, { method: "POST", headers: { origin: ORIGIN } }));
  assert.equal(missing.status, 401);
  assert.equal(missing.text.includes("whoami"), false);
  const forged = await read(
    await mf.dispatchFetch(RESOURCE, {
      method: "POST",
      headers: { authorization: "Bearer user:grant:synthetic", origin: ORIGIN },
    }),
  );
  assert.equal(forged.status, 401);
  assert.equal(forged.text.includes("whoami"), false);
  assert.equal(forged.text.includes("user:grant:synthetic"), false);
});

test("registration and authorize reject a foreign redirect and a missing PKCE challenge", async () => {
  const foreign = await read(
    await mf.dispatchFetch(`${ORIGIN}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        redirect_uris: ["https://example.invalid/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }),
  );
  assert.equal(foreign.status, 400);
  assert.equal(foreign.text.includes("egress_denied"), false);
  const clientId = await registerClient();
  const open = await read(
    await mf.dispatchFetch(
      `${ORIGIN}/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: "secondary.read",
        resource: RESOURCE,
      })}`,
      { headers: { "x-dev-email": EMAIL, origin: ORIGIN }, redirect: "manual" },
    ),
  );
  assert.equal(open.status, 302, open.text.slice(0, 180));
  const bounced = new URL(open.headers.get("location"));
  assert.equal(bounced.origin + bounced.pathname, REDIRECT);
  assert.equal(bounced.searchParams.get("error"), "invalid_request");
  assert.equal(bounced.searchParams.has("code"), false);
});

test("PKCE grant initializes, lists tools, and calls whoami for that principal only", async () => {
  const clientId = await registerClient();
  const first = await authorizationCode(clientId, EMAIL);
  const token = await exchange(clientId, first.code, first.verifier);
  const init = await mcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "synthetic-local", version: "0" },
    },
  });
  const initBody = rpc(init);
  assert.equal(
    init.status,
    200,
    `${init.text.slice(0, 300)} auth=${init.headers.get("www-authenticate")} parts=${String(token).split(":").length}`,
  );
  assert.equal(typeof initBody?.result?.protocolVersion, "string");
  const session = init.headers.get("mcp-session-id");
  await mcp(
    token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    session,
  );
  const listed = rpc(await mcp(token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, session));
  const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
  assert.equal(names.includes("whoami"), true);
  assert.equal(names.includes("list_brains"), true);
  const who = rpc(
    await mcp(
      token,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } },
      session,
    ),
  );
  const whoText = JSON.stringify(who?.result ?? who);
  assert.equal(who?.result?.isError, undefined);
  assert.equal(whoText.includes(EMAIL), true);
  assert.equal(whoText.includes(OTHER), false);
  assert.equal(whoText.includes(token), false);
  const denied = rpc(
    await mcp(
      token,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "propose_page",
          arguments: { brainId: "me", title: "Synthetic import", body: "SYNTHETIC_IMPORT_BODY" },
        },
      },
      session,
    ),
  );
  const deniedText = JSON.stringify(denied?.result ?? denied);
  assert.equal(deniedText.includes("insufficient_scope"), true);
  assert.equal(deniedText.includes("SYNTHETIC_IMPORT_BODY"), false);
  const readDenied = rpc(
    await mcp(
      token,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "personal_note_create", arguments: { title: "Should not store", body: "FORBIDDEN_MCP_BODY" } },
      },
      session,
    ),
  );
  const readDeniedText = JSON.stringify(readDenied?.result ?? readDenied);
  assert.equal(readDeniedText.includes("insufficient_scope"), true);
  assert.equal(readDeniedText.includes("FORBIDDEN_MCP_BODY"), false);
  const other = await authorizationCode(clientId, OTHER);
  const otherToken = await exchange(clientId, other.code, other.verifier);
  const otherInit = await mcp(otherToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "synthetic-local", version: "0" },
    },
  });
  const otherSession = otherInit.headers.get("mcp-session-id");
  await mcp(otherToken, { jsonrpc: "2.0", method: "notifications/initialized" }, otherSession);
  const otherWho = rpc(
    await mcp(
      otherToken,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } },
      otherSession,
    ),
  );
  const otherText = JSON.stringify(otherWho?.result ?? otherWho);
  assert.equal(otherText.includes(OTHER), true);
  assert.equal(otherText.includes(EMAIL), false);
  assert.equal(otherText.includes(token), false);
  const spent = await authorizationCode(clientId, EMAIL);
  await exchange(clientId, spent.code, spent.verifier);
  const again = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: spent.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: spent.verifier,
        resource: RESOURCE,
      }),
    }),
  );
  assert.equal(again.status, 400);
  assert.equal(again.json.error, "invalid_grant");
  const writer = await authorizationCode(clientId, EMAIL, ["secondary.read", "secondary.personal.write"]);
  const writeToken = await exchange(clientId, writer.code, writer.verifier);
  const writeInit = await mcp(writeToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "synthetic-local", version: "0" },
    },
  });
  const writeSession = writeInit.headers.get("mcp-session-id");
  await mcp(writeToken, { jsonrpc: "2.0", method: "notifications/initialized" }, writeSession);
  const created = rpc(
    await mcp(
      writeToken,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "personal_note_create", arguments: { title: "Synthetic MCP note", body: "Synthetic MCP body" } },
      },
      writeSession,
    ),
  );
  const createdText = JSON.stringify(created?.result ?? created);
  assert.equal(created?.result?.isError, undefined);
  assert.equal(createdText.includes("Synthetic MCP body"), true);
  assert.equal(createdText.includes("FORBIDDEN_MCP_BODY"), false);
  const revoked = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId }),
    }),
  );
  assert.equal(revoked.status, 200, revoked.text.slice(0, 200));
  const after = await mcp(token, { jsonrpc: "2.0", id: 9, method: "tools/list" }, session);
  assert.equal(after.status, 401);
  assert.equal(after.text.includes(EMAIL), false);
});

test("a cross-origin authorize post and a remote fetch stay closed", async () => {
  const clientId = await registerClient();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const consent = await read(
    await mf.dispatchFetch(
      `${ORIGIN}/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "secondary.read",
        resource: RESOURCE,
      })}`,
      { headers: { "x-dev-email": EMAIL, origin: ORIGIN } },
    ),
  );
  const handle = /name="handle" value="([^"]+)"/.exec(consent.text)?.[1];
  const cross = await read(
    await mf.dispatchFetch(`${ORIGIN}/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.invalid",
        cookie: cookies(consent),
        "x-dev-email": EMAIL,
        "x-dev-persona": "consultant",
      },
      body: new URLSearchParams({ handle, decision: "approve", scope: "secondary.read" }),
    }),
  );
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get("access-control-allow-origin"), null);
  const blocked = await read(await mf.dispatchFetch("http://egress-probe.local/"));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.text, "egress_denied");
});

test("a local test issuer rejects the wrong resource and rotates refresh tokens", async () => {
  const clientId = await registerClient();
  const granted = await authorizationCode(clientId, EMAIL, ["secondary.read"]);
  const wrong = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: granted.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: granted.verifier,
        resource: "http://localhost/other",
      }),
    }),
  );
  assert.equal(wrong.status, 400, wrong.text.slice(0, 300));
  assert.equal(wrong.json.error, "invalid_target");
  const pair = await authorizationCode(clientId, EMAIL, ["secondary.read"]);
  const first = await read(
    await mf.dispatchFetch(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: pair.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: pair.verifier,
        resource: RESOURCE,
      }),
    }),
  );
  assert.equal(first.status, 200, first.text.slice(0, 300));
  assert.equal(typeof first.json.refresh_token, "string");
  const refresh = async (token) =>
    read(
      await mf.dispatchFetch(`${ORIGIN}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token,
          client_id: clientId,
          resource: RESOURCE,
        }),
      }),
    );
  const second = await refresh(first.json.refresh_token);
  assert.equal(second.status, 200, second.text.slice(0, 300));
  const third = await refresh(second.json.refresh_token);
  assert.equal(third.status, 200, third.text.slice(0, 240));
  const stale = await refresh(first.json.refresh_token);
  assert.equal(stale.status, 400, stale.text.slice(0, 240));
  assert.equal(stale.json.error, "invalid_grant");
});
