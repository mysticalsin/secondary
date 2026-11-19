import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

async function gate(off: "ai" | "connector" | "contribute") {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const switches = { mcp: true, connector: true, ai: true, contribute: true, [off]: false };
  const v1 = new Hono<{
    Variables: { session: { switches: Record<string, boolean>; internal: null } };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", { switches, internal: null });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.all("*", () => new Response(JSON.stringify({ hit: "fall" }), { status: 200 }));
  const app = new Hono();
  app.route("/v1", v1);
  return app;
}

const variants: { off: "ai" | "connector" | "contribute"; method: string; paths: string[]; name: string }[] = [
  {
    name: "bare /v1/ai",
    off: "ai",
    method: "GET",
    paths: ["/v1/ai", "/v1/%61i", "/v1/AI", "/v1/%41i", "/v1/ai/"],
  },
  {
    name: "bare /v1/sources",
    off: "connector",
    method: "GET",
    paths: ["/v1/sources", "/v1/%73ources", "/v1/SOURCES", "/v1/Sources", "/v1/sources/"],
  },
  {
    name: "bare /v1/connectors",
    off: "connector",
    method: "GET",
    paths: ["/v1/connectors", "/v1/%63onnectors", "/v1/CONNECTORS", "/v1/connectors/"],
  },
  {
    name: "contribute trailing slash",
    off: "contribute",
    method: "POST",
    paths: [
      "/v1/personal/items/pi:abcd1234/contribute/",
      "/v1/personal/items/pi:abcd1234/%63ontribute/",
      "/v1/Personal/Items/pi:abcd1234/Contribute/",
    ],
  },
];

test("kill switches catch the bare prefix, the trailing slash, and their encoded and mixed-case forms", async () => {
  for (const variant of variants) {
    const app = await gate(variant.off);
    for (const path of variant.paths) {
      const res = await app.request(`http://127.0.0.1${path}`, { method: variant.method });
      const body = (await res.json()) as { error?: string; switch?: string };
      assert.equal(res.status, 503, `${variant.name} ${variant.method} ${path}`);
      assert.deepEqual(body, { error: "switched_off", switch: variant.off }, path);
    }
  }
});

test("a malformed percent-encoding stays 400", async () => {
  const app = await gate("ai");
  const res = await app.request("http://127.0.0.1/v1/%ZZ");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_request" });
});

for (const path of ["/v1/genui/plan//", "/v1/genui/plan///", "/v1/ai//"]) {
  test(`extra trailing slashes stay on the ai switch: ${path}`, async () => {
    const ai = await gate("ai");
    const res = await ai.request(`http://127.0.0.1${path}`, { method: "POST" });
    assert.equal(res.status, 503, path);
    assert.deepEqual(await res.json(), { error: "switched_off", switch: "ai" });
  });
}

test("extra trailing slashes stay on the contribute switch", async () => {
  const contribute = await gate("contribute");
  const res = await contribute.request(
    "http://127.0.0.1/v1/personal/items/pi:abcd1234/contribute//",
    { method: "POST" },
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "switched_off", switch: "contribute" });
});

test("a switched prefix does not swallow the next character", async () => {
  const open = [
    ["ai", "GET", "/v1/aix"],
    ["ai", "GET", "/v1/aiX/"],
    ["ai", "GET", "/v1/briefsx"],
    ["ai", "GET", "/v1/briefsX/"],
    ["ai", "POST", "/v1/genui/planx"],
    ["connector", "GET", "/v1/sourcesx"],
    ["connector", "GET", "/v1/sourcesX/"],
    ["connector", "GET", "/v1/connectorsx"],
    ["connector", "GET", "/v1/connectorsX/"],
    ["contribute", "POST", "/v1/personal/items/pi:abcd1234/contributex"],
  ] as const;
  for (const [off, method, path] of open) {
    const app = await gate(off);
    const res = await app.request(`http://127.0.0.1${path}`, { method });
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.deepEqual(await res.json(), { hit: "fall" });
  }
  const closed = [
    ["ai", "GET", "/v1/ai"],
    ["ai", "GET", "/v1/ai/"],
    ["ai", "GET", "/v1/ai/status"],
    ["ai", "GET", "/v1/briefs"],
    ["ai", "GET", "/v1/briefs/"],
    ["ai", "POST", "/v1/briefs/save"],
    ["ai", "POST", "/v1/genui/plan"],
    ["ai", "POST", "/v1/genui/plan/"],
    ["connector", "GET", "/v1/sources"],
    ["connector", "GET", "/v1/sources/"],
    ["connector", "GET", "/v1/sources/s1"],
    ["connector", "GET", "/v1/connectors"],
    ["connector", "GET", "/v1/connectors/acme"],
    ["contribute", "POST", "/v1/personal/items/pi:abcd1234/contribute"],
    ["contribute", "POST", "/v1/personal/items/pi:abcd1234/contribute/"],
  ] as const;
  for (const [off, method, path] of closed) {
    const app = await gate(off);
    const res = await app.request(`http://127.0.0.1${path}`, { method });
    assert.equal(res.status, 503, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: "switched_off", switch: off });
  }
});

async function rootGate(off: "ai" | "connector" | "contribute") {
  const ops = new URL("../../src/worker/ops-admin.ts", import.meta.url).href;
  const { switchGate } = (await import(ops)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const switches = { mcp: true, connector: true, ai: true, contribute: true, [off]: false };
  const app = new Hono<{
    Variables: { session: { switches: Record<string, boolean>; internal: null } };
  }>();
  app.use("*", async (c, next) => {
    c.set("session", { switches, internal: null });
    await next();
  });
  app.use("*", switchGate as never);
  app.all("*", () => new Response(JSON.stringify({ hit: "fall" }), { status: 200 }));
  return app;
}

test("paths that are not a switched route stay open", async () => {
  const connector = await rootGate("connector");
  const open = [
    "/v1x/sources/s1",
    "/v10/sources/s1",
    "/v1//sources/s1",
    "/v1/sources%2Fs1",
    "/v1/sources%2fs1",
    "/v1/%2573ources/s1",
    "/v1/sources/%2e%2e/s1",
    "/v1/a\u0130",
  ];
  for (const path of open) {
    const res = await connector.request(`http://127.0.0.1${path}`);
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), { hit: "fall" });
  }
  const collapsed = ["/v1/./sources/s1", "/v1/sources/%2e/s1"];
  for (const path of collapsed) {
    const res = await connector.request(`http://127.0.0.1${path}`);
    assert.equal(res.status, 503, path);
    assert.deepEqual(await res.json(), { error: "switched_off", switch: "connector" });
  }
  const ai = await rootGate("ai");
  const head = await ai.request("http://127.0.0.1/v1/ai", { method: "HEAD" });
  assert.equal(head.status, 503);
  assert.equal(await head.text(), "");
  const options = await ai.request("http://127.0.0.1/v1/ai", { method: "OPTIONS" });
  assert.equal(options.status, 503);
  assert.deepEqual(await options.json(), { error: "switched_off", switch: "ai" });
  const map = await connector.request("http://127.0.0.1/v1/map", { method: "HEAD" });
  assert.equal(map.status, 200);
});
