import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("GET /v1/health returns ok", async () => {
  const res = await SELF.fetch("https://example.com/v1/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, environment: "dev" });
});

it("durable objects answer /health", async () => {
  for (const [ns, name] of [
    [env.TENANT_POLICY, "TenantPolicy"],
    [env.WORKSPACE, "Workspace"],
  ] as const) {
    const res = await ns.get(ns.idFromName("t")).fetch("https://do/health");
    expect(await res.json()).toEqual({ ok: true, object: name });
  }
});
