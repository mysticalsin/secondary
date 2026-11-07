/**
 * Recovered audit, connector, ops, pages, and MCP gates.
 * Bindings are local stubs. They are not Cloudflare resources.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReceipt } from "../../recovered-source/shared/packages/contracts/src/audit-receipt.ts";
import { hostOf } from "../../reconstruction/packages/contracts/src/agent-host.ts";
import { GraphClient } from "../../reconstruction/connector/worker/src/graph.ts";
import {
  allowedRedirects,
  isRedirectAllowed,
  publicBase,
} from "../../reconstruction/mcp/worker/src/config.ts";
import { restoreBackup } from "../../reconstruction/ops/worker/src/backup.ts";
import { signInternalRequest } from "../../reconstruction/connector/worker/src/internal-auth.ts";

const KEY = "synthetic-audit-key-32chars-minimum!";
const HMAC = "synthetic-connector-hmac-key-32b!!";

function receiptBody(source: "api" | "mcp") {
  return JSON.stringify({
    receiptId: "rcpt_12345678-1234-1234-1234-123456789abc",
    at: "2026-11-07T00:00:00.000Z",
    tenantId: "tenant_reconstruction",
    principalId: "u_consultant",
    action: "view_content",
    decision: "allow",
    reason: "Granted",
    source,
    body: "must-not-be-stored",
  });
}

test("audit refuses public traffic and a missing or wrong key", async () => {
  const { default: app } = await import("../../reconstruction/audit/worker/src/index.ts");
  const env = { AUDIT_LOG: { put() { throw new Error("must not write"); } } };
  const open = await app.request("http://audit.invalid/append", { method: "POST", body: "{}" }, env);
  assert.equal(open.status, 401);
  const pub = await app.request(
    "http://audit.invalid/append",
    { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.5", "X-Audit-Key": KEY }, body: "{}" },
    { ...env, AUDIT_KEY_API: KEY },
  );
  assert.equal(pub.status, 403);
  const read = await app.request(
    "http://audit.invalid/append",
    { method: "POST", headers: { "X-Audit-Key": KEY }, body: receiptBody("api") },
    { AUDIT_KEY_READ: KEY, AUDIT_LOG: env.AUDIT_LOG },
  );
  assert.equal(read.status, 403);
});

test("an audit append stamps the key's source and drops extra fields", async () => {
  const { default: app } = await import("../../reconstruction/audit/worker/src/index.ts");
  const puts: { key: string; body: string }[] = [];
  const env = {
    AUDIT_KEY_MCP: KEY,
    AUDIT_LOG: {
      async put(key: string, body: string) {
        puts.push({ key, body });
        return { key };
      },
    },
  };
  const res = await app.request(
    "http://audit.invalid/append",
    { method: "POST", headers: { "X-Audit-Key": KEY }, body: receiptBody("api") },
    env,
  );
  assert.equal(res.status, 202);
  assert.equal(puts.length, 1);
  const stored = JSON.parse(puts[0].body);
  assert.equal(stored.source, "mcp");
  assert.equal(stored.body, undefined);
  assert.equal(JSON.stringify(stored).includes("must-not-be-stored"), false);
  assert.ok(parseReceipt(stored, "mcp"));
});

test("connector internal routes fail closed without a key, and Graph refuses a user path", async () => {
  const { createApp } = await import("../../reconstruction/connector/worker/src/index.ts");
  const { graphFromEnv } = await import("../../reconstruction/connector/worker/src/graph.ts");
  const app = createApp();
  const closed = await app.request("http://connector.invalid/internal/acl/check", { method: "POST", body: "{}" }, {
    ENVIRONMENT: "reconstruction",
  });
  assert.equal(closed.status, 401);
  const health = await app.request("http://connector.invalid/health", { method: "GET" }, {
    ENVIRONMENT: "reconstruction",
    CALENDAR_ENABLED: "false",
  });
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.graphConfigured, false);
  assert.equal(body.calendarEnabled, false);
  assert.equal(graphFromEnv({}), null);

  let fetched = false;
  const graph = new GraphClient({
    tenantId: "example.invalid",
    clientId: "synthetic-client",
    clientSecret: "synthetic-not-a-secret",
    fetch: async () => {
      fetched = true;
      return new Response("no");
    },
  });
  await assert.rejects(() => graph.getJson("/users/me"), /graph_path_not_allowed/);
  assert.equal(fetched, false);
});

test("a signed connector call from an unknown client is unauthorized", async () => {
  const { createApp } = await import("../../reconstruction/connector/worker/src/index.ts");
  const app = createApp();
  const url = "http://connector.invalid/internal/acl/check";
  const body = JSON.stringify({ tenantId: "tenant_reconstruction", itemIds: [] });
  const headers = await signInternalRequest({
    secret: HMAC,
    method: "POST",
    url,
    body,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: "u_other",
      email: "other@example.invalid",
      client_id: "not-a-caller",
      scope: [],
      tool: "acl.check",
    },
  });
  const res = await app.request(
    url,
    { method: "POST", headers: { ...headers, "content-type": "application/json" }, body },
    {
      ENVIRONMENT: "reconstruction",
      CONNECTOR_HMAC_KEY: HMAC,
      CONNECTOR_STATE: {
        jurisdiction() {
          return this;
        },
        idFromName() {
          return "id";
        },
        get() {
          return { nonceFirst: async () => true };
        },
      },
    },
  );
  assert.equal(res.status, 401);
});

test("the recovered MCP validator is rejected by ESM, with no require() injected", async () => {
  await assert.rejects(
    () => import("../../recovered-other/secondary-mcp-dev/worker/src/generated/view-plan-validator.js"),
    /require is not defined/,
  );
});

test("MCP config fails closed on the public URL and foreign redirects", async () => {
  const env = { ENVIRONMENT: "reconstruction", DEFAULT_TENANT_ID: "tenant_reconstruction", INTERNAL_HMAC_KEY: HMAC };
  assert.equal(publicBase(env, new Request("http://mcp.invalid/mcp")), null);
  const rules = allowedRedirects({
    ...env,
    ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback,http://evil.invalid/callback",
  });
  assert.equal(rules.length, 1);
  assert.equal(isRedirectAllowed("https://claude.ai/api/mcp/auth_callback", rules), true);
  assert.equal(isRedirectAllowed("https://evil.invalid/steal", rules), false);
  assert.equal(isRedirectAllowed("http://127.0.0.1:9/callback", rules), false);
  assert.equal(hostOf(["https://claude.ai/callback"], ""), "claude_ai");
});

test("ops restore stays disabled and admin routes are absent without a key", async () => {
  const result = await restoreBackup(
    {
      BACKUPS: { get() { throw new Error("must not read"); } },
      API: { fetch() { throw new Error("must not call"); } },
      ENVIRONMENT: "reconstruction",
      OPS_HMAC_KEY: HMAC,
      BACKUP_KEY: HMAC,
      RESTORE_ENABLED: "no",
    },
    "2026-11-07/tenant_reconstruction/tenant.jsonl.enc",
    true,
    "synthetic",
  );
  assert.deepEqual(result, { ok: false, error: "restore_disabled" });
  const { createOpsApp } = await import("../../reconstruction/ops/worker/src/index.ts");
  const app = createOpsApp();
  const res = await app.request("http://ops.invalid/restore", { method: "POST", body: "{}" }, {
    ENVIRONMENT: "reconstruction",
  });
  assert.equal(res.status, 404);
});

test("pages hide a missing page and drop an event that has no consent", async () => {
  const { default: pages } = await import("../../reconstruction/pages/worker/src/index.ts");
  let counted = false;
  const env = {
    PAGES: {
      async get() {
        return null;
      },
      async head() {
        return { customMetadata: { expiresAt: String(Date.now() + 60_000) } };
      },
    },
    COUNTER: {
      jurisdiction() {
        return this;
      },
      idFromName() {
        return "id";
      },
      get() {
        counted = true;
        throw new Error("counter must not be called");
      },
    },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const missing = await pages.fetch(
    new Request("http://pages.invalid/p/0123456789abcdef0123456789abcdef"),
    env,
    ctx,
  );
  assert.equal(missing.status, 404);
  const silent = await pages.fetch(
    new Request("http://pages.invalid/p/0123456789abcdef0123456789abcdef/e", {
      method: "POST",
      body: JSON.stringify({ k: "view", c: false }),
    }),
    env,
    ctx,
  );
  assert.equal(silent.status, 204);
  const foreign = await pages.fetch(
    new Request("http://pages.invalid/p/0123456789abcdef0123456789abcdef/e", {
      method: "POST",
      headers: { Origin: "http://evil.invalid" },
      body: JSON.stringify({ k: "view", c: true }),
    }),
    env,
    ctx,
  );
  assert.equal(foreign.status, 403);
  assert.equal(counted, false);
});
