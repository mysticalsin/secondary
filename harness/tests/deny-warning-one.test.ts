import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const SHAPE = { at: "audit_unavailable", decision: "deny" };

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  return { lines, restore: () => (console.warn = original) };
}

function warning(lines: string[]): { at: string; action: string; decision: string } {
  const line = lines.find((entry) => entry.includes('"at":"audit_unavailable"'));
  assert.equal(typeof line, "string");
  const body = JSON.parse(line ?? "{}") as { at: string; action: string; decision: string };
  assert.deepEqual(
    { at: body.at, decision: body.decision },
    SHAPE,
  );
  assert.equal(typeof body.action, "string");
  assert.equal(body.action.includes("@"), false);
  assert.equal(line?.includes("@"), false);
  return body;
}

function namespace() {
  const ns = {
    jurisdiction() {
      return ns;
    },
    idFromName() {
      return "id";
    },
    get() {
      return {
        session: async () => ({
          limited: false,
          retryAfter: 0,
          principal: sessionPrincipal(),
          ndaGrants: [],
          openBrains: [],
          elevatedUntil: null,
          epoch: 1,
          config: { tenantId: who.tenantId, seed: 1, personalOwners: [] },
          switches: { mcp: true, connector: true, ai: true, contribute: true },
          active: true,
          rolesVersion: 901,
        }),
        gov: async (method: string) =>
          method === "listRoles" ? { roles: Object.values(ROLES), version: 901 } : { roles: [], version: 0 },
        setSwitch: async () => ({ status: "applied" }),
      };
    },
  };
  return ns;
}

const who = persona("consultant");
const sessionPrincipal = () => ({
  id: who.id,
  email: who.email,
  roleIds: who.roleIds,
  memberships: who.memberships,
});

test("deny warning: one shape, 403, and one function for every deny site", async () => {
  const seen = capture();
  try {
    const adminSpec = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
    const admin = (await import(adminSpec)) as { adminRoutes: (deps: object) => Hono };
    const adminApp = new Hono<{ Variables: { session: unknown } }>();
    adminApp.use("*", async (c, next) => {
      c.set("session", {
        principal: who,
        ctx: { now: NOW },
        persona: null,
        tenantId: who.tenantId,
        config: null,
        epoch: 1,
        internal: null,
        switches: { mcp: true, connector: true, ai: true, contribute: true },
        org: buildOrg(),
      });
      await next();
    });
    adminApp.route("/", admin.adminRoutes({}));
    const gov = await adminApp.request(
      "/roles",
      { method: "POST", body: JSON.stringify({ id: "x" }) },
      { AUDIT: undefined, TENANT_POLICY: namespace() },
    );
    assert.equal(gov.status, 403);
    const govWarn = warning(seen.lines);
    assert.equal(govWarn.action, "gov.role_upsert.propose");

    seen.lines.length = 0;
    const routesSpec = new URL("../../src/worker/routes.ts", import.meta.url).href;
    const routes = (await import(routesSpec)) as {
      v1Routes: (deps: { now: () => number }) => { request: Function };
    };
    const v1 = routes.v1Routes({ now: () => NOW });
    const env = {
      ENVIRONMENT: "dev",
      WIKI_SEED: "off",
      DEV_AUTH_BYPASS_EMAIL: who.email,
      DEFAULT_TENANT_ID: who.tenantId,
      TENANT_POLICY: namespace(),
      AUDIT: { fetch: async () => new Response(null, { status: 500 }) },
    };
    const denied = await v1.request(
      "http://127.0.0.1/actions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: "core", action: "configure" }),
      },
      env,
    );
    assert.equal(denied.status, 403);
    const actionWarn = warning(seen.lines);
    assert.equal(actionWarn.action, "configure");

    seen.lines.length = 0;
    const closed = await v1.request(
      "http://127.0.0.1/actions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeId: "c_delivery",
          action: "comment",
          payload: { text: "Synthetic note" },
        }),
      },
      env,
    );
    assert.equal(closed.status, 503);
    assert.equal(seen.lines.some((line) => line.includes('"decision":"deny"')), false);

    seen.lines.length = 0;
    const opsSpec = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
    const ops = (await import(opsSpec)) as {
      opsAdminRoutes: (deps: { now: () => number }) => Hono;
    };
    const opsApp = new Hono<{ Variables: { session: unknown } }>();
    const adminWho = persona("platform_admin");
    opsApp.use("*", async (c, next) => {
      c.set("session", {
        principal: adminWho,
        ctx: { now: NOW },
        persona: null,
        tenantId: adminWho.tenantId,
        config: null,
        epoch: 1,
        internal: null,
        switches: { mcp: true, connector: true, ai: true, contribute: true },
        org: buildOrg(),
      });
      await next();
    });
    opsApp.route("/", ops.opsAdminRoutes({ now: () => NOW }));
    const off = await opsApp.request(
      "/switches",
      { method: "POST", body: JSON.stringify({ switch: "mcp", enabled: false }) },
      {
        AUDIT: { fetch: async () => new Response(null, { status: 500 }) },
        TENANT_POLICY: namespace(),
        ENVIRONMENT: "dev",
      },
    );
    assert.equal(off.status, 200);
    const offLine = seen.lines.find((line) => line.includes("switch_disable"));
    assert.equal(typeof offLine, "string");
    const offBody = JSON.parse(offLine ?? "{}") as { at?: string; audit?: string; switch?: string };
    assert.equal(offBody.at, "switch_disable");
    assert.equal(offBody.audit, "refused");
    assert.equal(offBody.switch, "applied");
    assert.equal(offLine?.includes("@"), false);
    assert.equal(offLine?.includes('"decision":"deny"'), false);

    const root = new URL("../../src/worker/", import.meta.url);
    const copies = ["admin/routes.ts", "routes.ts", "uxv2/questions.ts", "ux/util.ts"].filter((file) =>
      readFileSync(new URL(file, root), "utf8").includes('at: "audit_unavailable"'),
    );
    assert.deepEqual(copies, ["ux/util.ts"]);
  } finally {
    seen.restore();
  }
});
