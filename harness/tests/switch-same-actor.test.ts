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

function policyNamespace(result: { status: string; sameActor?: boolean }) {
  const ns = {
    jurisdiction() {
      return ns;
    },
    idFromName() {
      return "id";
    },
    get() {
      return { setSwitch: async () => result };
    },
  };
  return ns;
}

async function postEnable(result: { status: string; sameActor?: boolean }): Promise<Response> {
  const specifier = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const mod = (await import(specifier)) as { opsAdminRoutes: (deps: { now: () => number }) => Hono };
  const app = new Hono<{ Variables: { session: unknown } }>();
  const principal = persona("platform_admin");
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
  return app.request(
    "/switches",
    { method: "POST", body: JSON.stringify({ switch: "mcp", enabled: true }) },
    {
      ENVIRONMENT: "prod",
      TENANT_POLICY: policyNamespace(result),
      AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
    },
  );
}

test("switch route: a same-person prod re-enable is 409 and a different person stays pending", async () => {
  const same = await postEnable({ status: "pending", sameActor: true });
  assert.equal(same.status, 409);
  assert.equal(((await same.json()) as { error?: string }).error, "switch_refused");
  const other = await postEnable({ status: "pending", sameActor: false });
  assert.equal(other.status, 202);
  const body = (await other.json()) as { status?: string; needs?: string };
  assert.equal(body.status, "pending");
  assert.equal(body.needs, "second_person");
});
