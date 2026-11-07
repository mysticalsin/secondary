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

function jwksScript(publicKeys, mode, maxAge) {
  return `let hits = 0; let leaked = 0;
let mode = ${JSON.stringify(mode)};
let keys = ${JSON.stringify(publicKeys)};
let maxAge = ${Number(maxAge)};
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/status") return Response.json({ hits, leaked, mode });
  if (url.pathname === "/control" && request.method === "POST") {
    const body = await request.json();
    if (typeof body.mode === "string") mode = body.mode;
    if (Array.isArray(body.keys)) keys = body.keys;
    if (Number.isInteger(body.maxAge)) maxAge = body.maxAge;
    return Response.json({ ok: true, mode, maxAge });
  }
  if (url.href !== "http://127.0.0.1/jwks") { leaked += 1; return new Response("egress_denied", { status: 403 }); }
  hits += 1;
  if (mode === "outage") return new Response("unavailable", { status: 503 });
  if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "https://evil.invalid/jwks" } });
  let body = keys;
  if (mode === "rotate") body = hits < 2 ? [keys[0]] : keys;
  if (mode === "private") body = keys.map((key) => ({ ...key, d: "not-a-private-key" }));
  if (mode === "duplicate") body = [keys[0], { ...keys[0] }];
  if (mode === "oversize") body = [keys[0], keys[0], keys[0], keys[0], keys[0]];
  const age = mode === "rotate" ? 120 : maxAge;
  return Response.json({ keys: body }, { headers: { "cache-control": "public, max-age=" + age + ", must-revalidate" } });
} };`;
}

function boot(mode, keys, entry, api, mcp, options = {}) {
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
  const workers = [
      { config: { name: "deny-egress", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(deny) }, dev: denyOutbound },
      { config: { name: "jwks", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(jwksScript(keys, mode, options.maxAge ?? 120)), triggers: [{ type: "fetch", pattern: "jwks.local/*" }] }, dev: denyOutbound },
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
            OAUTH_KV: { type: "kv", id: options.kv ?? `oauth-kv-jwt-${mode}` },
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
  ];
  if (options.closedAdmission) {
    workers.push({
      config: {
        name: "release-closed",
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
            ADMITTED_TENANT_DOMAINS: options.closedAdmission,
          }).map(([key, value]) => [key, text(value)])),
          API: { type: "worker", worker: "api" },
          MCP: { type: "worker", worker: "mcp-auth" },
        },
        triggers: [{ type: "fetch", pattern: "closed.local/*" }],
      },
      dev: jwksOutbound,
    });
  }
  return new Miniflare({
    ...(options.persist ? { resourcePersistencePath: options.persist } : {}),
    workers,
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

const CARA = "cara@tenant-a.test";
const BOB = "bob@tenant-b.test";
const MARKER = "synthetic fixture harbor-remote";

function reviewRecord(id, notes) {
  return {
    schema_version: "relay.codex-review-run/1",
    record_id: id,
    capture: "historical-manual",
    agent: "Relay",
    tool: { name: "codex-cli", version: null, machine_label: null, model: null, reasoning_effort: null, sandbox: null },
    session_id: "synthetic-session",
    started_at: "2026-11-01T10:00:00-03:00",
    finished_at: "2026-11-01T11:00:00-03:00",
    timezone: "America/Sao_Paulo",
    analysis_kind: "static",
    target: { label: notes, archive_sha256: null, bundle_sha256: null, tree: null, baseline_head: null, patch_sha256: null },
    outcome: { completed: true, exit_code: null, overall_verdict: null, counts: { high: null, medium: null, low: null, fixed: null, cannot_determine: null } },
    tokens_used: null,
    writes_detected: false,
    context_scope: { usual_notes_loaded: null, out_of_folder_reads_observed: null, artifact_only_enforced: false },
    evidence_paths: ["/workspace/synthetic/evidence.txt"],
    notes,
  };
}

async function control(mf, body) {
  const response = await mf.dispatchFetch("http://jwks.local/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
}

test("fetched JWKS activity stays with one principal across reload and admission", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const built = bundleWorkerd();
  const entry = await bundleRelease();
  const api = readFileSync(built.api, "utf8");
  const mcp = readFileSync(built.mcp, "utf8");
  const persist = mkdtempSync(join(tmpdir(), "jwt-activity-"));
  const options = { persist, maxAge: 60, kv: "oauth-kv-activity", closedAdmission: '{"tenant-b.test":"tenant_beta"}' };
  const ada = await tokenFor(privateKey, "kid-a", BROWSER_AUD, { sub: "sub-ada" });
  const cara = await tokenFor(privateKey, "kid-a", BROWSER_AUD, { sub: "sub-cara", extra: { email: CARA } });
  const bob = await tokenFor(privateKey, "kid-a", BROWSER_AUD, { sub: "sub-bob", extra: { email: BOB } });
  const ndjson = `${JSON.stringify(reviewRecord("relay-synthetic-remote", MARKER))}\n`;
  let mf = boot("serve", [keyA], entry, api, mcp, options);
  try {
    const dev = await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity", { headers: { "x-dev-email": ADA } });
    assert.equal(dev.status, 401);
    const empty = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity", { headers: { authorization: `Bearer ${ada}`, "x-dev-email": BOB } })).text();
    assert.equal(empty.includes("Nothing has been imported"), true);
    assert.equal(empty.includes(MARKER), false);
    const posted = await mf.dispatchFetch("http://127.0.0.1/settings/observability/activity", {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${ada}`, "content-type": "application/x-www-form-urlencoded", "x-dev-email": BOB },
      body: new URLSearchParams({ ndjson }),
    });
    assert.equal(posted.status, 303, await posted.clone().text());
    const listed = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&q=harbor-remote&kind=static&capture=historical-manual&date=2026-11-01&record=relay-synthetic-remote", { headers: { authorization: `Bearer ${ada}` } })).text();
    assert.equal(listed.includes(MARKER), true);
    assert.equal(listed.includes("Not reported"), true);
    assert.equal(listed.includes("trusted_runtime_capture=false"), true);
    const filtered = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&kind=runtime", { headers: { authorization: `Bearer ${ada}` } })).text();
    assert.equal(filtered.includes(MARKER), false);
    const again = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&record=relay-synthetic-remote", { headers: { authorization: `Bearer ${ada}` } })).text();
    assert.equal(again.includes(MARKER), true);
    const sameTenant = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&record=relay-synthetic-remote", { headers: { authorization: `Bearer ${cara}` } })).text();
    assert.equal(sameTenant.includes(MARKER), false);
    assert.equal(sameTenant.includes("relay-synthetic-remote"), false);
    const otherTenant = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&record=relay-synthetic-remote", { headers: { authorization: `Bearer ${bob}` } })).text();
    assert.equal(otherTenant.includes(MARKER), false);
    const closed = await mf.dispatchFetch("http://closed.local/settings/observability?section=activity&record=relay-synthetic-remote", { headers: { authorization: `Bearer ${ada}` } });
    const closedText = await closed.text();
    assert.equal(closed.status, 403, closedText);
    assert.equal(closedText.includes(MARKER), false);
  } finally {
    await mf.dispose();
  }
  mf = boot("serve", [keyA], entry, api, mcp, options);
  try {
    const kept = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&q=harbor-remote", { headers: { authorization: `Bearer ${ada}` } })).text();
    assert.equal(kept.includes(MARKER), true);
    const cara = await tokenFor(privateKey, "kid-a", BROWSER_AUD, { sub: "sub-cara", extra: { email: CARA } });
    const hidden = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity", { headers: { authorization: `Bearer ${cara}` } })).text();
    assert.equal(hidden.includes(MARKER), false);
  } finally {
    await mf.dispose();
  }
});

test("JWKS cache expiry, outage, recovery, and old-key removal use the verifier clock only for cache", async () => {
  const first = await generateKeyPair("RS256", { extractable: true });
  const second = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(first.publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const keyB = await exportJWK(second.publicKey);
  keyB.alg = "RS256";
  keyB.use = "sig";
  keyB.kid = "kid-b";
  const built = bundleWorkerd();
  const entry = await bundleRelease();
  const api = readFileSync(built.api, "utf8");
  const mcp = readFileSync(built.mcp, "utf8");
  const mf = boot("serve", [keyA, keyB], entry, api, mcp, { maxAge: 1, kv: "oauth-kv-cache" });
  const ada = await tokenFor(first.privateKey, "kid-a", BROWSER_AUD);
  const kept = await tokenFor(second.privateKey, "kid-b", BROWSER_AUD);
  const ndjson = `${JSON.stringify(reviewRecord("relay-synthetic-cache", MARKER))}\n`;
  try {
    const posted = await mf.dispatchFetch("http://127.0.0.1/settings/observability/activity", {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${ada}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ndjson }),
    });
    assert.equal(posted.status, 303, await posted.clone().text());
    const before = await (await mf.dispatchFetch("http://jwks.local/status")).json();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await control(mf, { mode: "outage" });
    const outage = await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity", { headers: { authorization: `Bearer ${ada}` } });
    const outageText = await outage.text();
    assert.equal(outage.status, 503, outageText);
    assert.equal(outageText.includes(MARKER), false);
    const after = await (await mf.dispatchFetch("http://jwks.local/status")).json();
    assert.equal(after.hits > before.hits, true);
    for (const mode of ["private", "duplicate", "oversize"]) {
      await control(mf, { mode });
      const bad = await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${ada}` } });
      assert.equal(bad.status, 503, mode);
      assert.equal((await bad.text()).includes(MARKER), false);
    }
    await control(mf, { mode: "serve", keys: [keyB], maxAge: 60 });
    const removed = await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity", { headers: { authorization: `Bearer ${ada}` } });
    const removedText = await removed.text();
    assert.equal(removed.status, 401, removedText);
    assert.equal(removedText.includes(MARKER), false);
    const recovered = await (await mf.dispatchFetch("http://127.0.0.1/settings/observability?section=activity&q=harbor-remote", { headers: { authorization: `Bearer ${kept}` } })).text();
    assert.equal(recovered.includes(MARKER), true);
    const expired = await tokenFor(second.privateKey, "kid-b", BROWSER_AUD, { exp: Math.floor(Date.now() / 1000) - 30, nbf: Math.floor(Date.now() / 1000) - 120 });
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${expired}` } })).status, 401);
    const wrongIssuer = await tokenFor(second.privateKey, "kid-b", BROWSER_AUD, { issuer: "https://other.test" });
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${wrongIssuer}` } })).status, 401);
    const badEmail = await tokenFor(second.privateKey, "kid-b", BROWSER_AUD, { extra: { email: "not-an-email" } });
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${badEmail}` } })).status, 401);
    const blankSub = await tokenFor(second.privateKey, "kid-b", BROWSER_AUD, { sub: " " });
    assert.equal((await mf.dispatchFetch("http://127.0.0.1/reconstruction/import", { headers: { authorization: `Bearer ${blankSub}` } })).status, 401);
    const status = await (await mf.dispatchFetch("http://jwks.local/status")).json();
    assert.equal(status.leaked, 0);
  } finally {
    await mf.dispose();
  }
});

test("non-dev consent rejects cross-origin, a switched user, and a read-only grant", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const keyA = await exportJWK(publicKey);
  keyA.alg = "RS256";
  keyA.use = "sig";
  keyA.kid = "kid-a";
  const built = bundleWorkerd();
  const mf = boot("serve", [keyA], await bundleRelease(), readFileSync(built.api, "utf8"), readFileSync(built.mcp, "utf8"), { maxAge: 60, kv: "oauth-kv-consent" });
  const ada = await tokenFor(privateKey, "kid-a", MCP_AUD, { sub: "sub-ada" });
  const cara = await tokenFor(privateKey, "kid-a", MCP_AUD, { sub: "sub-cara", extra: { email: CARA } });
  try {
    const registered = await (await mf.dispatchFetch(`${origin}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "consent-client", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    })).json();
    const authorize = async (token) => {
      const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
      const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(verifier))).toString("base64url");
      const consent = await mf.dispatchFetch(`${origin}/authorize?${new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "secondary.read secondary.personal.write", resource })}`, {
        headers: { "cf-access-jwt-assertion": token, origin },
      });
      const html = await consent.text();
      assert.equal(consent.status, 200, html.slice(0, 180));
      const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
      const cookie = (consent.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
      return { verifier, handle, cookie };
    };
    const switched = await authorize(ada);
    const cross = await mf.dispatchFetch(`${origin}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.invalid", cookie: switched.cookie, "cf-access-jwt-assertion": ada },
      body: new URLSearchParams({ handle: switched.handle, decision: "approve", scope: "secondary.read" }),
    });
    assert.equal(cross.status, 403);
    assert.equal((await cross.text()).includes("Cross-site"), true);
    const otherUser = await mf.dispatchFetch(`${origin}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin, cookie: switched.cookie, "cf-access-jwt-assertion": cara },
      body: new URLSearchParams({ handle: switched.handle, decision: "approve", scope: "secondary.read secondary.personal.write" }),
    });
    assert.equal(otherUser.status, 403);
    assert.equal((await otherUser.text()).includes("different sign-in"), true);
    const approved = await mf.dispatchFetch(`${origin}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin, cookie: switched.cookie, "cf-access-jwt-assertion": ada },
      body: new URLSearchParams({ handle: switched.handle, decision: "approve", scope: "secondary.read" }),
    });
    assert.equal(approved.status, 302, await approved.clone().text());
    const code = new URL(approved.headers.get("location")).searchParams.get("code");
    const token = await (await mf.dispatchFetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: registered.client_id, code_verifier: switched.verifier, resource }),
    })).json();
    assert.equal(String(token.scope ?? "").includes("secondary.personal.write"), false);
    const call = async (body, session) => {
      const headers = { authorization: `Bearer ${token.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream", origin };
      if (session) headers["mcp-session-id"] = session;
      return mf.dispatchFetch(resource, { method: "POST", headers, body: JSON.stringify(body) });
    };
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "read-only", version: "0" } } });
    assert.equal(init.status, 200, (await init.clone().text()).slice(0, 160));
    const session = init.headers.get("mcp-session-id");
    await call({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    const denied = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "personal_import", arguments: { source: "paste", externalId: "read-only", version: 1, text: "should not store" } } }, session)).text();
    assert.equal(denied.includes("insufficient_scope"), true);
    assert.equal(denied.includes("should not store"), false);
    const read = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "usage_lookup", arguments: {} } }, session)).text();
    assert.equal(read.includes("insufficient_scope"), false);
  } finally {
    await mf.dispose();
  }
});
