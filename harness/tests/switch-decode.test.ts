import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("an encoded source path is blocked when the connector switch is off", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    dependencies: { hono: string };
  };
  assert.equal(pkg.dependencies.hono, "4.13.17");
  const ops = new URL("../../recovered-source/worker/src/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const v1 = new Hono<{
    Variables: {
      session: { switches: Record<string, boolean>; internal: null };
    };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", {
      switches: { mcp: true, connector: false, ai: true, contribute: true },
      internal: null,
    });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.get("/sources/:id", (c) => c.json({ reached: true, id: c.req.param("id") }));
  const app = new Hono();
  app.route("/v1", v1);

  const plain = await app.request("http://127.0.0.1/v1/sources/s1");
  assert.equal(plain.status, 503);

  const encoded = await app.request("http://127.0.0.1/v1/%73ources/s1");
  const body = (await encoded.json()) as unknown;
  assert.equal(encoded.status, 503);
  assert.deepEqual(body, { error: "switched_off", switch: "connector" });

  const dotted = await app.request("http://127.0.0.1/v1/map/%2e%2e/sources/s1");
  assert.equal(dotted.status, 503);
  assert.deepEqual(await dotted.json(), { error: "switched_off", switch: "connector" });
});

test("a malformed percent-encoding does not pass the switch gate", async () => {
  const ops = new URL("../../recovered-source/worker/src/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const v1 = new Hono<{
    Variables: {
      session: { switches: Record<string, boolean>; internal: null };
    };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", {
      switches: { mcp: true, connector: false, ai: true, contribute: true },
      internal: null,
    });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.get("/sources/:id", (c) => c.json({ reached: true, id: c.req.param("id") }));
  v1.all("*", (c) => c.json({ reached: true, path: c.req.path }));
  const app = new Hono();
  app.route("/v1", v1);

  for (const path of ["/v1/%ZZ", "/v1/%", "/v1/%73ources/%ZZ", "/v1/%C0%80"]) {
    const res = await app.request(`http://127.0.0.1${path}`);
    assert.equal(res.status, 400, path);
    assert.deepEqual(await res.json(), { error: "bad_request" });
  }

  const open = await app.request("http://127.0.0.1/v1/%6dap");
  assert.equal(open.status, 200);
  assert.deepEqual(await open.json(), { reached: true, path: "/v1/map" });
});
