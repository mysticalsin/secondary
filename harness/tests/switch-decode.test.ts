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
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
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
  assert.equal(
    dotted.status,
    503,
    "the URL parser already collapsed this dot segment, so the raw pathname and the routed path agree",
  );
  assert.deepEqual(await dotted.json(), { error: "switched_off", switch: "connector" });
});

test("a malformed percent-encoding does not pass the switch gate", async () => {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
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

async function routedApp(connector: boolean) {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const v1 = new Hono<{
    Variables: { session: { switches: Record<string, boolean>; internal: null } };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", {
      switches: { mcp: true, connector, ai: true, contribute: true },
      internal: null,
    });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.get("/sources/:id", (c) => c.json({ hit: "sources", id: c.req.param("id") }));
  v1.all("*", (c) => c.json({ hit: "fall", path: c.req.path }));
  const app = new Hono();
  app.route("/v1", v1);
  return app;
}

test("switchGate decodes a path once, the way Hono does", async () => {
  const off = await routedApp(false);
  const encoded = await off.request("http://127.0.0.1/v1/%2573ources/s1");
  assert.equal(encoded.status, 200);
  assert.deepEqual(await encoded.json(), { hit: "fall", path: "/v1/%2573ources/s1" });

  const on = await routedApp(true);
  const literal = await on.request("http://127.0.0.1/v1/sources/%25s1");
  assert.equal(literal.status, 200);
  assert.deepEqual(await literal.json(), { hit: "sources", id: "%s1" });
  const blocked = await off.request("http://127.0.0.1/v1/sources/%25s1");
  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), { error: "switched_off", switch: "connector" });
});

test("percent-encoding follows the routed path", async () => {
  const app = await routedApp(false);
  const slash = await app.request("http://127.0.0.1/v1/sources%2Fs1");
  assert.equal(slash.status, 200);
  assert.deepEqual(await slash.json(), { hit: "fall", path: "/v1/sources%2Fs1" });

  const prefix = await app.request("http://127.0.0.1/%76%31/sources/s1");
  assert.equal(prefix.status, 503);
  assert.deepEqual(await prefix.json(), { error: "switched_off", switch: "connector" });

  const upper = await app.request("http://127.0.0.1/v1/s%6Furces/s1");
  assert.equal(upper.status, 503);
  assert.deepEqual(await upper.json(), { error: "switched_off", switch: "connector" });

  const trailed = await app.request("http://127.0.0.1/v1/%73ources/s1/");
  assert.equal(trailed.status, 503);
  assert.deepEqual(await trailed.json(), { error: "switched_off", switch: "connector" });
});

test("a dot segment Hono has already collapsed is still the connector route", async () => {
  const raw = new URL("http://127.0.0.1/v1/map/%2e%2e/sources/s1").pathname;
  assert.equal(raw, "/v1/sources/s1");
  const off = await routedApp(false);
  const blocked = await off.request("http://127.0.0.1/v1/map/%2e%2e/sources/s1");
  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), { error: "switched_off", switch: "connector" });
  const on = await routedApp(true);
  const open = await on.request("http://127.0.0.1/v1/map/%2e%2e/sources/s1");
  assert.equal(open.status, 200);
  assert.deepEqual(await open.json(), { hit: "sources", id: "s1" });
});

test("the switch gate call site keeps letter case and a trailing slash", async () => {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const v1 = new Hono<{
    Variables: { session: { switches: Record<string, boolean>; internal: null } };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", {
      switches: { mcp: true, connector: false, ai: true, contribute: false },
      internal: null,
    });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.all("*", (c) => c.json({ hit: "fall" }));
  const app = new Hono();
  app.route("/v1", v1);

  const upper = await app.request("http://127.0.0.1/v1/Sources/s1");
  assert.equal(upper.status, 200);
  assert.deepEqual(await upper.json(), { hit: "fall" });

  const slash = await app.request("http://127.0.0.1/v1/sources/s1/");
  assert.equal(slash.status, 503);
  assert.deepEqual(await slash.json(), { error: "switched_off", switch: "connector" });

  const trailed = await app.request("http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute/", {
    method: "POST",
  });
  assert.equal(trailed.status, 200);
  assert.deepEqual(await trailed.json(), { hit: "fall" });
});
