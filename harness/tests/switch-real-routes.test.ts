import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

// switchGate, then the real aiRoutes. GET /sources/:id and POST /personal/items/:id/contribute
// are stand-ins on the same paths production registers. Those handlers are closures inside
// v1Routes, after authenticate, and are not exported. v1Routes would answer 401 until a tenant
// session exists, and that session's switches come from TenantPolicy, not from this test.
const env = { AI_ENABLED: "false" };

type Switches = { mcp: boolean; connector: boolean; ai: boolean; contribute: boolean };

async function gatedApp(switches: Switches) {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const aiUrl = new URL("../../src/worker/ai/routes.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const { aiRoutes } = (await import(aiUrl)) as {
    aiRoutes: (deps: Record<string, never>) => { fetch: (r: Request, ...rest: unknown[]) => Promise<Response> };
  };
  const v1 = new Hono<{
    Variables: { session: { switches: Switches; internal: null } };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", { switches, internal: null });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.route("/", aiRoutes({}) as never);
  v1.get("/sources/:id", (c) => c.json({ id: c.req.param("id"), standIn: true }));
  v1.post("/personal/items/:id/contribute", (c) => c.json({ id: c.req.param("id"), standIn: true }));
  const app = new Hono();
  app.route("/v1", v1);
  return app;
}

const off = { mcp: true, connector: false, ai: false, contribute: false };
const on = { mcp: true, connector: true, ai: true, contribute: true };

async function ask(app: Awaited<ReturnType<typeof gatedApp>>, method: string, path: string) {
  return app.request(`http://127.0.0.1${path}`, { method }, env);
}

test("switchGate plus real aiRoutes: unmatched paths 404, switched paths 503, stand-ins answer when on", async () => {
  const closed = await gatedApp(off);
  const open = await gatedApp(on);

  for (const app of [closed, open]) {
    const missed = await ask(app, "GET", "/v1//sources/s1");
    assert.equal(missed.status, 404);
  }

  const doubledOff = await ask(closed, "GET", "/v1/sources/s1//x");
  assert.equal(doubledOff.status, 503);
  assert.deepEqual(await doubledOff.json(), { error: "switched_off", switch: "connector" });
  const doubledOn = await ask(open, "GET", "/v1/sources/s1//x");
  assert.equal(doubledOn.status, 404);

  const sourceOff = await ask(closed, "GET", "/v1/sources/s1");
  assert.equal(sourceOff.status, 503);
  assert.deepEqual(await sourceOff.json(), { error: "switched_off", switch: "connector" });
  const sourceOn = await ask(open, "GET", "/v1/sources/s1");
  assert.equal(sourceOn.status, 200);
  assert.deepEqual(await sourceOn.json(), { id: "s1", standIn: true });

  const aiOff = await ask(closed, "GET", "/v1/ai/status");
  assert.equal(aiOff.status, 503);
  assert.deepEqual(await aiOff.json(), { error: "switched_off", switch: "ai" });
  const contributeOff = await ask(closed, "POST", "/v1/personal/items/pi:abcd1234/contribute");
  assert.equal(contributeOff.status, 503);
  assert.deepEqual(await contributeOff.json(), { error: "switched_off", switch: "contribute" });
});

const slashRows = [
  { method: "POST", path: "/v1/genui/plan", name: "ai" },
  { method: "POST", path: "/v1/personal/items/pi:abcd1234/contribute", name: "contribute" },
  { method: "GET", path: "/v1/connectors/acme", name: "connector" },
] as const;

for (const row of slashRows) {
  for (let n = 1; n <= 10; n++) {
    const path = `${row.path}${"/".repeat(n)}`;
    test(`${n} trailing slash(es) stay gated: ${row.method} ${path}`, async () => {
      const app = await gatedApp(off);
      const res = await ask(app, row.method, path);
      assert.equal(res.status, 503, path);
      const body = (await res.json()) as { error: string; switch: string };
      assert.equal(body.error, "switched_off");
      assert.equal(body.switch, row.name);
    });
  }
}

test("HEAD on the real ai status route follows the ai switch", async () => {
  const closed = await gatedApp(off);
  const open = await gatedApp(on);
  const headOff = await ask(closed, "HEAD", "/v1/ai/status");
  assert.equal(headOff.status, 503);
  assert.equal(await headOff.text(), "");
  const getOn = await ask(open, "GET", "/v1/ai/status");
  const headOn = await ask(open, "HEAD", "/v1/ai/status");
  assert.equal(getOn.status, 200);
  assert.equal(headOn.status, getOn.status);
  assert.equal(await headOn.text(), "");
});
