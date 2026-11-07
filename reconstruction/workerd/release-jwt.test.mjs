/**
 * NEW RECONSTRUCTION. Non-dev release edge and MCP consent.
 * The JWT is signed by a local test key. The worker fetches the public JWKS.
 * This is not a Cloudflare Access login and not the observed public snapshot.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const HMAC = "synthetic-release-jwt-hmac-key32";
const ISSUER = "https://issuer.test";
const BROWSER_AUD = "aud-browser-api";
const MCP_AUD = "aud-mcp-consent";
const ADA = "ada@tenant-a.test";
const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const origin = "http://127.0.0.1";
const resource = `${origin}/mcp`;
const redirect = `${origin}/callback`;
const domains = '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}';
const principalId = (email) => `u_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

async function bundleRelease() {
  const outfile = join(mkdtempSync(join(tmpdir(), "jwt-release-")), "entry.js");
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

function jwksScript(publicKeys, mode) {
  return `let hits = 0; let leaked = 0;
const keys = ${JSON.stringify(publicKeys)};
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/status") return Response.json({ hits, leaked });
  if (url.href !== "http://127.0.0.1/jwks") { leaked += 1; return new Response("egress_denied", { status: 403 }); }
  hits += 1;
  if (${JSON.stringify(mode)} === "outage") return new Response("unavailable", { status: 503 });
  if (${JSON.stringify(mode)} === "redirect") return new Response(null, { status: 302, headers: { location: "https://evil.invalid/jwks" } });
  const body = hits < 2 ? { keys: [keys[0]] } : { keys };
  return Response.json(body, { headers: { "cache-control": "public, max-age=120, must-revalidate" } });
} };`;
}

function boot(mode, keys, entry, api, mcp) {
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const auditKey = "synthetic-audit-mcp-key-32chars!!";
  const jwksOutbound = { outboundService: { type: "worker", worker: "jwks" } };
  const denyOutbound = { outboundService: { type: "worker", worker: "deny-egress" } };
  const auth = {
    AUTH_ISSUER: ISSUER,
    AUTH_JWKS_URL: "http://127.0.0.1/jwks",
    AUTH_ALLOW_LOOPBACK_JWKS: "local-test",
    ADMITTED_TENANT_DOMAINS: domains,
  };
  return new Miniflare({
    workers: [
      { config: { name: "deny-egress", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(deny) }, dev: denyOutbound },
      { config: { name: "jwks", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(jwksScript(keys, mode)), triggers: [{ type: "fetch", pattern: "jwks.local/*" }] }, dev: denyOutbound },
      {
        config: {
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
        },
        dev: denyOutbound,
      },
      {
        config: {
          name: "api",
          compatibilityDate: DATE,
          workersDev: false,
          previewUrls: false,
          manifest: moduleOf(api),
          env: {
            ...Object.fromEntries(Object.entries({
              ENVIRONMENT: "reconstruction",
              LOCAL_DO_SHIM: "workerd",
              DO_JURISDICTION: "eu",
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: domains,
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
          triggers: [{ type: "fetch", pattern: "localhost/*" }],
        },
        dev: denyOutbound,
      },
      {
        config: {
          name: "mcp-auth",
          compatibilityDate: DATE,
          workersDev: false,
          previewUrls: false,
          manifest: moduleOf(mcp),
          env: {
            ...Object.fromEntries(Object.entries({
              ENVIRONMENT: "reconstruction",
              MCP_PUBLIC_URL: origin,
              DEFAULT_TENANT_ID: "tenant_alpha",
              INTERNAL_HMAC_KEY: HMAC,
              AUDIT_KEY_MCP: auditKey,
              ALLOWED_REDIRECT_URIS: redirect,
              AUTH_MCP_AUD: MCP_AUD,
              ...auth,
            }).map(([key, value]) => [key, text(value)])),
            OAUTH_KV: { type: "kv", id: `oauth-kv-jwt-${mode}` },
            API: { type: "worker", worker: "api" },
            AUDIT: { type: "worker", worker: "audit" },
          },
        },
        dev: jwksOutbound,
      },
      {
        config: {
          name: "release-edge",
          compatibilityDate: DATE,
          workersDev: false,
          previewUrls: false,
          manifest: moduleOf(entry),
          env: {
            ...Object.fromEntries(Object.entries({
              RELEASE_MODE: "protected-dev",
              AUTH_BROWSER_AUD: BROWSER_AUD,
              INTERNAL_HMAC_KEY: HMAC,
              ...auth,
            }).map(([key, value]) => [key, text(value)])),
            API: { type: "worker", worker: "api" },
            MCP: { type: "worker", worker: "mcp-auth" },
          },
          triggers: [{ type: "fetch", pattern: "127.0.0.1/*" }],
        },
        dev: jwksOutbound,
      },
    ],
  });
}

async function tokenFor(privateKey, kid, audience, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: ADA, ...claims.extra })
    .setProtectedHeader({ alg: claims.alg ?? "RS256", kid })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(audience)
    .setSubject(claims.sub ?? "sub-ada")
    .setNotBefore(claims.nbf === undefined ? now - 10 : claims.nbf)
    .setExpirationTime(claims.exp ?? now + 600)
    .sign(privateKey);
}

function toolJson(raw) {
  const line = raw.split("\n").find((item) => item.startsWith("data:"));
  return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text);
}

test("non-dev consent uses a fetched JWT and ignores dev headers", async () => {
  assert.notEqual(BROWSER_AUD, MCP_AUD);
  assert.notEqual(BROWSER_AUD, API_ACCESS_AUD);
  assert.notEqual(MCP_AUD, MCP_ACCESS_AUD);
  assert.notEqual(resource, BROWSER_AUD);
  assert.notEqual(resource, MCP_AUD);
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const rotated = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const keyB = await exportJWK(rotated.publicKey);
  keyB.alg = "RS256";
  keyB.use = "sig";
  keyB.kid = "kid-b";
  const built = bundleWorkerd();
  const mf = boot("rotate", [keyA, keyB], await bundleRelease(), readFileSync(built.api, "utf8"), readFileSync(built.mcp, "utf8"));
  try {
    const devOnly = await mf.dispatchFetch(`${origin}/authorize?response_type=code&client_id=x&redirect_uri=${redirect}`, {
      headers: { "x-dev-email": ADA, "x-dev-persona": "ceo", origin },
    });
    assert.equal(devOnly.status, 401);
    assert.equal((await devOnly.text()).includes("name=\"handle\""), false);
    const direct = await mf.dispatchFetch("http://localhost/v1/me", { headers: { "x-dev-email": ADA, "x-dev-persona": "ceo" } });
    assert.equal(direct.status, 401);
    const browser = await tokenFor(privateKey, "kid-a", BROWSER_AUD);
    const mcp = await tokenFor(privateKey, "kid-a", MCP_AUD);
    const wrongAud = await mf.dispatchFetch(`${origin}/authorize?response_type=code&client_id=x&redirect_uri=${redirect}`, {
      headers: { "cf-access-jwt-assertion": browser, "x-dev-email": "bob@tenant-b.test", origin },
    });
    assert.equal(wrongAud.status, 401);
    const page = await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${browser}` } });
    assert.equal(page.status, 200, (await page.clone().text()).slice(0, 180));
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${mcp}` } })).status, 401);
    const conflict = await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", {
      headers: { authorization: `Bearer ${browser}`, cookie: "CF_Authorization=other-token" },
    });
    assert.equal(conflict.status, 401);
    const missingNbf = await new SignJWT({ email: ADA })
      .setProtectedHeader({ alg: "RS256", kid: "kid-a" })
      .setIssuer(ISSUER)
      .setAudience(BROWSER_AUD)
      .setSubject("sub-ada")
      .setExpirationTime("2m")
      .sign(privateKey);
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${missingNbf}` } })).status, 401);
    const future = await tokenFor(privateKey, "kid-a", BROWSER_AUD, { nbf: Math.floor(Date.now() / 1000) + 600, exp: Math.floor(Date.now() / 1000) + 1200 });
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${future}` } })).status, 401);
    const badSig = await tokenFor(rotated.privateKey, "kid-a", MCP_AUD);
    assert.equal((await mf.dispatchFetch(`${origin}/authorize?response_type=code&client_id=x&redirect_uri=${redirect}`, { headers: { "cf-access-jwt-assertion": badSig, origin } })).status, 401);
    const stranger = await new SignJWT({ email: "ada@unknown.test", role: "ceo" })
      .setProtectedHeader({ alg: "RS256", kid: "kid-a" })
      .setIssuer(ISSUER)
      .setAudience(MCP_AUD)
      .setSubject("sub-stranger")
      .setNotBefore(Math.floor(Date.now() / 1000) - 5)
      .setExpirationTime("5m")
      .sign(privateKey);
    assert.equal((await mf.dispatchFetch(`${origin}/authorize?response_type=code&client_id=x&redirect_uri=${redirect}`, { headers: { "cf-access-jwt-assertion": stranger, origin } })).status, 403);
    const registered = await (await mf.dispatchFetch(`${origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "jwt-client", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    })).json();
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(verifier))).toString("base64url");
    const consent = await mf.dispatchFetch(`${origin}/authorize?${new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "secondary.read secondary.personal.write", resource })}`, {
      headers: { "cf-access-jwt-assertion": mcp, "x-dev-email": "bob@tenant-b.test", "x-dev-persona": "ceo", origin },
    });
    const consentText = await consent.text();
    assert.equal(consent.status, 200, consentText.slice(0, 240));
    assert.equal(consentText.includes(ADA), true);
    assert.equal(consentText.includes("bob@tenant-b.test"), false);
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
        "cf-access-jwt-assertion": mcp,
        "x-dev-email": "bob@tenant-b.test",
      },
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
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "jwt", version: "0" } } });
    assert.equal(init.status, 200, (await init.clone().text()).slice(0, 180));
    const session = init.headers.get("mcp-session-id");
    await call({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    const listed = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).text();
    assert.equal(listed.includes("personal_import"), true);
    const imported = toolJson(await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "personal_import", arguments: { source: "paste", externalId: "jwt-note", version: 1, text: "JWT consent note", clientId: "forged", principalId: "u_ceo" } } }, session)).text());
    assert.equal(imported.client, registered.client_id);
    assert.equal(imported.principalId, principalId(ADA));
    assert.notEqual(imported.principalId, "u_ceo");
    assert.equal(imported.usage, "unknown");
    assert.equal(imported.text, "JWT consent note");
    const read = toolJson(await (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "personal_import_read", arguments: { id: imported.id } } }, session)).text());
    assert.equal(read.item.text, "JWT consent note");
    const usage = toolJson(await (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "usage_lookup", arguments: {} } }, session)).text());
    assert.equal(usage.events.some((event) => event.operation === "import" && event.trust === "unknown" && event.inputTokens === null), true);
    const rotatedToken = await tokenFor(rotated.privateKey, "kid-b", MCP_AUD);
    const rotatedConsent = await mf.dispatchFetch(`${origin}/authorize?response_type=code&client_id=${registered.client_id}&redirect_uri=${redirect}&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(resource)}`, {
      headers: { "cf-access-jwt-assertion": rotatedToken, origin },
    });
    assert.equal(rotatedConsent.status, 200, (await rotatedConsent.clone().text()).slice(0, 180));
    const status = await (await mf.dispatchFetch("http://jwks.local/status")).json();
    assert.equal(status.hits, 3);
    assert.equal(status.leaked, 0);
  } finally {
    await mf.dispose();
  }
});

test("JWKS redirect and outage fail closed without following the redirect", async () => {
  const { publicKey } = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const built = bundleWorkerd();
  const entry = await bundleRelease();
  const api = readFileSync(built.api, "utf8");
  const mcp = readFileSync(built.mcp, "utf8");
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const token = await tokenFor(privateKey, "kid-a", BROWSER_AUD);
  for (const mode of ["redirect", "outage"]) {
    const mf = boot(mode, [keyA], entry, api, mcp);
    try {
      const response = await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 503, mode);
      const status = await (await mf.dispatchFetch("http://jwks.local/status")).json();
      assert.equal(status.leaked, 0, mode);
    } finally {
      await mf.dispose();
    }
  }
});
