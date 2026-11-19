import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const env = { AI_ENABLED: "false" };

type Switches = { mcp: boolean; connector: boolean; ai: boolean; contribute: boolean };

async function realV1(switches: Switches) {
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
  v1.get("/sources/:id", (c) => c.json({ id: c.req.param("id") }));
  v1.post("/personal/items/:id/contribute", (c) => c.json({ id: c.req.param("id") }));
  const app = new Hono();
  app.route("/v1", v1);
  return app;
}

const off = { mcp: true, connector: false, ai: false, contribute: false };
const on = { mcp: true, connector: true, ai: true, contribute: true };

async function ask(app: Awaited<ReturnType<typeof realV1>>, method: string, path: string) {
  return app.request(`http://127.0.0.1${path}`, { method }, env);
}

test("the real /v1 router 404s paths it does not own, and the gate still refuses a switched path", async () => {
  const closed = await realV1(off);
  const open = await realV1(on);

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
  assert.deepEqual(await sourceOn.json(), { id: "s1" });

  const aiOff = await ask(closed, "GET", "/v1/ai/status");
  assert.equal(aiOff.status, 503);
  assert.deepEqual(await aiOff.json(), { error: "switched_off", switch: "ai" });
  const contributeOff = await ask(closed, "POST", "/v1/personal/items/pi:abcd1234/contribute");
  assert.equal(contributeOff.status, 503);
  assert.deepEqual(await contributeOff.json(), { error: "switched_off", switch: "contribute" });
});

for (const path of [
  "/v1/genui/plan////",
  "/v1/personal/items/pi:abcd1234/contribute/////",
]) {
  test(`four or more trailing slashes stay gated: ${path}`, async () => {
    const app = await realV1(off);
    const method = path.includes("contribute") ? "POST" : "POST";
    const res = await ask(app, method, path);
    assert.equal(res.status, 503, path);
    const body = (await res.json()) as { error: string; switch: string };
    assert.equal(body.error, "switched_off");
    assert.equal(body.switch, path.includes("contribute") ? "contribute" : "ai");
  });
}

test("HEAD on the real ai status route follows the ai switch", async () => {
  const closed = await realV1(off);
  const open = await realV1(on);
  const headOff = await ask(closed, "HEAD", "/v1/ai/status");
  assert.equal(headOff.status, 503);
  assert.equal(await headOff.text(), "");
  const getOn = await ask(open, "GET", "/v1/ai/status");
  const headOn = await ask(open, "HEAD", "/v1/ai/status");
  assert.equal(getOn.status, 200);
  assert.equal(headOn.status, getOn.status);
  assert.equal(await headOn.text(), "");
});
