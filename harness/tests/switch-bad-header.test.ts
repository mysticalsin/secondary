import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("a malformed /v1 path is 400 and still no-store", async () => {
  const securityUrl = new URL("../../recovered-source/worker/src/security.ts", import.meta.url).href;
  const opsUrl = new URL("../../recovered-source/worker/src/ops-admin.ts", import.meta.url).href;
  const { securityHeaders } = (await import(securityUrl)) as {
    securityHeaders: (c: never, next: () => Promise<void>) => Promise<void>;
  };
  const { switchGate } = (await import(opsUrl)) as {
    switchGate: (c: never, next: () => Promise<void>) => Promise<Response | void>;
  };
  const v1 = new Hono<{
    Variables: { session: { switches: Record<string, boolean>; internal: null } };
  }>();
  v1.use("*", async (c, next) => {
    c.set("session", {
      switches: { mcp: true, connector: true, ai: true, contribute: true },
      internal: null,
    });
    await next();
  });
  v1.use("*", switchGate as never);
  v1.all("*", (c) => c.json({ reached: true }));
  const app = new Hono();
  app.use("*", securityHeaders as never);
  app.route("/v1", v1);

  const res = await app.request("http://127.0.0.1/v1/%ZZ");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_request" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});
