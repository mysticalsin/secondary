import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

type GateApp = {
  request: (input: string, init?: { method: string }) => Promise<Response>;
};

async function gate(off: "ai" | "connector" | "contribute"): Promise<GateApp> {
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
