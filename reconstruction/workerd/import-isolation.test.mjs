/**
 * NEW RECONSTRUCTION. Two synthetic users, two tenants, durable personal imports.
 * Recovered personal items are the store. The import gate is reconstruction.
 * Seed owners are not reused. External model usage stays unknown.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { signInternalRequest } from "../../recovered-source/worker/src/internal-auth.ts";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DATE = "2026-11-07";
const HMAC = "synthetic-import-hmac-key-32chars";
const PERSIST = mkdtempSync(join(tmpdir(), "secondary-import-"));
const ADA = "ada@tenant-a.test";
const BOB = "bob@tenant-b.test";

function text(value) {
  return { type: "text", value };
}

function guarded(config) {
  return { config, dev: { outboundService: { type: "worker", worker: "deny-egress" } } };
}

function moduleOf(contents) {
  return { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } };
}

async function boot() {
  const built = bundleWorkerd();
  const deny = `export default { fetch() { return new Response("egress_denied", { status: 403 }); } };`;
  const gate = `export default { async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    const url = new URL(request.url);
    url.hostname = "api.internal";
    return env.API.fetch(new Request(url, { method: request.method, headers, body: request.body }));
  } };`;
  const mf = new Miniflare({
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
        manifest: moduleOf(await import("node:fs").then((fs) => fs.readFileSync(built.api, "utf8"))),
        env: {
          ...Object.fromEntries(
            Object.entries({
              ENVIRONMENT: "dev",
              DO_JURISDICTION: "off",
              DEV_AUTH_BYPASS_EMAIL: ADA,
              DEFAULT_TENANT_ID: "tenant_alpha",
              TENANT_DOMAINS: '{"tenant-a.test":"tenant_alpha","tenant-b.test":"tenant_beta"}',
              RATE_LIMIT_PER_MIN: "60",
              INTERNAL_HMAC_KEY: HMAC,
            }).map(([key, value]) => [key, text(value)]),
          ),
          TENANT_POLICY: { type: "durable-object", worker: "api", exportName: "TenantPolicy" },
          WORKSPACE: { type: "durable-object", worker: "api", exportName: "Workspace" },
          BLOBS: { type: "r2" },
        },
        exports: {
          TenantPolicy: { type: "durable-object", storage: "sqlite" },
          Workspace: { type: "durable-object", storage: "sqlite" },
        },
        triggers: [{ type: "fetch", pattern: "api.local/*" }],
      }),
      guarded({
        name: "import-gate",
        compatibilityDate: DATE,
        workersDev: false,
        previewUrls: false,
        manifest: moduleOf(gate),
        env: { API: { type: "worker", worker: "api" } },
        triggers: [{ type: "fetch", pattern: "import-gate.local/*" }],
      }),
    ],
  });
  await mf.ready;
  return mf;
}

async function signed(email, method, path, body, scope, persona) {
  const url = `http://import-gate.local${path}`;
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
      client_id: "synthetic-import-client",
      scope,
      tool: "import",
      grant_id: `g_${email.split("@")[0]}`,
      host: "other",
      ...(persona ? { persona } : {}),
    },
  });
  return { url, headers, payload };
}

async function call(mf, email, method, path, body, scope, persona) {
  const signedRequest = await signed(email, method, path, body, scope, persona);
  const response = await mf.dispatchFetch(signedRequest.url, {
    method,
    headers: {
      ...signedRequest.headers,
      accept: "application/json",
      ...(signedRequest.payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(signedRequest.payload === undefined ? {} : { body: signedRequest.payload }),
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

const note = (externalId, version, text, filename) => ({
  source: filename ? "file" : "paste",
  externalId,
  version,
  text,
  ...(filename ? { filename } : {}),
  principalId: "u_consultant",
  tenantId: "tenant_beta",
});

test("two new users keep separate durable imports across a restart", async () => {
  const write = ["secondary.read", "secondary.personal.write"];
  let mf = await boot();
  try {
    const open = await mf.dispatchFetch("http://import-gate.local/harness/import", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(note("doc-1", 1, "Unsigned note")),
    });
    assert.equal(open.status, 401);
    const denied = await call(mf, ADA, "POST", "/harness/import", note("doc-1", 1, "Ada synthetic note"), ["secondary.read"]);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "insufficient_scope");
    const malicious = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "<script>alert(1)</script>"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(malicious.status, 400);
    assert.equal(malicious.json.outcome, "rejected");
    const remote = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      { ...note("doc-1", 1, "Ada synthetic note"), url: "https://example.invalid/secret.txt" },
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(remote.status, 400);
    assert.equal(remote.json.error, "url_import_refused");
    const traversal = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "path payload", "../secret.md"),
      write,
    );
    assert.equal(traversal.status, 400);
    assert.equal(traversal.json.error, "invalid_filename");
    const executable = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "binary payload", "run.exe"),
      write,
    );
    assert.equal(executable.status, 400);
    assert.equal(executable.json.error, "unsupported_type");
    const oversize = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "x".repeat(7001)),
      write,
    );
    assert.equal(oversize.status, 400);
    assert.equal(oversize.json.error, "invalid_text");
    const seed = await call(
      mf,
      "consultant@example.invalid",
      "POST",
      "/harness/import",
      note("seed", 1, "Do not rewrite the seed owner"),
      write,
      "consultant",
    );
    assert.equal(seed.status, 403);
    assert.equal(seed.json.error, "seed_owner_not_rewritten");
    const empty = await call(mf, ADA, "GET", "/harness/import", undefined, ["secondary.read"]);
    assert.equal(empty.status, 200, empty.text);
    assert.equal(empty.json.items.length, 0);
    const ada = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "Ada synthetic note", "ada.md"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(ada.status, 201, ada.text);
    assert.notEqual(ada.json.principalId, "u_consultant");
    assert.equal(ada.json.tenantId, "tenant_alpha");
    assert.equal(ada.json.usage, "unknown");
    assert.equal(ada.json.author, ada.json.principalId);
    const duplicate = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "Ada synthetic note", "ada.md"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.outcome, "duplicate");
    assert.equal(duplicate.json.id, ada.json.id);
    const conflict = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 1, "Ada replaced note", "ada.md"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(conflict.status, 409);
    const correction = await call(
      mf,
      ADA,
      "POST",
      "/harness/import",
      note("doc-1", 2, "Ada corrected note", "ada.md"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(correction.status, 201);
    assert.equal(correction.json.previous, ada.json.id);
    const bob = await call(
      mf,
      BOB,
      "POST",
      "/harness/import",
      note("doc-1", 1, "Bob synthetic note", "bob.txt"),
      ["secondary.read", "secondary.personal.write"],
    );
    assert.equal(bob.status, 201, bob.text);
    assert.equal(bob.json.tenantId, "tenant_beta");
    assert.notEqual(bob.json.principalId, ada.json.principalId);
    const adaList = await call(mf, ADA, "GET", "/harness/import", undefined, ["secondary.read"]);
    const bobList = await call(mf, BOB, "GET", "/harness/import", undefined, ["secondary.read"]);
    assert.equal(adaList.json.items.some((item) => item.text === "Bob synthetic note"), false);
    assert.equal(bobList.json.items.some((item) => item.text === "Ada synthetic note"), false);
    assert.equal(adaList.json.items.some((item) => item.text === "Ada corrected note"), true);
    assert.equal(adaList.json.items.some((item) => item.text.includes("<script")), false);
    assert.equal(adaList.json.items.some((item) => item.text === "Unsigned note"), false);
    assert.equal(adaList.json.items.some((item) => item.text === "Do not rewrite the seed owner"), false);
    assert.equal(adaList.json.usage, "unknown");
    const sameHash = await call(
      mf,
      BOB,
      "POST",
      "/harness/import",
      note("shared-looking", 1, "Ada synthetic note", "copy.md"),
      write,
    );
    assert.equal(sameHash.status, 201, sameHash.text);
    assert.notEqual(sameHash.json.id, ada.json.id);
    assert.equal(sameHash.json.tenantId, "tenant_beta");
    assert.equal(sameHash.json.principalId, bob.json.principalId);
    const plus = await call(
      mf,
      "consultant+new@tenant-b.test",
      "POST",
      "/harness/import",
      note("plus", 1, "Plus address stays separate", "plus.md"),
      write,
      "consultant",
    );
    assert.equal(plus.status, 201, plus.text);
    assert.match(plus.json.principalId, /^u_consultant_/);
    assert.notEqual(plus.json.principalId, "u_consultant");
    assert.notEqual(plus.json.principalId, bob.json.principalId);
    assert.equal(plus.json.tenantId, "tenant_beta");
    const plusList = await call(
      mf,
      "consultant+new@tenant-b.test",
      "GET",
      "/harness/import",
      undefined,
      ["secondary.read"],
      "consultant",
    );
    assert.equal(plusList.json.items.some((item) => item.text === "Bob synthetic note"), false);
    assert.equal(plusList.json.items.some((item) => item.text === "Plus address stays separate"), true);
    const bobAfter = await call(mf, BOB, "GET", "/harness/import", undefined, ["secondary.read"]);
    assert.equal(bobAfter.json.items.some((item) => item.text === "Plus address stays separate"), false);
    assert.equal(bobAfter.json.items.some((item) => item.text === "Ada synthetic note"), true);
  } finally {
    await mf.dispose();
  }
  mf = await boot();
  try {
    const adaList = await call(mf, ADA, "GET", "/harness/import", undefined, ["secondary.read"]);
    const bobList = await call(mf, BOB, "GET", "/harness/import", undefined, ["secondary.read"]);
    const plusList = await call(
      mf,
      "consultant+new@tenant-b.test",
      "GET",
      "/harness/import",
      undefined,
      ["secondary.read"],
      "consultant",
    );
    assert.equal(adaList.status, 200, adaList.text);
    assert.equal(adaList.json.items.some((item) => item.text === "Ada synthetic note"), true);
    assert.equal(adaList.json.items.some((item) => item.text === "Ada corrected note"), true);
    assert.equal(bobList.json.items.some((item) => item.text === "Bob synthetic note"), true);
    assert.equal(bobList.json.items.some((item) => item.text === "Ada synthetic note"), true);
    assert.equal(adaList.json.items.some((item) => item.text === "Bob synthetic note"), false);
    assert.equal(plusList.json.items.some((item) => item.text === "Plus address stays separate"), true);
    assert.equal(plusList.json.items.some((item) => item.text === "Bob synthetic note"), false);
    assert.equal(adaList.json.items.some((item) => item.text.includes("<script")), false);
  } finally {
    await mf.dispose();
  }
});
