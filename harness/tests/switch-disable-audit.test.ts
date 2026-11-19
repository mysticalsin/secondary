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

async function postSwitch(
  audit: { fetch: (input: unknown, init?: { body?: string }) => Promise<Response> },
  lines: string[],
): Promise<Response> {
  const specifier = new URL("../../recovered-source/worker/src/ops-admin.ts", import.meta.url).href;
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
    { method: "POST", body: JSON.stringify({ switch: "mcp", enabled: false }) },
    { AUDIT: audit, TENANT_POLICY: policyNamespace({ status: "applied" }), ENVIRONMENT: "dev" },
  );
}

test("switch disable: a refused receipt stays applied and logs a warning with no address", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const res = await postSwitch(
      { fetch: async () => new Response(null, { status: 500 }) },
      lines,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string; enabled?: boolean };
    assert.equal(body.status, "applied");
    assert.equal(body.enabled, false);
    const warning = lines.find((line) => line.includes("switch_disable"));
    assert.equal(typeof warning, "string");
    assert.equal(warning?.includes('"audit":"refused"'), true);
    assert.equal(warning?.includes('"switch":"applied"'), true);
    assert.equal(warning?.includes("@"), false);
    assert.equal(warning?.includes("platform_admin@"), false);
  } finally {
    console.warn = original;
  }
});

test("switch disable: a hung audit receipt does not hold the response", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const pending = postSwitch(
      { fetch: () => new Promise<Response>(() => undefined) },
      lines,
    );
    const winner = await Promise.race([
      pending.then((res) => res),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_500)),
    ]);
    assert.equal(typeof winner === "string", false);
    if (typeof winner !== "string") {
      assert.equal(winner.status, 200);
    }
    const warning = lines.find((line) => line.includes("switch_disable"));
    assert.equal(typeof warning, "string");
    assert.equal(warning?.includes('"audit":"timed_out"'), true);
    assert.equal(warning?.includes("@"), false);
  } finally {
    console.warn = original;
  }
});
