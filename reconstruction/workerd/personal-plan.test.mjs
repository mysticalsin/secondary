/**
 * NEW RECONSTRUCTION. Own-brain plans for people who are not seed owners.
 * The recovered org planner is not given a new personalOwners entry.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Miniflare } from "miniflare";
import { signInternalRequest } from "../../recovered-source/worker/src/internal-auth.ts";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const principalId = (email) => `u_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
const DATE = "2026-11-07";
const HMAC = "synthetic-personal-plan-hmac-32ch";
const PERSIST = mkdtempSync(join(tmpdir(), "secondary-personal-plan-"));
const ADA = "ada@tenant-a.test";
const CARA = "cara@tenant-a.test";
const BOB = "bob@tenant-b.test";
const PLUS = "consultant+desk@tenant-a.test";
const EMPTY = "empty@tenant-a.test";
const SCRIPT = "Ada <img src=x onerror=alert(1)> note";
const HARBOR = "Ada harbor ledger alpha";
const KILN = "Cara kiln notes beta";
const ESTUARY = "Bob estuary gamma";
const DESK = "Plus desk omega";

const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

function boot(script, extra = [], persist = PERSIST) {
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const edge = `export default { async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    const url = new URL(request.url);
    url.hostname = "api.internal";
    return env.API.fetch(new Request(url, { method: request.method, headers, body: request.body }));
  } };`;
  return new Miniflare({
    resourcePersistencePath: persist,
    workers: [
      guarded({ name: "deny-egress", compatibilityDate: DATE, workersDev: false, previewUrls: false, manifest: moduleOf(deny) }),
      guarded({
        name: "api",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(script),
        env: {
          ...Object.fromEntries(Object.entries({
            ENVIRONMENT: "dev",
            DO_JURISDICTION: "off",
            DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
            DEFAULT_TENANT_ID: "tenant_alpha",
            TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta","example.invalid":"tenant_alpha"}',
            RATE_LIMIT_PER_MIN: "800",
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
        triggers: [{ type: "fetch", pattern: "api.local/*" }],
      }),
      guarded({
        name: "edge",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(edge),
        env: { API: { type: "worker", worker: "api" } },
        triggers: [{ type: "fetch", pattern: "edge.local/*" }],
      }),
      ...extra,
    ],
  });
}

async function call(mf, email, method, path, body, scope = ["secondary.read"], clientId = "client-a", persona) {
  const url = `http://edge.local${path}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = await signInternalRequest({
    secret: HMAC,
    method,
    url,
    ...(payload === undefined ? {} : { body: payload }),
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: `synthetic-${email}`,
      email,
      ...(persona ? { persona } : {}),
      client_id: clientId,
      scope,
      tool: "personal_import",
      grant_id: `g_${clientId}`,
      host: "other",
    },
  });
  const response = await mf.dispatchFetch(url, {
    method,
    headers: { ...headers, accept: "application/json", ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    ...(payload === undefined ? {} : { body: payload }),
  });
  const textBody = await response.text();
  let json = null;
  try { json = JSON.parse(textBody); } catch { json = null; }
  return { status: response.status, json, text: textBody };
}

const write = ["secondary.read", "secondary.personal.write"];
const note = (externalId, textValue) => ({ source: "paste", externalId, version: 1, text: textValue, clientId: "forged", principalId: "u_ceo" });

test("new owners get their own personal plan and not a seed org plan", async () => {
  const script = readFileSync(bundleWorkerd().api, "utf8");
  let mf = boot(script);
  const adaId = principalId(ADA);
  const plusId = principalId(PLUS);
  try {
    const denied = await call(mf, ADA, "GET", "/harness/personal/plan", undefined, ["secondary.personal.write"]);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.write, false);
    const rejected = await call(mf, ADA, "POST", "/harness/import", note("blocked", "Ada <script>alert(1)</script> note"), write);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error, "unsupported_content");
    const scripted = await call(mf, ADA, "POST", "/harness/import", note("scripted", SCRIPT), write);
    assert.equal(scripted.status, 201, scripted.text.slice(0, 200));
    const harbor = await call(mf, ADA, "POST", "/harness/import", note("harbor", HARBOR), write);
    assert.equal(harbor.status, 201, harbor.text.slice(0, 200));
    assert.equal(harbor.json.contentSha256, digest(HARBOR));
    for (let i = 1; i <= 103; i += 1) {
      const saved = await call(mf, ADA, "POST", "/harness/import", note(`filler-${String(i).padStart(4, "0")}`, `filler ${i}`), write);
      assert.equal(saved.status, 201, saved.text.slice(0, 160));
    }
    const cara = await call(mf, CARA, "POST", "/harness/import", note("kiln", KILN), write);
    const bob = await call(mf, BOB, "POST", "/harness/import", note("estuary", ESTUARY), write);
    const plus = await call(mf, PLUS, "POST", "/harness/import", note("desk", DESK), write);
    assert.equal(cara.status, 201, cara.text.slice(0, 200));
    assert.equal(bob.status, 201, bob.text.slice(0, 200));
    assert.equal(plus.status, 201, plus.text.slice(0, 200));
    const ada = await call(mf, ADA, "GET", "/harness/personal/plan");
    assert.equal(ada.status, 200, ada.text.slice(0, 300));
    assert.equal(ada.json.principalId, adaId);
    assert.equal(ada.json.tenantId, "tenant_alpha");
    assert.equal(ada.json.ai, "disabled");
    assert.equal(ada.json.write, false);
    assert.equal(ada.json.orgAcl, false);
    assert.equal(ada.json.coverage, "partial");
    assert.equal(ada.json.total, 105);
    assert.equal(ada.json.shown, 20);
    assert.equal(ada.json.context.some((item) => item.text === HARBOR && item.contentSha256 === digest(HARBOR)), true);
    assert.equal(ada.json.context.some((item) => item.text === SCRIPT), true);
    assert.equal(ada.json.context.some((item) => item.text === "filler 103"), false);
    assert.equal(ada.text.includes(KILN), false);
    assert.equal(ada.text.includes(ESTUARY), false);
    const again = await call(mf, ADA, "GET", "/harness/personal/plan");
    assert.equal(again.json.write, false);
    assert.equal(again.json.scope, "secondary.read");
    const caraPlan = await call(mf, CARA, "GET", "/harness/personal/plan");
    assert.equal(caraPlan.json.principalId, principalId(CARA));
    assert.equal(caraPlan.json.tenantId, "tenant_alpha");
    assert.equal(caraPlan.json.context.some((item) => item.text === KILN), true);
    assert.equal(caraPlan.text.includes(HARBOR), false);
    const bobPlan = await call(mf, BOB, "GET", "/harness/personal/plan");
    assert.equal(bobPlan.json.tenantId, "tenant_beta");
    assert.equal(bobPlan.json.context[0].text, ESTUARY);
    assert.equal(bobPlan.text.includes(HARBOR), false);
    const plusPlan = await call(mf, PLUS, "GET", "/harness/personal/plan");
    assert.equal(plusPlan.json.principalId, plusId);
    assert.notEqual(plusPlan.json.principalId, "u_consultant");
    assert.equal(plusPlan.json.principalId.startsWith("u_consultant"), false);
    assert.equal(plusPlan.json.principalId.startsWith("u_ceo"), false);
    assert.equal(plusPlan.json.context[0].text, DESK);
    assert.equal(plusPlan.json.orgAcl, false);
    const empty = await call(mf, EMPTY, "GET", "/harness/personal/plan");
    assert.equal(empty.json.empty, true);
    assert.equal(empty.json.total, 0);
    assert.equal(empty.json.context.length, 0);
    assert.equal(empty.text.includes("Account prep"), false);
    const forged = await call(mf, ADA, "GET", "/harness/personal/plan?principalId=u_consultant&brain=company&nodeId=pb:u_ceo");
    assert.equal(forged.status, 403);
    assert.equal(forged.text.includes(HARBOR), false);
    assert.equal(forged.text.includes("Account prep"), false);
    const guessed = await call(mf, CARA, "GET", `/harness/personal/plan?item=${harbor.json.id}`);
    assert.equal(guessed.status, 404);
    assert.equal(guessed.text.includes(HARBOR), false);
    const persona = await call(mf, PLUS, "GET", "/harness/personal/plan", undefined, ["secondary.read"], "client-a", "ceo");
    assert.equal(persona.status, 403);
    assert.equal(persona.text.includes(DESK), false);
    const org = await call(mf, ADA, "POST", "/v1/genui/plan", { prompt: "accounts" }, write);
    assert.equal(org.status, 403);
    assert.equal(org.json.reason, "org_denied");
    assert.equal(org.text.includes("Accounts"), false);
    assert.equal(org.text.includes(HARBOR), false);
  } finally {
    await mf.dispose();
  }
  mf = boot(script);
  try {
    const plusPlan = await call(mf, PLUS, "GET", "/harness/personal/plan");
    assert.equal(plusPlan.json.principalId, plusId);
    assert.equal(plusPlan.json.context[0].text, DESK);
    const ada = await call(mf, ADA, "GET", "/harness/personal/plan");
    assert.equal(ada.json.principalId, adaId);
    assert.equal(ada.json.coverage, "partial");
    assert.equal(ada.json.total, 105);
  } finally {
    await mf.dispose();
  }
});

test("the release edge personal page shows only that token's context", async () => {
  const script = readFileSync(bundleWorkerd().api, "utf8");
  const outfile = join(mkdtempSync(join(tmpdir(), "personal-release-")), "entry.js");
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
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "release-test";
  const ISSUER = "https://issuer.test";
  const AUDIENCE = "secondary-release-test";
  const tokenFor = (email) => new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "release-test" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(`synthetic-${email}`)
    .setExpirationTime("2m")
    .sign(privateKey);
  const release = guarded({
    name: "release-edge",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: moduleOf(readFileSync(outfile, "utf8")),
    env: {
      ...Object.fromEntries(Object.entries({
        RELEASE_MODE: "protected-dev",
        AUTH_ISSUER: ISSUER,
        AUTH_AUDIENCE: AUDIENCE,
        LOCAL_JWKS: JSON.stringify({ keys: [jwk] }),
        INTERNAL_HMAC_KEY: HMAC,
      }).map(([key, value]) => [key, text(value)])),
      API: { type: "worker", worker: "api" },
    },
    triggers: [{ type: "fetch", pattern: "release.local/*" }],
  });
  const mf = boot(script, [release], mkdtempSync(join(tmpdir(), "secondary-personal-release-")));
  try {
    assert.equal((await call(mf, ADA, "POST", "/harness/import", note("harbor", HARBOR), write)).status, 201);
    assert.equal((await call(mf, BOB, "POST", "/harness/import", note("estuary", ESTUARY), write)).status, 201);
    assert.equal((await call(mf, ADA, "POST", "/harness/import", note("scripted", SCRIPT), write)).status, 201);
    const adaToken = await tokenFor(ADA);
    const bobToken = await tokenFor(BOB);
    const adaPage = await mf.dispatchFetch("http://release.local/brains/me", { headers: { authorization: `Bearer ${adaToken}` } });
    const adaHtml = await adaPage.text();
    assert.equal(adaPage.status, 200, adaHtml.slice(0, 240));
    assert.equal(adaPage.headers.get("cache-control"), "no-store");
    assert.equal(adaHtml.includes(HARBOR), true);
    assert.equal(adaHtml.includes("Ada &lt;img src=x onerror=alert(1)&gt; note"), true);
    assert.equal(adaHtml.includes("<img"), false);
    assert.equal(adaHtml.includes(ESTUARY), false);
    assert.equal(adaHtml.includes("Deterministic plan. No model was called. AI is disabled."), true);
    assert.equal(adaHtml.includes("/brains/me"), true);
    const bobPage = await mf.dispatchFetch("http://release.local/brains/me", { headers: { authorization: `Bearer ${bobToken}` } });
    const bobHtml = await bobPage.text();
    assert.equal(bobHtml.includes(ESTUARY), true);
    assert.equal(bobHtml.includes(HARBOR), false);
    const closed = await mf.dispatchFetch("http://release.local/brains/me?nodeId=pb:u_ceo&brain=company", { headers: { authorization: `Bearer ${adaToken}` } });
    const closedHtml = await closed.text();
    assert.equal(closed.status, 403);
    assert.equal(closedHtml.includes(HARBOR), false);
    assert.equal(closedHtml.includes("not open to this session"), true);
    const shell = await mf.dispatchFetch("http://release.local/settings", { headers: { authorization: `Bearer ${adaToken}` } });
    assert.equal((await shell.text()).includes('href="/brains/me"'), true);
    const hidden = await mf.dispatchFetch("http://release.local/v1/genui/plan", { method: "POST", headers: { authorization: `Bearer ${adaToken}` } });
    assert.equal(hidden.status, 404);
    const postImport = (token, fields) => mf.dispatchFetch("http://release.local/reconstruction/import", {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    const readImport = async (token, query = "") => {
      const response = await mf.dispatchFetch(`http://release.local/reconstruction/import${query}`, { headers: { authorization: `Bearer ${token}` } });
      return { status: response.status, html: await response.text() };
    };
    const pasted = await postImport(adaToken, { externalId: "browser-row", version: "1", source: "paste", text: "Browser paste row" });
    assert.equal(pasted.status, 303);
    assert.equal(pasted.headers.get("location"), "/reconstruction/import?result=stored");
    const readBack = await readImport(adaToken, "?result=stored");
    assert.equal(readBack.html.includes("Browser paste row"), true);
    assert.equal(readBack.html.includes("server read-back"), true);
    assert.equal(readBack.html.includes("Open Personal brain"), true);
    assert.equal(readBack.html.includes("No model was called"), true);
    assert.equal(readBack.html.includes("Coverage is full"), true);
    const brain = await mf.dispatchFetch("http://release.local/brains/me", { headers: { authorization: `Bearer ${adaToken}` } });
    assert.equal((await brain.text()).includes("Browser paste row"), true);
    const again = await readImport(adaToken);
    assert.equal(again.html.includes("Browser paste row"), true);
    const duplicate = await postImport(adaToken, { externalId: "browser-row", version: "1", source: "paste", text: "Browser paste row" });
    assert.equal(duplicate.headers.get("location"), "/reconstruction/import?result=duplicate");
    const duplicatePage = await readImport(adaToken, "?result=duplicate");
    assert.equal(duplicatePage.html.split("Browser paste row").length - 1, 1);
    const conflict = await postImport(adaToken, { externalId: "browser-row", version: "1", source: "paste", text: "Browser paste replaced" });
    assert.equal(conflict.headers.get("location"), "/reconstruction/import?result=conflict");
    const conflictPage = await readImport(adaToken, "?result=conflict");
    assert.equal(conflictPage.html.includes("Nothing new was stored"), true);
    assert.equal(conflictPage.html.includes("Browser paste replaced"), false);
    const next = await postImport(adaToken, { externalId: "browser-row", version: "2", source: "paste", text: "Browser paste revised" });
    assert.equal(next.headers.get("location"), "/reconstruction/import?result=stored");
    const revised = await readImport(adaToken, "?result=stored");
    assert.equal(revised.html.includes("Browser paste revised"), true);
    assert.equal(revised.html.includes("Browser paste row"), true);
    const file = await postImport(adaToken, { externalId: "file-row", version: "1", source: "file", filename: "notes.md", text: "File note from md" });
    assert.equal(file.headers.get("location"), "/reconstruction/import?result=stored");
    assert.equal((await readImport(adaToken)).html.includes("File note from md"), true);
    const bobImport = await readImport(bobToken);
    assert.equal(bobImport.html.includes("Browser paste row"), false);
    assert.equal(bobImport.html.includes("File note from md"), false);
    assert.equal(bobImport.html.includes(ESTUARY), true);
    const adaUsage = await (await mf.dispatchFetch("http://release.local/settings/observability?section=usage", { headers: { authorization: `Bearer ${adaToken}` } })).text();
    assert.equal(adaUsage.includes("Unknown"), true);
    assert.equal(adaUsage.includes("No model was called"), true);
    assert.equal(adaUsage.includes(ESTUARY), false);
    const bobUsage = await (await mf.dispatchFetch("http://release.local/settings/observability?section=usage", { headers: { authorization: `Bearer ${bobToken}` } })).text();
    assert.equal(bobUsage.includes("Browser paste"), false);
    assert.equal(bobUsage.includes("No usage events") || bobUsage.includes("Unknown"), true);
  } finally {
    await mf.dispose();
  }
});
