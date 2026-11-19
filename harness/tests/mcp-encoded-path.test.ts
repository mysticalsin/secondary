import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("an encoded MCP path misses the allowlist", async () => {
  const auth = new URL("../../recovered-source/worker/src/auth.ts", import.meta.url).href;
  const { internalRouteVerdict } = (await import(auth)) as {
    internalRouteVerdict: (method: string, path: string, scope: string[]) => "ok" | "no";
  };
  assert.equal(internalRouteVerdict("GET", "/v1/brains", ["secondary.read"]), "ok");
  assert.equal(internalRouteVerdict("GET", "/%76%31/brains", ["secondary.read"]), "no");
  assert.equal(internalRouteVerdict("GET", "/v1/%62rains", ["secondary.read"]), "no");
});
