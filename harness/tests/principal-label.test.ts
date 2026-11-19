import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { persona } from "../../packages/policy/src/personas.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

test("profile: a kelvin address is labeled so it is not the ASCII twin", async () => {
  const specifier = new URL("../../recovered-source/worker/src/routes.ts", import.meta.url).href;
  const { v1Routes } = (await import(specifier)) as {
    v1Routes: (deps: { now: () => number }) => { request: Function };
  };
  const who = persona("consultant");
  const kelvin = "\u212A@ascii.example";
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
            email: kelvin,
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
    "http://127.0.0.1/me",
    { method: "GET" },
    {
      ENVIRONMENT: "dev",
      WIKI_SEED: "off",
      DEV_AUTH_BYPASS_EMAIL: kelvin,
      DEFAULT_TENANT_ID: who.tenantId,
      TENANT_POLICY: namespace,
    },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { principal?: { email?: string; emailLabel?: string } };
  assert.equal(body.principal?.email, kelvin);
  assert.equal(body.principal?.emailLabel?.includes("\\u212a"), true);
});
