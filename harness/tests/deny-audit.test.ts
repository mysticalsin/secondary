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

test("governance deny stays 403 and logs a warning with no address when the receipt fails", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const specifier = new URL("../../src/worker/admin/routes.ts", import.meta.url).href;
    const mod = (await import(specifier)) as { adminRoutes: (deps: object) => Hono };
    const app = new Hono<{ Variables: { session: unknown } }>();
    const principal = persona("consultant");
    const namespace = {
      jurisdiction() {
        return namespace;
      },
      idFromName() {
        return "id";
      },
      get() {
        return {};
      },
    };
    app.use("*", async (c, next) => {
      c.set("session", {
        principal,
        ctx: { now: NOW },
        persona: null,
        tenantId: "tenant_mantu_synthetic",
        config: null,
        epoch: 1,
        internal: null,
        switches: { mcp: true, connector: true, ai: true, contribute: true },
        org: buildOrg(),
      });
      await next();
    });
    app.route("/", mod.adminRoutes({}));
    const res = await app.request(
      "/roles",
      { method: "POST", body: JSON.stringify({ id: "x" }) },
      { AUDIT: undefined, TENANT_POLICY: namespace },
    );
    assert.equal(res.status, 403);
    const warning = lines.find((line) => line.includes("audit_unavailable"));
    assert.equal(typeof warning, "string");
    assert.equal(warning?.includes("@"), false);
    assert.equal(warning?.includes(principal.email), false);
    assert.equal(warning?.includes("platform_admin"), false);
  } finally {
    console.warn = original;
  }
});
