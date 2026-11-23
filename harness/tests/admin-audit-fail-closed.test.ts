/**
 * A refused audit append must not return 2xx from the admin audit read.
 * The route writes a receipt for the read and fails closed when that append is refused.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const RECEIPT_ID = "rcpt_12345678-1234-1234-1234-123456789abc";

function auditFetch(appendStatus: number) {
  return async (input: unknown, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "POST" || String(input).includes("/append"))
      return new Response(null, { status: appendStatus });
    return new Response(
      JSON.stringify({
        receipts: [
          {
            receiptId: RECEIPT_ID,
            at: "2023-11-14T12:00:00.000Z",
            tenantId: "tenant_mantu_synthetic",
            principalId: "u_platform_admin",
            action: "gov.audit.read",
            decision: "allow",
            reason: "synthetic",
            nodeId: null,
            scopeId: null,
            revision: null,
            scopeIds: [],
            resultCount: null,
            oauthScopes: [],
            redirectHost: null,
            source: "api",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function getAudit(appendStatus: number): Promise<{ status: number; text: string }> {
  const specifier = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
  const mod = (await import(specifier)) as { adminRoutes: (deps: object) => Hono };
  const principal = persona("platform_admin");
  const namespace = {
    jurisdiction() {
      return namespace;
    },
    idFromName() {
      return "id";
    },
    get() {
      return { gov: async () => null };
    },
  };
  const api = new Hono<{ Variables: { session: unknown } }>();
  api.use("*", async (c, next) => {
    c.set("session", {
      principal,
      ctx: { now: NOW },
      persona: null,
      tenantId: principal.tenantId,
      config: null,
      epoch: 1,
      internal: null,
      switches: { mcp: true, connector: true, ai: true, contribute: true },
      org: buildOrg(),
    });
    await next();
  });
  api.route("/", mod.adminRoutes({}));
  const res = await api.request("/audit", { method: "GET" }, {
    AUDIT: { fetch: auditFetch(appendStatus) },
    TENANT_POLICY: namespace,
  });
  return { status: res.status, text: await res.text() };
}

test("GET /v1/admin/audit is 503 when the audit append is refused", async () => {
  const out = await getAudit(500);
  assert.equal(out.status, 503, `GET /audit with a refused append returns ${out.status}`);
  const body = JSON.parse(out.text) as { error?: string };
  assert.equal(body.error, "audit_unavailable");
  assert.equal(out.text.includes(RECEIPT_ID), false);
});

test("GET /v1/admin/audit returns the log when the append is accepted", async () => {
  const out = await getAudit(202);
  assert.equal(out.status, 200);
  assert.equal(out.text.includes(RECEIPT_ID), true);
});
