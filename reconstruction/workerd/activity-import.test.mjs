/**
 * NEW RECONSTRUCTION. Synthetic review-activity imports.
 * These rows are fixtures. They are not the parent's three historical records.
 */
import assert from "node:assert/strict";
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
const DATE = "2026-11-07";
const HMAC = "synthetic-activity-hmac-key-32ch";
const ADA = "ada@tenant-a.test";
const BOB = "bob@tenant-b.test";
const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

function record(id, notes, kind = "static", capture = "historical-manual", started = "2026-11-01T10:00:00-03:00") {
  return {
    schema_version: "relay.codex-review-run/1",
    record_id: id,
    capture,
    agent: "Relay",
    tool: { name: "codex-cli", version: null, machine_label: null, model: null, reasoning_effort: null, sandbox: null },
    session_id: "synthetic-session",
    started_at: started,
    finished_at: started.replace("T10", "T11"),
    timezone: "America/Sao_Paulo",
    analysis_kind: kind,
    target: { label: `synthetic fixture ${id}`, archive_sha256: null, bundle_sha256: null, tree: null, baseline_head: null, patch_sha256: null },
    outcome: { completed: true, exit_code: null, overall_verdict: null, counts: { high: null, medium: null, low: null, fixed: null, cannot_determine: null } },
    tokens_used: null,
    writes_detected: false,
    context_scope: { usual_notes_loaded: null, out_of_folder_reads_observed: null, artifact_only_enforced: false },
    evidence_paths: ["/workspace/synthetic/evidence.txt"],
    notes,
  };
}

function boot(script, extra = [], persist = mkdtempSync(join(tmpdir(), "secondary-activity-"))) {
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

async function call(mf, email, method, path, body) {
  const url = `http://edge.local${path}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = await signInternalRequest({
    secret: HMAC,
    method,
    url,
    ...(payload === undefined ? {} : { body: payload }),
    principal: {
      v: 1, iss: "secondary-mcp", aud: "secondary-api", sub: `synthetic-${email}`, email,
      client_id: "activity-test", scope: method === "GET" ? ["secondary.read"] : ["secondary.read", "secondary.personal.write"],
      tool: "activity", grant_id: "g_activity", host: "other",
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

test("synthetic review imports stay with the signed-in user", async () => {
  const script = readFileSync(bundleWorkerd().api, "utf8");
  const persist = mkdtempSync(join(tmpdir(), "secondary-activity-"));
  const line = `${JSON.stringify(record("relay-synthetic-ada", "synthetic fixture harbor <script>alert(1)</script>"))}\n`;
  const runtime = `${JSON.stringify(record("relay-synthetic-run", "synthetic fixture runtime", "runtime", "live-exporter", "2026-11-02T10:00:00-03:00"))}\n`;
  let mf = boot(script, [], persist);
  try {
    const empty = await call(mf, ADA, "GET", "/harness/activity");
    assert.equal(empty.status, 200, empty.text);
    assert.equal(empty.json.items.length, 0);
    assert.equal(empty.json.trusted_runtime_capture, false);
    const denied = await call(mf, ADA, "POST", "/harness/activity", { ndjson: line, owner: "u_ceo" });
    assert.equal(denied.status, 403);
    const wrongEmail = await call(mf, ADA, "POST", "/harness/activity", { ndjson: line, email: "bob@tenant-b.test" });
    assert.equal(wrongEmail.status, 403);
    const saved = await call(mf, ADA, "POST", "/harness/activity", { ndjson: line + runtime });
    assert.equal(saved.status, 200, saved.text);
    const again = await call(mf, ADA, "POST", "/harness/activity", { ndjson: line });
    assert.equal(again.status, 200, again.text);
    const changed = record("relay-synthetic-ada", "synthetic fixture different");
    const conflict = await call(mf, ADA, "POST", "/harness/activity", { ndjson: `${JSON.stringify(changed)}\n` });
    assert.equal(conflict.status, 409);
    const listed = await call(mf, ADA, "GET", "/harness/activity?q=harbor");
    assert.equal(listed.json.items.length, 1);
    assert.equal(listed.json.items[0].token_usage.value, null);
    assert.equal(listed.json.items[0].untrusted_notes.includes("<script>alert(1)</script>"), true);
    assert.equal(listed.json.items[0].trusted_runtime_capture, false);
    const kind = await call(mf, ADA, "GET", "/harness/activity?kind=runtime&capture=live-exporter&date=2026-11-02");
    assert.equal(kind.json.items.length, 1);
    assert.equal(kind.json.items[0].id, "relay-synthetic-run");
    const partial = await call(mf, ADA, "POST", "/harness/activity", { ndjson: `${line}{"record_id":` });
    assert.equal(partial.status, 200, partial.text);
    assert.equal(partial.json.snapshot_complete, false);
    const bob = await call(mf, BOB, "GET", "/harness/activity?record=relay-synthetic-ada");
    assert.equal(bob.status, 404);
    assert.equal(bob.text.includes("harbor"), false);
    const malformed = await call(mf, ADA, "POST", "/harness/activity", { ndjson: "{}\n" });
    assert.equal(malformed.status, 400);
    const still = await call(mf, ADA, "GET", "/harness/activity?q=harbor");
    assert.equal(still.json.items[0].untrusted_notes.includes("different"), false);
  } finally {
    await mf.dispose();
  }
  mf = boot(script, [], persist);
  try {
    const listed = await call(mf, ADA, "GET", "/harness/activity?q=harbor");
    assert.equal(listed.json.items.length, 1);
    const bob = await call(mf, BOB, "GET", "/harness/activity");
    assert.equal(bob.json.items.length, 0);
  } finally {
    await mf.dispose();
  }
});

test("the release activity page escapes notes and clears across tokens", async () => {
  const script = readFileSync(bundleWorkerd().api, "utf8");
  const outfile = join(mkdtempSync(join(tmpdir(), "activity-release-")), "entry.js");
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
  const tokenFor = (email) => new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "release-test" }).setIssuer("https://issuer.test").setAudience("secondary-release-test").setSubject(email).setExpirationTime("10m").sign(privateKey);
  const release = guarded({
    name: "release-edge",
    compatibilityDate: DATE,
    workersDev: false,
    previewUrls: false,
    manifest: moduleOf(readFileSync(outfile, "utf8")),
    env: {
      ...Object.fromEntries(Object.entries({
        RELEASE_MODE: "protected-dev",
        AUTH_ISSUER: "https://issuer.test",
        AUTH_AUDIENCE: "secondary-release-test",
        LOCAL_JWKS: JSON.stringify({ keys: [jwk] }),
        INTERNAL_HMAC_KEY: HMAC,
      }).map(([key, value]) => [key, text(value)])),
      API: { type: "worker", worker: "api" },
    },
    triggers: [{ type: "fetch", pattern: "release.local/*" }],
  });
  const mf = boot(script, [release]);
  const ada = await tokenFor(ADA);
  const bob = await tokenFor(BOB);
  const ndjson = `${JSON.stringify(record("relay-synthetic-ada", "synthetic fixture harbor <script>alert(1)</script>"))}\n`;
  try {
    const empty = await mf.dispatchFetch("http://release.local/settings/observability?section=activity", { headers: { authorization: `Bearer ${ada}` } });
    assert.equal((await empty.text()).includes("Nothing has been imported"), true);
    const posted = await mf.dispatchFetch("http://release.local/settings/observability/activity", {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${ada}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ndjson }),
    });
    assert.equal(posted.status, 303, await posted.text());
    const page = await mf.dispatchFetch("http://release.local/settings/observability?section=activity&result=stored&record=relay-synthetic-ada", { headers: { authorization: `Bearer ${ada}` } });
    const html = await page.text();
    assert.equal(page.status, 200, html.slice(0, 200));
    assert.equal(html.includes("synthetic fixture harbor &lt;script&gt;alert(1)&lt;/script&gt;"), true);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes('href="/workspace/'), false);
    assert.equal(html.includes("Not reported"), true);
    assert.equal(html.includes("trusted_runtime_capture=false"), true);
    assert.equal(html.includes("not proof"), true);
    const other = await (await mf.dispatchFetch("http://release.local/settings/observability?section=activity", { headers: { authorization: `Bearer ${bob}` } })).text();
    assert.equal(other.includes("relay-synthetic-ada"), false);
    assert.equal(other.includes("Nothing has been imported"), true);
  } finally {
    await mf.dispose();
  }
});
