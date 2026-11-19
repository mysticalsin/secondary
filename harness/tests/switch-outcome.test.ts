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

test("switch disable: a refused switch is not logged as an allow", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const specifier = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
    const mod = (await import(specifier)) as {
      opsAdminRoutes: (deps: { now: () => number }) => Hono;
    };
    const app = new Hono<{ Variables: { session: unknown } }>();
    const principal = persona("platform_admin");
    const namespace = {
      jurisdiction() {
        return namespace;
      },
      idFromName() {
        return "id";
      },
      get() {
        return { setSwitch: async () => ({ status: "refused" }) };
      },
    };
    app.use("*", async (c, next) => {
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
    app.route("/", mod.opsAdminRoutes({ now: () => NOW }));
    const res = await app.request(
      "/switches",
      { method: "POST", body: JSON.stringify({ switch: "mcp", enabled: false }) },
      {
        AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
        TENANT_POLICY: namespace,
        ENVIRONMENT: "dev",
      },
    );
    assert.equal(res.status, 409);
    const warning = lines.find((line) => line.includes("switch_disable"));
    assert.equal(typeof warning, "string");
    assert.equal(warning?.includes('"switch":"refused"'), true);
    assert.equal(warning?.includes('"audit":"succeeded"'), true);
    assert.equal(warning?.includes('"decision":"allow"'), false);
    assert.equal(warning?.includes("@"), false);
  } finally {
    console.warn = original;
  }
});
