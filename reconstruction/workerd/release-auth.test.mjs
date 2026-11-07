/**
 * NEW RECONSTRUCTION. Protected-dev edge and non-dev MCP auth negatives.
 * The JWT issuer is a local test key. It is not production Access or Entra.
 * This file loads reconstruction/release/entry.ts. MCP loads import-entry.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Miniflare } from "miniflare";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const ISSUER = "https://issuer.test";
const AUDIENCE = "secondary-release-test";
const HMAC = "synthetic-release-hmac-key-32chars";

const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

function bundleRelease() {
  const outfile = join(mkdtempSync(join(tmpdir(), "release-entry-")), "entry.js");
  const run = spawnSync(
    "npx",
    ["esbuild", "reconstruction/release/entry.ts", "--bundle", "--format=esm", "--platform=neutral", "--target=es2022", `--outfile=${outfile}`, "--external:cloudflare:workers"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
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
  const entry = readFileSync(bundleRelease(), "utf8");
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
      headers: { authorization: `Bearer ${good}`, "content-type": "application/x-www-form-urlencoded" },
      body: "text=Release+synthetic+note",
    });
    const savedText = await saved.text();
    assert.equal(saved.status, 201, savedText.slice(0, 300));
    assert.equal(savedText.includes("unknown"), true);
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
