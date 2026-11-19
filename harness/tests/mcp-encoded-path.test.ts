import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("an encoded MCP path misses the allowlist", async () => {
  const auth = new URL("../../src/worker/auth.ts", import.meta.url).href;
  const { internalRouteVerdict } = (await import(auth)) as {
    internalRouteVerdict: (method: string, path: string, scope: string[]) => "ok" | "no";
  };
  assert.equal(internalRouteVerdict("GET", "/v1/brains", ["secondary.read"]), "ok");
  assert.equal(internalRouteVerdict("GET", "/%76%31/brains", ["secondary.read"]), "no");
  assert.equal(internalRouteVerdict("GET", "/v1/%62rains", ["secondary.read"]), "no");
});

test("the MCP allowlist call site does not decode the path", () => {
  const src = readFileSync(new URL("../../src/worker/auth.ts", import.meta.url), "utf8");
  const at = src.indexOf("const verdict = internalRouteVerdict(");
  assert.equal(at > 0, true);
  const call = src.slice(at, src.indexOf(");", at));
  assert.equal(call.includes("new URL(c.req.url).pathname"), true);
  assert.equal(call.includes("decodeURI"), false);
  assert.equal(call.includes("c.req.path"), false);
});
