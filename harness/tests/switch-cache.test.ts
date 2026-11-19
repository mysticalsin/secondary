import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { Hono } from "hono";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("an encoded /v1 path still gets Cache-Control: no-store", async () => {
  const security = new URL("../../src/worker/security.ts", import.meta.url).href;
  const { securityHeaders } = (await import(security)) as {
    securityHeaders: (c: never, next: () => Promise<void>) => Promise<void>;
  };
  const app = new Hono();
  app.use("*", securityHeaders as never);
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.get("/internal/ping", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ ok: true }));

  const encoded = await app.request("http://127.0.0.1/%76%31/health");
  assert.equal(encoded.status, 200);
  assert.equal(encoded.headers.get("cache-control"), "no-store");

  const encodedInternal = await app.request("http://127.0.0.1/%69nternal/ping");
  assert.equal(encodedInternal.status, 200);
  assert.equal(encodedInternal.headers.get("cache-control"), "no-store");

  const plain = await app.request("http://127.0.0.1/v1/health");
  assert.equal(plain.headers.get("cache-control"), "no-store");

  const other = await app.request("http://127.0.0.1/health");
  assert.equal(other.headers.get("cache-control"), null);
});
