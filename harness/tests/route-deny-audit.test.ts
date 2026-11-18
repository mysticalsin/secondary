import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { persona } from "../../packages/policy/src/personas.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

test("route deny: a failed receipt logs a warning with no address", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const specifier = new URL("../../recovered-source/worker/src/routes.ts", import.meta.url).href;
    const { v1Routes } = (await import(specifier)) as {
      v1Routes: (deps: { now: () => number }) => { request: Function };
    };
    const who = persona("consultant");
    const namespace = {
      jurisdiction() {
        return namespace;
      },
      idFromName() {
        return "id";
      },
      get() {
        return {
          session: async () => ({
            limited: false,
            retryAfter: 0,
            principal: {
              id: who.id,
              email: who.email,
              roleIds: who.roleIds,
              memberships: who.memberships,
            },
            ndaGrants: [],
            openBrains: [],
            elevatedUntil: null,
            epoch: 1,
            config: { tenantId: who.tenantId, seed: 1, personalOwners: [] },
            switches: { mcp: true, connector: true, ai: true, contribute: true },
            active: true,
            rolesVersion: 0,
          }),
          gov: async () => ({ roles: [], version: 0 }),
        };
      },
    };
    const app = v1Routes({ now: () => NOW });
    const res = await app.request(
      "http://127.0.0.1/actions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: "core", action: "configure" }),
      },
      {
        ENVIRONMENT: "dev",
        WIKI_SEED: "off",
        DEV_AUTH_BYPASS_EMAIL: who.email,
        DEFAULT_TENANT_ID: who.tenantId,
        TENANT_POLICY: namespace,
        AUDIT: { fetch: async () => new Response(null, { status: 500 }) },
      },
    );
    assert.equal(res.status, 403);
    const warning = lines.find((line) => line.includes("audit_unavailable"));
    assert.equal(typeof warning, "string");
    assert.equal(warning?.includes("@"), false);
    assert.equal(warning?.includes(who.email), false);
  } finally {
    console.warn = original;
  }
});
