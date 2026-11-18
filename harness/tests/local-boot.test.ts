/**
 * The loopback shell: liveness, a refused profile, provider flags, and the synthetic page.
 * No Cloudflare account and no secret value.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const html = "<!DOCTYPE html><title>Synthetic</title><p>Synthetic local shell</p>";

const env = {
  ENVIRONMENT: "dev",
  DEFAULT_TENANT_ID: "synthetic",
  AUTH_MODE: "access",
  ASSETS: {
    fetch: async () =>
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
  },
};

type BootApp = {
  request: (input: string, init: RequestInit | undefined, bindings: unknown) => Promise<Response>;
};

async function app(): Promise<BootApp> {
  // A variable specifier keeps this file from pulling the Worker graph into the root typecheck.
  const entry = new URL("../../recovered-source/worker/src/index.ts", import.meta.url).href;
  const loaded = (await import(entry)) as { createApp: () => BootApp };
  return loaded.createApp();
}

test("local boot: health, providers, a refused profile, and the synthetic shell", async () => {
  const api = await app();
  const health = await api.request("http://127.0.0.1/v1/health", {}, env);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, env: "dev", version: "0.1.0" });

  const providers = await api.request("http://127.0.0.1/auth/providers", {}, env);
  assert.equal(providers.status, 200);
  assert.deepEqual(await providers.json(), {
    entra: false,
    access: true,
    loginUrl: "/auth/login",
  });

  const me = await api.request("http://127.0.0.1/v1/me", {}, env);
  assert.equal(me.status, 401);
  assert.deepEqual(await me.json(), { error: "unauthorized" });

  const home = await api.request("http://127.0.0.1/", {}, env);
  assert.equal(home.status, 200);
  const page = await home.text();
  assert.equal(page.includes("Synthetic"), true);
  assert.equal(page.includes("example.invalid"), false);

  const ready = await api.request("http://127.0.0.1/v1/ready", {}, env);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { ready: false, checks: { do: "fail", r2: "fail" } });
});
