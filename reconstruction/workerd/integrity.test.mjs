/**
 * NEW RECONSTRUCTION. Import and usage integrity beyond the latest 100 rows.
 * Client identity is the validated OAuth/HMAC client id, not a body field.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { signInternalRequest } from "../../recovered-source/worker/src/internal-auth.ts";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const DATE = "2026-11-07";
const HMAC = "synthetic-integrity-hmac-key-32ch";
const PERSIST = mkdtempSync(join(tmpdir(), "secondary-integrity-"));
const ADA = "ada@tenant-a.test";
const BOB = "bob@tenant-b.test";

const text = (value) => ({ type: "text", value });
const moduleOf = (contents) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
const guarded = (config) => ({ config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } });

function boot(script) {
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const edge = `export default { async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    const url = new URL(request.url);
    url.hostname = "api.internal";
    return env.API.fetch(new Request(url, { method: request.method, headers, body: request.body }));
  } };`;
  return new Miniflare({
    resourcePersistencePath: PERSIST,
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
        manifest: moduleOf(script),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DO_JURISDICTION: "off",
              DEV_AUTH_BYPASS_EMAIL: ADA,
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}',
              RATE_LIMIT_PER_MIN: "600",
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
    ],
  });
}

async function call(mf, email, method, path, body, scope, clientId) {
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
      client_id: clientId,
      scope,
      tool: "import",
      grant_id: `g_${clientId}`,
      host: "other",
    },
  });
  const response = await mf.dispatchFetch(url, {
    method,
    headers: {
      ...headers,
      accept: "application/json",
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
  const textBody = await response.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch {
    json = null;
  }
  return { status: response.status, json, text: textBody };
}

const write = ["secondary.read", "secondary.personal.write"];
const note = (externalId, version, text) => ({
  source: "paste",
  externalId,
  version,
  text,
  clientId: "caller-forged",
  principalId: "u_consultant",
  tenantId: "tenant_beta",
  usage: 0,
});

test("imports and usage stay unique past 100 rows and across concurrent retries", async () => {
  const script = await import("node:fs").then((fs) => fs.readFileSync(bundleWorkerd().api, "utf8"));
  let mf = await boot(script);
  let first;
  try {
    const denied = await call(mf, ADA, "POST", "/harness/import", note("item-0001", 1, "control 1"), ["secondary.read"], "client-a");
    assert.equal(denied.status, 403);
    const created = [];
    for (let i = 1; i <= 105; i += 1) {
      const externalId = `item-${String(i).padStart(4, "0")}`;
      const saved = await call(mf, ADA, "POST", "/harness/import", note(externalId, 1, `control ${i}`), write, "client-a");
      assert.equal(saved.status, 201, saved.text);
      assert.equal(saved.json.client, "client-a");
      assert.notEqual(saved.json.principalId, "u_consultant");
      assert.equal(saved.json.contentSha256, digest(`control ${i}`));
      created.push(saved.json);
    }
    first = created[0];
    const page = await call(mf, ADA, "GET", "/harness/import?limit=20", undefined, ["secondary.read"], "client-a");
    assert.equal(page.status, 200, page.text);
    assert.equal(page.json.items.length, 20);
    assert.equal(page.json.complete, false);
    assert.equal(page.json.coverage, "partial");
    assert.equal(page.json.total, 105);
    const newest = await call(mf, ADA, "GET", "/harness/import?limit=20&cursor=100", undefined, ["secondary.read"], "client-a");
    assert.equal(newest.json.items.some((item) => item.id === first.id), false);
    const retry = await call(mf, ADA, "POST", "/harness/import", note("item-0001", 1, "control 1"), write, "client-a");
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.json.outcome, "duplicate");
    assert.equal(retry.json.id, first.id);
    assert.equal(retry.json.contentSha256, digest("control 1"));
    const afterRetry = await call(mf, ADA, "GET", "/harness/import?limit=50", undefined, ["secondary.read"], "client-a");
    assert.equal(afterRetry.json.total, 105);
    const found = await call(mf, ADA, "GET", "/harness/import?q=item-0001&limit=20", undefined, ["secondary.read"], "client-a");
    assert.equal(found.json.items.some((item) => item.id === first.id), true);
    assert.equal(found.json.coverage, "partial");
    const same = Array.from({ length: 8 }, () =>
      call(mf, ADA, "POST", "/harness/import", note("race-same", 1, "same body"), write, "client-a"),
    );
    const raced = await Promise.all(same);
    assert.equal(raced.filter((item) => item.status === 201).length, 1);
    assert.equal(raced.filter((item) => item.json?.outcome === "duplicate").length, 7);
    const raceId = raced.find((item) => item.status === 201).json.id;
    const clash = await Promise.all([
      call(mf, ADA, "POST", "/harness/import", note("race-same", 1, "same body"), write, "client-a"),
      call(mf, ADA, "POST", "/harness/import", note("race-same", 1, "other body"), write, "client-a"),
      call(mf, ADA, "POST", "/harness/import", note("race-same", 1, "third body"), write, "client-a"),
    ]);
    assert.equal(clash.some((item) => item.status === 201), false);
    assert.equal(clash.filter((item) => item.status === 409).length, 2);
    assert.equal(clash.filter((item) => item.json?.outcome === "duplicate").length, 1);
    const otherClient = await call(mf, ADA, "POST", "/harness/import", note("race-same", 1, "same body"), write, "client-b");
    assert.equal(otherClient.status, 201, otherClient.text);
    assert.notEqual(otherClient.json.id, raceId);
    assert.equal(otherClient.json.client, "client-b");
    const bob = await call(mf, BOB, "POST", "/harness/import", note("race-same", 1, "same body"), write, "client-a");
    assert.equal(bob.status, 201, bob.text);
    assert.notEqual(bob.json.principalId, raced.find((item) => item.status === 201).json.principalId);
    const version = await call(mf, ADA, "POST", "/harness/import", note("item-0001", 2, "control 1 revised"), write, "client-a");
    assert.equal(version.status, 201, version.text);
    assert.equal(version.json.previous, first.id);
    assert.equal(version.json.contentSha256, digest("control 1 revised"));
    const streamHigh = await call(mf, ADA, "POST", "/harness/ledger", {
      eventId: "stream-high",
      outcome: "ok",
      providerRequestId: "preq-order",
      streamSeq: 2,
      inputTokens: 5,
      outputTokens: 4,
      totalTokens: 9,
    }, write, "client-a");
    assert.equal(streamHigh.status, 201, streamHigh.text);
    const streamLow = await call(mf, ADA, "POST", "/harness/ledger", {
      eventId: "stream-low",
      outcome: "ok",
      providerRequestId: "preq-order",
      streamSeq: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }, write, "client-a");
    assert.equal(streamLow.status, 409, streamLow.text);
    const otherClaim = await call(mf, ADA, "POST", "/harness/ledger", {
      eventId: "stream-high",
      outcome: "ok",
      providerRequestId: "preq-order",
      streamSeq: 3,
      inputTokens: 8,
      outputTokens: 4,
      totalTokens: 12,
    }, write, "client-b");
    assert.equal(otherClaim.status, 403, otherClaim.text);
    const seen = await call(mf, ADA, "GET", "/harness/ledger?requestId=preq-order", undefined, ["secondary.read"], "client-a");
    assert.equal(seen.json.events[0].inputTokens, 5);
    assert.equal(seen.json.events.length, 1);
  } finally {
    await mf.dispose();
  }
  mf = await boot(script);
  try {
    const page = await call(mf, ADA, "GET", "/harness/import?limit=50", undefined, ["secondary.read"], "client-a");
    assert.equal(page.json.total, 108);
    const again = await call(mf, ADA, "POST", "/harness/import", note("item-0001", 1, "control 1"), write, "client-a");
    assert.equal(again.json.outcome, "duplicate");
    assert.equal(again.json.id, first.id);
    const revised = await call(mf, ADA, "GET", "/harness/import?q=item-0001", undefined, ["secondary.read"], "client-a");
    const version2 = revised.json.items.find((item) => item.version === 2);
    assert.equal(version2.previous, first.id);
    assert.equal(version2.contentSha256, digest("control 1 revised"));
    const events = await call(mf, ADA, "GET", "/harness/ledger?limit=20", undefined, ["secondary.read"], "client-a");
    assert.equal(events.json.complete, false);
    assert.equal(events.json.coverage, "partial");
    assert.equal(events.json.total > 100, true);
    assert.equal(events.json.events.length, 20);
  } finally {
    await mf.dispose();
  }
});
