/**
 * NEW RECONSTRUCTION. Protected-dev edge and non-dev MCP auth negatives.
 * The JWT issuer is a local test key. It is not production Access or Entra.
 * This file loads reconstruction/release/entry.ts. MCP loads import-entry.ts.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Miniflare } from "miniflare";
import { API_ACCESS_AUD, MCP_ACCESS_AUD } from "../release/access-facts.mjs";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const ISSUER = "https://issuer.test";
const AUDIENCE = "secondary-release-test";
const HMAC = "synthetic-release-hmac-key-32chars";

const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

async function bundleRelease() {
  const outfile = join(mkdtempSync(join(tmpdir(), "release-entry-")), "entry.js");
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
  return outfile;
}

async function tokenFor(privateKey, kid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "ada@tenant-a.test", ...claims.extra })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setSubject("synthetic-ada")
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 120)
    .sign(privateKey);
}

test("protected-dev edge ignores dev headers and closes harness routes", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "release-test";
  const other = await generateKeyPair("RS256", { extractable: true });
  const entry = readFileSync(await bundleRelease(), "utf8");
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const mf = new Miniflare({
    workers: [
      guarded({
        name: "deny-egress",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(deny),
      }),
      guarded({
        name: "api",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(bundleWorkerd().api, "utf8")),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DO_JURISDICTION: "off",
              DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha"}',
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
        triggers: [{ type: "fetch", pattern: "api.internal/*" }],
      }),
      guarded({
        name: "release-edge",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(entry),
        env: {
          ...Object.fromEntries(
            Object.entries({
              RELEASE_MODE: "protected-dev",
              AUTH_ISSUER: ISSUER,
              AUTH_AUDIENCE: AUDIENCE,
              LOCAL_JWKS: JSON.stringify({ keys: [jwk] }),
              INTERNAL_HMAC_KEY: HMAC,
            }).map(([key, value]) => [key, text(value)]),
          ),
          API: { type: "worker", worker: "api" },
        },
        triggers: [{ type: "fetch", pattern: "release.local/*" }],
      }),
    ],
  });
  try {
    const harness = await mf.dispatchFetch("http://release.local/harness/import", {
      headers: { "x-dev-email": "ada@tenant-a.test", "x-demo-persona": "consultant" },
    });
    assert.equal(harness.status, 404);
    assert.equal(await harness.text(), "harness_closed\n");
    const fixture = await mf.dispatchFetch("http://release.local/settings/observability/session", { method: "POST" });
    assert.equal(fixture.status, 404);
    const anonymous = await mf.dispatchFetch("http://release.local/settings/observability", {
      headers: { "x-dev-email": "ada@tenant-a.test", "x-user-email": "ada@tenant-a.test" },
    });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.text()).includes("ada@tenant-a.test"), false);
    const good = await tokenFor(privateKey, "release-test");
    const page = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      headers: { authorization: `Bearer ${good}`, "x-dev-email": "bob@tenant-b.test" },
    });
    const html = await page.text();
    assert.equal(page.status, 200, html.slice(0, 200));
    assert.equal(html.includes("ada@tenant-a.test"), true);
    assert.equal(html.includes("bob@tenant-b.test"), false);
    assert.equal(html.includes("Plus-address"), false);
    assert.equal(html.includes("synthetic zero"), false);
    assert.equal(html.includes("Record synthetic"), false);
    const observed = await mf.dispatchFetch("http://release.local/settings/observability?section=usage", {
      headers: { authorization: `Bearer ${good}` },
    });
    const usage = await observed.text();
    assert.equal(observed.status, 200, usage.slice(0, 180));
    assert.equal(usage.includes("Observability"), true);
    assert.equal(usage.includes("#6600ae") || usage.includes("6600ae"), true);
    assert.equal(usage.includes("Plus-address session"), false);
    assert.equal(usage.includes("Record synthetic"), false);
    const shell = await mf.dispatchFetch("http://release.local/settings", { headers: { authorization: `Bearer ${good}` } });
    assert.equal((await shell.text()).includes("index-PLmoiPYI.js"), true);
    const script = await mf.dispatchFetch("http://release.local/assets/index-PLmoiPYI.js");
    assert.equal(script.status, 200);
    assert.equal((script.headers.get("content-type") ?? "").includes("javascript"), true);
    const encoded = await mf.dispatchFetch("http://release.local/harness/../harness/import");
    assert.equal(encoded.status, 404);
    const doubled = await mf.dispatchFetch("http://release.local/%2568arness/import");
    assert.equal(doubled.status, 404);
    const slashed = await mf.dispatchFetch("http://release.local/harness//import");
    assert.equal(slashed.status, 404);
    const cased = await mf.dispatchFetch("http://release.local/HARNESS/import");
    assert.equal(cased.status, 404);
    const queryPath = await mf.dispatchFetch("http://release.local/settings/observability?path=/harness/import", {
      headers: { authorization: `Bearer ${good}` },
    });
    assert.equal(queryPath.status, 200);
    assert.equal((await queryPath.text()).includes("Observability"), true);
    const override = await mf.dispatchFetch("http://release.local/settings/observability", {
      headers: { authorization: `Bearer ${good}`, "x-original-url": "/harness/import" },
    });
    assert.equal(override.status, 400);
    const cross = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      method: "POST",
      headers: { authorization: `Bearer ${good}`, origin: "https://evil.invalid", "content-type": "application/x-www-form-urlencoded" },
      body: "text=cross",
    });
    assert.equal(cross.status, 403);
    const notBefore = await tokenFor(privateKey, "release-test", {
      exp: Math.floor(Date.now() / 1000) + 7200,
      extra: { nbf: Math.floor(Date.now() / 1000) + 3600 },
    });
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${notBefore}` } })).status, 401);
    const sameKid = await new SignJWT({ email: "ada@tenant-a.test" })
      .setProtectedHeader({ alg: "RS256", kid: "release-test" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("synthetic-ada")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 120)
      .sign(other.privateKey);
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${sameKid}` } })).status, 401);
    const accessOnly = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      headers: { "cf-access-jwt-assertion": good },
    });
    assert.equal(accessOnly.status, 200);
    const headerClash = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      headers: { authorization: `Bearer ${good}`, "cf-access-jwt-assertion": sameKid },
    });
    assert.equal(headerClash.status, 401);
    const methodOverride = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      headers: { authorization: `Bearer ${good}`, "x-http-method-override": "POST" },
    });
    assert.equal(methodOverride.status, 400);
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", kid: "release-test" })).toString("base64url");
    const noneBody = Buffer.from(JSON.stringify({
      email: "ada@tenant-a.test",
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 120,
    })).toString("base64url");
    const noneToken = `${noneHeader}.${noneBody}.`;
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${noneToken}` } })).status, 401);
    const expired = await tokenFor(privateKey, "release-test", { exp: Math.floor(Date.now() / 1000) - 60 });
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${expired}` } })).status, 401);
    const wrongAudience = await tokenFor(privateKey, "release-test", { audience: "other-audience" });
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${wrongAudience}` } })).status, 401);
    const wrongIssuer = await tokenFor(privateKey, "release-test", { issuer: "https://other.test" });
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${wrongIssuer}` } })).status, 401);
    const otherJwk = await exportJWK(other.publicKey);
    otherJwk.alg = "RS256";
    otherJwk.kid = "other";
    const forged = await tokenFor(other.privateKey, "other");
    assert.equal((await mf.dispatchFetch("http://release.local/reconstruction/import", { headers: { authorization: `Bearer ${forged}` } })).status, 401);
    const saved = await mf.dispatchFetch("http://release.local/reconstruction/import", {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${good}`, "content-type": "application/x-www-form-urlencoded" },
      body: "externalId=release-note&version=1&source=paste&text=Release+synthetic+note",
    });
    assert.equal(saved.status, 303, (await saved.text()).slice(0, 200));
    assert.equal(saved.headers.get("location"), "/reconstruction/import?result=stored");
    const shown = await mf.dispatchFetch("http://release.local/reconstruction/import?result=stored", {
      headers: { authorization: `Bearer ${good}` },
    });
    const savedText = await shown.text();
    assert.equal(shown.status, 200, savedText.slice(0, 300));
    assert.equal(savedText.includes("Release synthetic note"), true);
    assert.equal(savedText.includes("No model was called"), true);
    assert.equal(savedText.includes("bob@tenant-b.test"), false);
  } finally {
    await mf.dispose();
  }
});

test("mcp tools stay a machine 401 when dev email is not a configured identity", async () => {
  const built = bundleWorkerd();
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const mf = new Miniflare({
    workers: [
      guarded({
        name: "deny-egress",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(deny),
      }),
      guarded({
        name: "mcp-auth",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(readFileSync(built.mcp, "utf8")),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "reconstruction",
              MCP_PUBLIC_URL: "http://localhost",
              DEFAULT_TENANT_ID: "tenant_reconstruction",
              INTERNAL_HMAC_KEY: HMAC,
              ALLOWED_REDIRECT_URIS: "http://localhost/callback",
            }).map(([key, value]) => [key, text(value)]),
          ),
          OAUTH_KV: { type: "kv", id: "oauth-kv-release-negative" },
        },
        triggers: [{ type: "fetch", pattern: "localhost/*" }],
      }),
    ],
  });
  try {
    const tools = await mf.dispatchFetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-dev-email": "ada@tenant-a.test",
        origin: "http://localhost",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const body = await tools.text();
    assert.equal(tools.status, 401, body.slice(0, 300));
    assert.equal(body.includes("<html"), false);
    assert.equal(body.includes("Sign-in required"), false);
    assert.equal((tools.headers.get("www-authenticate") ?? "").includes("Bearer"), true);
    const authorize = await mf.dispatchFetch("http://localhost/authorize?response_type=code&client_id=x&redirect_uri=http://localhost/callback", {
      headers: { "x-dev-email": "ada@tenant-a.test", origin: "http://localhost" },
    });
    const authorizeText = await authorize.text();
    assert.equal(authorize.status, 401);
    assert.equal(authorizeText.includes("name=\"handle\""), false);
  } finally {
    await mf.dispose();
  }
});

test("the release edge is the only client path for pages and MCP", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "release-test";
  const built = bundleWorkerd();
  const entry = readFileSync(await bundleRelease(), "utf8");
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const origin = "http://127.0.0.1";
  const resource = `${origin}/mcp`;
  assert.notEqual(AUDIENCE, API_ACCESS_AUD);
  assert.notEqual(AUDIENCE, MCP_ACCESS_AUD);
  assert.notEqual(resource, API_ACCESS_AUD);
  assert.notEqual(resource, MCP_ACCESS_AUD);
  const redirect = `${origin}/callback`;
  const auditKey = "synthetic-audit-mcp-key-32chars!!";
  const mf = new Miniflare({
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
        manifest: moduleOf(readFileSync(built.api, "utf8")),
        env: {
          ...Object.fromEntries(Object.entries({
            ENVIRONMENT: "dev",
            DO_JURISDICTION: "off",
            DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
            DEFAULT_TENANT_ID: "tenant_alpha",
            TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha"}',
            RATE_LIMIT_PER_MIN: "60",
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
        manifest: moduleOf(readFileSync(built.mcp, "utf8")),
        env: {
          ...Object.fromEntries(Object.entries({
            ENVIRONMENT: "dev",
            MCP_PUBLIC_URL: origin,
            DEFAULT_TENANT_ID: "tenant_alpha",
            INTERNAL_HMAC_KEY: HMAC,
            AUDIT_KEY_MCP: auditKey,
            ALLOWED_REDIRECT_URIS: redirect,
          }).map(([key, value]) => [key, text(value)])),
          OAUTH_KV: { type: "kv", id: "oauth-kv-release-edge" },
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
            AUTH_ISSUER: ISSUER,
            AUTH_AUDIENCE: AUDIENCE,
            LOCAL_JWKS: JSON.stringify({ keys: [jwk] }),
            INTERNAL_HMAC_KEY: HMAC,
          }).map(([key, value]) => [key, text(value)])),
          API: { type: "worker", worker: "api" },
          MCP: { type: "worker", worker: "mcp-auth" },
        },
        triggers: [{ type: "fetch", pattern: "127.0.0.1/*" }],
      }),
      guarded({
        name: "release-unconfigured",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(entry),
        env: { ...Object.fromEntries(Object.entries({ RELEASE_MODE: "protected-dev", AUTH_ISSUER: "", AUTH_AUDIENCE: "", LOCAL_JWKS: "" }).map(([key, value]) => [key, text(value)])) },
        triggers: [{ type: "fetch", pattern: "unconfigured.local/*" }],
      }),
    ],
  });
  try {
    const missing = await mf.dispatchFetch("http://unconfigured.local/settings/observability");
    assert.equal(missing.status, 503);
    assert.equal(await missing.text(), "auth_unconfigured\n");
    const registerResponse = await mf.dispatchFetch(`${origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "edge-client", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }),
    });
    const registerText = await registerResponse.text();
    assert.equal(registerResponse.status, 201, registerText.slice(0, 500));
    const registered = JSON.parse(registerText);
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(verifier))).toString("base64url");
    const consent = await mf.dispatchFetch(`${origin}/authorize?${new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "secondary.read secondary.personal.write", resource })}`, {
      headers: { "x-dev-email": "ada@tenant-a.test", origin },
    });
    assert.equal(consent.status, 200);
    const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())?.[1];
    const form = new URLSearchParams({ handle, decision: "approve" });
    form.append("scope", "secondary.read");
    form.append("scope", "secondary.personal.write");
    const approved = await mf.dispatchFetch(`${origin}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin, cookie: (consent.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; "), "x-dev-email": "ada@tenant-a.test" },
      body: form,
    });
    const code = new URL(approved.headers.get("location")).searchParams.get("code");
    const token = await (await mf.dispatchFetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: registered.client_id, code_verifier: verifier, resource }),
    })).json();
    const call = async (body, session) => {
      const headers = { authorization: `Bearer ${token.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream", origin };
      if (session) headers["mcp-session-id"] = session;
      return mf.dispatchFetch(resource, { method: "POST", headers, body: JSON.stringify(body) });
    };
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "edge", version: "0" } } });
    assert.equal(init.status, 200, (await init.clone().text()).slice(0, 200));
    const session = init.headers.get("mcp-session-id");
    await call({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    const listed = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).text();
    assert.equal(listed.includes("personal_import"), true);
    assert.equal(listed.includes("usage_lookup"), true);
    const imported = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_import", arguments: { source: "paste", externalId: "edge-1", version: 1, text: "Edge composition note" } } }, session)).text();
    assert.equal(imported.includes("Edge composition note"), true, imported.slice(0, 600));
    assert.equal(imported.includes("unknown"), true);
    const stored = JSON.parse(JSON.parse(imported.slice(imported.indexOf("data:") + 5)).result.content[0].text);
    const read = await (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "personal_import_read", arguments: { id: stored.id } } }, session)).text();
    assert.equal(read.includes("Edge composition note"), true, read.slice(0, 400));
    assert.equal(read.includes(stored.contentSha256), true);
    const ledgerText = await (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "usage_lookup", arguments: {} } }, session)).text();
    const ledger = JSON.parse(JSON.parse(ledgerText.slice(ledgerText.indexOf("data:") + 5)).result.content[0].text);
    assert.equal(ledger.events.some((event) => event.operation === "import" && event.trust === "unknown" && event.inputTokens === null), true);
  } finally {
    await mf.dispose();
  }
});
