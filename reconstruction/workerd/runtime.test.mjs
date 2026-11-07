/**
 * NEW RECONSTRUCTION. Local workerd via Miniflare. No remote bindings, no upload.
 * Synthetic binding values are test harness data, not recovered secrets or identities.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { bundleWorkerd } from "./bundle-workerd.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HMAC = "synthetic-connector-hmac-key-32b!!";
const AUDIT_API = "synthetic-audit-api-key-32chars!!";
const AUDIT_MCP = "synthetic-audit-mcp-key-32chars!!";
const AUDIT_READ = "synthetic-audit-read-key-32chars!";
const OPS_KEY = "synthetic-ops-admin-key-32chars!!";
const DATE = "2026-11-07";

const sourceBody = (tenantId) =>
  JSON.stringify({
    tenantId,
    provider: "sharepoint_drive",
    driveId: "drive_local_test",
    scope: {
      kind: "circle",
      scopeId: "circle.local",
      gateNodeId: "gate.local",
      ownerRef: "owner_local",
      classification: "internal_confidential",
    },
    enabled: true,
  });

let mf;
let built;

function neutralBundles() {
  for (const script of ["build:worker", "build:workers"]) {
    const run = spawnSync("npm", ["run", script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    if (run.status !== 0) throw new Error(`${script} failed\n${run.stdout}\n${run.stderr}`);
  }
}

function textBindings(vars) {
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, { type: "text", value }]));
}

function sqliteExports(names) {
  return Object.fromEntries(names.map((name) => [name, { type: "durable-object", storage: "sqlite" }]));
}

function doBinding(workerName, exportName) {
  return { type: "durable-object", worker: workerName, exportName };
}

function worker(name, file, env, exports) {
  return {
    config: {
      name,
      compatibilityDate: DATE,
      workersDev: false,
      previewUrls: false,
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents: readFileSync(file, "utf8") } },
      },
      ...(exports ? { exports } : {}),
      ...(env ? { env } : {}),
      triggers: [{ type: "fetch", pattern: `${name}.local/*` }],
    },
  };
}

test.before(async () => {
  neutralBundles();
  built = bundleWorkerd();
  mf = new Miniflare({
    workers: [
      worker(
        "api",
        built.api,
        {
          ...textBindings({
            ENVIRONMENT: "dev",
            DO_JURISDICTION: "off",
            DEV_AUTH_BYPASS_EMAIL: "local@example.invalid",
            DEFAULT_TENANT_ID: "tenant_reconstruction",
            RATE_LIMIT_PER_MIN: "60",
          }),
          TENANT_POLICY: doBinding("api", "TenantPolicy"),
          WORKSPACE: doBinding("api", "Workspace"),
          BLOBS: { type: "r2" },
        },
        sqliteExports(["TenantPolicy", "Workspace"]),
      ),
      worker(
        "api-unbound",
        built.api,
        textBindings({
          ENVIRONMENT: "reconstruction",
          DEFAULT_TENANT_ID: "tenant_reconstruction",
          RATE_LIMIT_PER_MIN: "60",
        }),
      ),
      worker(
        "audit",
        resolve(root, "reconstruction/dist/audit.js"),
        {
          ...textBindings({
            AUDIT_KEY_API: AUDIT_API,
            AUDIT_KEY_MCP: AUDIT_MCP,
            AUDIT_KEY_READ: AUDIT_READ,
          }),
          AUDIT_LOG: { type: "r2" },
        },
      ),
      worker(
        "connector",
        resolve(root, "reconstruction/dist/connector.js"),
        {
          ...textBindings({
            ENVIRONMENT: "dev",
            DO_JURISDICTION: "off",
            CONNECTOR_HMAC_KEY: HMAC,
            CONNECTOR_ENABLED: "true",
          }),
          CONNECTOR_STATE: doBinding("connector", "ConnectorState"),
        },
        sqliteExports(["ConnectorState"]),
      ),
      worker(
        "refresh",
        built.refresh,
        {
          ...textBindings({ ENVIRONMENT: "dev", DO_JURISDICTION: "off" }),
          CONNECTOR_STATE: doBinding("refresh", "ConnectorState"),
          SOURCE_SYNC: {
            type: "workflow",
            name: "source-sync-local",
            worker: "refresh",
            exportName: "SourceSyncWorkflow",
          },
        },
        {
          ...sqliteExports(["ConnectorState"]),
          SourceSyncWorkflow: { type: "workflow", name: "source-sync-local" },
        },
      ),
      worker(
        "ops",
        resolve(root, "reconstruction/dist/ops.js"),
        {
          ...textBindings({
            ENVIRONMENT: "dev",
            OPS_ADMIN_KEY: OPS_KEY,
            RESTORE_ENABLED: "no",
          }),
          BACKUPS: { type: "r2" },
        },
      ),
      worker(
        "pages",
        resolve(root, "reconstruction/dist/pages.js"),
        {
          ...textBindings({ DO_JURISDICTION: "off", LOCAL_DEV: "yes" }),
          COUNTER: doBinding("pages", "PageCounter"),
          PAGES: { type: "r2" },
        },
        sqliteExports(["PageCounter"]),
      ),
      worker(
        "mcp",
        built.mcp,
        textBindings({
          ENVIRONMENT: "reconstruction",
          DEFAULT_TENANT_ID: "tenant_reconstruction",
          INTERNAL_HMAC_KEY: HMAC,
        }),
      ),
      worker("view", built.view),
      {
        config: {
          name: "audit-gate",
          compatibilityDate: DATE,
          workersDev: false,
          previewUrls: false,
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: `export default { async fetch(request, env) {
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  const url = new URL(request.url);
  url.hostname = "audit.internal";
  return env.AUDIT.fetch(new Request(url, { method: request.method, headers, body: request.body }));
} };`,
              },
            },
          },
          env: { AUDIT: { type: "worker", worker: "audit" } },
          triggers: [{ type: "fetch", pattern: "audit-gate.local/*" }],
        },
      },
    ],
  });
  await mf.ready;
});

test.after(async () => {
  await mf?.dispose();
});

async function bodyOf(response) {
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

function noLeak(text) {
  assert.equal(text.includes("stack"), false);
  assert.equal(/at\s+\S+\s+\(/.test(text), false);
}

test("api health is local, and an anonymous caller is unauthorized", async () => {
  const health = await bodyOf(await mf.dispatchFetch("http://api.local/v1/health"));
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.env, "dev");
  const me = await bodyOf(
    await mf.dispatchFetch("http://api.local/v1/me", {
      headers: { cookie: "__Host-secondary_session=tenant_other.forged-session-value" },
    }),
  );
  assert.equal(me.status, 401);
  assert.equal(me.json.error, "unauthorized");
  assert.equal(me.text.includes("tenant_other"), false);
  noLeak(me.text);
});

test("readiness is binding reachability and does not claim source freshness", async () => {
  const ready = await bodyOf(await mf.dispatchFetch("http://api.local/v1/ready"));
  assert.equal(ready.status === 200 || ready.status === 503, true);
  assert.equal(Object.hasOwn(ready.json, "freshness"), false);
  assert.equal(Object.hasOwn(ready.json, "sources"), false);
  assert.deepEqual(Object.keys(ready.json.checks).sort(), ["do", "r2"]);
  if (ready.json.ready === true) {
    assert.equal(ready.json.checks.do, "ok");
    assert.equal(ready.json.checks.r2, "ok");
  }
  const missing = await bodyOf(await mf.dispatchFetch("http://api-unbound.local/v1/ready"));
  assert.equal(missing.status, 500);
  assert.equal(missing.json.error, "internal_error");
  assert.equal(missing.json.ready, undefined);
  noLeak(missing.text);
});

test("recovered TenantPolicy and Workspace run in local sqlite", async () => {
  const ready = await bodyOf(await mf.dispatchFetch("http://api.local/v1/ready"));
  assert.equal(ready.json.checks.do, "ok");
  const first = await bodyOf(
    await mf.dispatchFetch("http://api.local/harness/workspace?name=tenant_reconstruction:local"),
  );
  const other = await bodyOf(
    await mf.dispatchFetch("http://api.local/harness/workspace?name=tenant_other:local"),
  );
  assert.equal(first.status, 200);
  assert.equal(other.status, 200);
  assert.equal(first.json.gap, undefined);
  assert.equal(first.json.count, 0);
  assert.equal(other.json.count, 0);
});

test("audit refuses a missing key, public traffic, and a read key used to append", async () => {
  const open = await bodyOf(
    await mf.dispatchFetch("http://audit-gate.local/append", { method: "POST", body: "{}" }),
  );
  assert.equal(open.status, 401);
  assert.equal(open.json.error, "unauthorized");
  const direct = await bodyOf(
    await mf.dispatchFetch("http://audit.local/append", {
      method: "POST",
      headers: { "X-Audit-Key": AUDIT_API },
      body: "{}",
    }),
  );
  assert.equal(direct.status, 403);
  assert.equal(direct.json.error, "forbidden");
  const read = await bodyOf(
    await mf.dispatchFetch("http://audit-gate.local/append", {
      method: "POST",
      headers: { "X-Audit-Key": AUDIT_READ, "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(read.status, 403);
  noLeak(open.text + direct.text + read.text);
  const receipt = JSON.stringify({
    receiptId: "rcpt_12345678-1234-1234-1234-123456789abc",
    at: "2026-11-07T00:00:00.000Z",
    tenantId: "tenant_reconstruction",
    principalId: "u_consultant",
    action: "view_content",
    decision: "allow",
    reason: "Granted",
    source: "mcp",
    body: "must-not-be-stored",
  });
  const stored = await bodyOf(
    await mf.dispatchFetch("http://audit-gate.local/append", {
      method: "POST",
      headers: { "X-Audit-Key": AUDIT_MCP, "content-type": "application/json" },
      body: receipt,
    }),
  );
  assert.equal(stored.status, 202);
  const bucket = await mf.getR2Bucket("AUDIT_LOG", "audit");
  const obj = await bucket.get(stored.json.key);
  const line = await obj.text();
  assert.equal(line.includes("must-not-be-stored"), false);
  assert.equal(line.includes("\"source\":\"mcp\""), true);
  assert.equal(line.includes("tenant_other"), false);
});

test("connector isolates tenants, denies unsigned calls, and does not confirm access", async () => {
  const { signInternalRequest } = await import("../connector/worker/src/internal-auth.ts");
  const health = await bodyOf(await mf.dispatchFetch("http://connector.local/health"));
  assert.equal(health.status, 200);
  assert.equal(health.json.graphConfigured, false);
  const unsigned = await bodyOf(
    await mf.dispatchFetch("http://connector.local/internal/sources?tenantId=tenant_a"),
  );
  assert.equal(unsigned.status, 401);
  const principal = {
    v: 1,
    iss: "secondary-mcp",
    aud: "secondary-api",
    sub: "u_local",
    email: "local@example.invalid",
    client_id: "secondary-api",
    scope: ["read"],
    tool: "sources.put",
  };
  const putUrl = "http://connector.local/internal/sources/src_drive";
  const body = sourceBody("tenant_a");
  const putHeaders = await signInternalRequest({
    secret: HMAC,
    method: "PUT",
    url: putUrl,
    body,
    principal,
  });
  const put = await bodyOf(
    await mf.dispatchFetch(putUrl, {
      method: "PUT",
      headers: { ...putHeaders, "content-type": "application/json" },
      body,
    }),
  );
  assert.equal(put.status, 201, put.text);
  const list = async (tenantId) => {
    const url = `http://connector.local/internal/sources?tenantId=${tenantId}`;
    const headers = await signInternalRequest({
      secret: HMAC,
      method: "GET",
      url,
      principal: { ...principal, tool: "sources.list" },
    });
    return bodyOf(await mf.dispatchFetch(url, { headers }));
  };
  const own = await list("tenant_a");
  const other = await list("tenant_b");
  assert.equal(own.status, 200, own.text);
  assert.equal(other.status, 200, other.text);
  assert.equal(own.json.sources.length, 1);
  assert.equal(own.json.sources[0].cursor.lastSyncAt, null);
  assert.equal(own.json.sources[0].cursor.lastError, null);
  assert.equal(own.text.includes("\"ready\":true"), false);
  assert.deepEqual(other.json.sources, []);
  const strangerUrl = "http://connector.local/internal/acl/check";
  const strangerBody = JSON.stringify({ tenantId: "tenant_a", itemIds: ["src:missing"] });
  const strangerHeaders = await signInternalRequest({
    secret: HMAC,
    method: "POST",
    url: strangerUrl,
    body: strangerBody,
    principal: { ...principal, client_id: "not-a-caller", tool: "acl.check" },
  });
  const stranger = await bodyOf(
    await mf.dispatchFetch(strangerUrl, {
      method: "POST",
      headers: { ...strangerHeaders, "content-type": "application/json" },
      body: strangerBody,
    }),
  );
  assert.equal(stranger.status, 401);
  const aclHeaders = await signInternalRequest({
    secret: HMAC,
    method: "POST",
    url: strangerUrl,
    body: strangerBody,
    principal: { ...principal, tool: "acl.check" },
  });
  const acl = await bodyOf(
    await mf.dispatchFetch(strangerUrl, {
      method: "POST",
      headers: { ...aclHeaders, "content-type": "application/json" },
      body: strangerBody,
    }),
  );
  assert.equal(acl.status, 200, acl.text);
  assert.equal(acl.json.results["src:missing"].allowed, false);
  noLeak(unsigned.text + stranger.text + acl.text);
});

test("a failed refresh stays an error and is not reported ready", async () => {
  const res = await bodyOf(
    await mf.dispatchFetch(
      "http://refresh.local/harness/refresh?tenantId=tenant_a&sourceId=src_drive",
    ),
  );
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.outcome.status, "error");
  assert.equal(res.json.lastError, "graph_auth_failed");
  assert.equal(res.json.lastSyncAt, null);
  assert.equal(res.json.ready, false);
  const flow = await bodyOf(
    await mf.dispatchFetch(
      "http://refresh.local/harness/workflow?tenantId=tenant_a&sourceId=src_drive",
    ),
  );
  assert.equal(flow.status, 200, flow.text);
  assert.equal(flow.json.created === true || typeof flow.json.gap === "string", true);
  if (flow.json.created === true) assert.equal(typeof flow.json.id, "string");
});

test("ops restore stays disabled and pages drop events that have no consent", async () => {
  const hidden = await bodyOf(
    await mf.dispatchFetch("http://ops.local/restore", { method: "POST", body: "{}" }),
  );
  assert.equal(hidden.status, 401);
  assert.equal(hidden.json.error, "unauthorized");
  const restore = await bodyOf(
    await mf.dispatchFetch("http://ops.local/restore", {
      method: "POST",
      headers: { "X-Ops-Key": OPS_KEY, "content-type": "application/json" },
      body: JSON.stringify({ key: "2026-11-07/tenant_reconstruction/tenant.jsonl.enc", actor: "synthetic" }),
    }),
  );
  assert.equal(restore.json.error, "restore_disabled");
  assert.equal(restore.json.ok, false);
  const slug = "0123456789abcdef0123456789abcdef";
  const missing = await bodyOf(await mf.dispatchFetch(`http://pages.local/p/${slug}`));
  assert.equal(missing.status, 404);
  const bad = await bodyOf(await mf.dispatchFetch("http://pages.local/p/not-a-slug"));
  assert.equal(bad.status, 404);
  const bucket = await mf.getR2Bucket("PAGES", "pages");
  await bucket.put(`p/${slug}.html`, "<p>local page</p>", {
    customMetadata: { expiresAt: String(Date.now() + 60_000) },
  });
  const dropped = await bodyOf(
    await mf.dispatchFetch(`http://pages.local/p/${slug}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://pages.local" },
      body: JSON.stringify({ k: "view", c: false }),
    }),
  );
  assert.equal(dropped.status, 204);
  assert.deepEqual(await mf.listDurableObjectIds("COUNTER", "pages"), []);
  const foreign = await bodyOf(
    await mf.dispatchFetch(`http://pages.local/p/${slug}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.invalid" },
      body: JSON.stringify({ k: "view", c: true }),
    }),
  );
  assert.equal(foreign.status, 403);
  const counted = await bodyOf(
    await mf.dispatchFetch(`http://pages.local/p/${slug}/e`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://pages.local" },
      body: JSON.stringify({ k: "view", c: true }),
    }),
  );
  assert.equal(counted.status, 204);
  assert.equal((await mf.listDurableObjectIds("COUNTER", "pages")).length > 0, true);
});

test("mcp without a public URL fails closed in workerd", async () => {
  const res = await bodyOf(await mf.dispatchFetch("http://mcp.local/mcp"));
  assert.equal(res.status, 500);
  assert.equal(res.text, "MCP_PUBLIC_URL is not configured");
});

test("wrangler-bundled view plan rejects data and drops an unknown component", async () => {
  const bad = await bodyOf(
    await mf.dispatchFetch("http://view.local/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Accounts",
        components: [
          { type: "Html", props: { html: "<script>" } },
          { type: "NodeCard", props: { nodeId: "a_acme", rows: ["TENANT_B_ROW_PRIVATE"] } },
        ],
      }),
    }),
  );
  assert.equal(bad.json.ok, false);
  assert.equal(bad.text.includes("TENANT_B_ROW_PRIVATE"), false);
  const kept = await bodyOf(
    await mf.dispatchFetch("http://view.local/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        title: "Accounts",
        components: [
          { type: "NotAComponent", props: {} },
          { type: "NodeCard", props: { nodeId: "a_acme" } },
        ],
      }),
    }),
  );
  assert.equal(kept.json.ok, true);
  assert.equal(kept.json.dropped.length, 1);
  assert.deepEqual(
    kept.json.plan.components.map((c) => c.type),
    ["NodeCard"],
  );
});

async function bootModule(name, filename, contents) {
  const local = new Miniflare({
    workers: [
      {
        config: {
          name,
          compatibilityDate: DATE,
          workersDev: false,
          previewUrls: false,
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: `import * as mod from "./${filename}";
export default { fetch() { return Response.json({ n: Array.isArray(mod.COMPONENT_TYPES) ? mod.COMPONENT_TYPES.length : 0, validate: typeof mod.validate === "function" }); } };`,
              },
              [filename]: { type: "esm", contents },
            },
          },
          triggers: [{ type: "fetch", pattern: `${name}.local/*` }],
        },
      },
    ],
  });
  try {
    await local.ready;
    return await bodyOf(await local.dispatchFetch(`http://${name}.local/`));
  } finally {
    await local.dispose();
  }
}

test("workerd rejects the recovered MCP validator require() without a Node mask", async () => {
  const source = readFileSync(
    resolve(root, "recovered-other/secondary-mcp-dev/worker/src/generated/view-plan-validator.js"),
    "utf8",
  );
  await assert.rejects(
    () => bootModule("raw-mcp-validator", "view-plan-validator.js", source),
    /require is not defined/,
  );
});

test("the recovered API validator loads in workerd", async () => {
  const source = readFileSync(
    resolve(root, "recovered-source/worker/src/generated/view-plan.validator.js"),
    "utf8",
  );
  const res = await bootModule("raw-api-validator", "view-plan.validator.js", source);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.validate, true);
});
