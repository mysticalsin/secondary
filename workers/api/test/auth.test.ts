import { beforeAll, describe, expect, it } from "vitest";
import { AUD, as, call, json, SEED_TOKEN, seed, sign, TEAM } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

describe("Cloudflare Access JWT", () => {
  it("accepts a valid token from the header and from the CF_Authorization cookie", async () => {
    const t = await sign("someone@example.invalid");
    const a = await call("/v1/me", { token: t });
    expect(a.status).toBe(200);
    expect((await json(a)).principal.email).toBe("someone@example.invalid");
    const b = await call("/v1/me", { token: null, headers: { Cookie: `CF_Authorization=${t}` } });
    expect(b.status).toBe(200);
  });

  it.each([
    ["no token", { token: null }],
    ["garbage token", { token: "not.a.jwt" }],
    ["wrong audience", { token: "wrong-aud" }],
    ["wrong issuer", { token: "wrong-iss" }],
    ["expired", { token: "expired" }],
    ["signed by another key", { token: "stranger" }],
    ["no email claim (service token)", { token: "no-email" }],
  ])("401 for %s", async (name, o) => {
    const email = "x@example.invalid";
    const tokens: Record<string, () => Promise<string>> = {
      "wrong-aud": () => sign(email, { aud: "other-aud" }),
      "wrong-iss": () => sign(email, { iss: "https://evil.cloudflareaccess.com" }),
      expired: () => sign(email, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      stranger: () => sign(email, { signWithStranger: true }),
      "no-email": () => sign(email, { noEmail: true }),
    };
    const token =
      o.token === null || o.token === "not.a.jwt"
        ? o.token
        : await (tokens[o.token] as () => Promise<string>)();
    const res = await call("/v1/me", { token });
    expect(res.status, name).toBe(401);
    expect(await json(res)).toEqual({ error: "unauthorized" });
  });

  it("fails closed while Access is not configured", async () => {
    const t = await sign("x@example.invalid");
    for (const env of [{ ACCESS_TEAM_DOMAIN: "" }, { ACCESS_AUD: "" }]) {
      expect((await call("/v1/me", { token: t, env })).status).toBe(401);
    }
    // A token for another team domain does not verify against ours.
    expect(
      (
        await call("/v1/me", {
          token: t,
          env: { ACCESS_TEAM_DOMAIN: "other.cloudflareaccess.com" },
        })
      ).status,
    ).toBe(401);
    expect(TEAM).not.toBe("other.cloudflareaccess.com");
    expect(AUD).toBeTruthy();
  });

  it("health is the only unauthenticated API route", async () => {
    expect((await call("/v1/health")).status).toBe(200);
    for (const p of [
      "/v1/me",
      "/v1/map",
      "/v1/search?q=a",
      "/v1/review",
      "/v1/accounts",
      "/v1/governances",
      "/v1/personal/items",
    ])
      expect((await call(p)).status, p).toBe(401);
    expect((await call("/v1/actions", { body: {} })).status).toBe(401);
    expect((await call("/v1/genui/plan", { body: {} })).status).toBe(401);
  });

  it("unknown email: no roles, sees no company content", async () => {
    const me = await json(await call("/v1/me", { email: "stranger@example.invalid" }));
    expect(me.principal.roleIds).toEqual([]);
    const map = await json(
      await call("/v1/map?lens=departments", { email: "stranger@example.invalid" }),
    );
    expect(map.hubs).toEqual([]);
    const search = await json(
      await call("/v1/search?q=pricing", { email: "stranger@example.invalid" }),
    );
    expect(search.results).toEqual([]);
  });

  it("stored directory entry gives roles with no persona header", async () => {
    const me = await json(await call("/v1/me", { email: "ceo@example.invalid" }));
    expect(me.principal.roleIds).toEqual(["ceo"]);
    expect(me.persona).toBeNull();
  });
});

describe("demo persona header", () => {
  it("selects a role in dev", async () => {
    const me = await json(await as("auditor", "/v1/me"));
    expect(me.persona).toBe("auditor");
    expect(me.principal.roleIds).toEqual(["auditor"]);
    expect(me.principal.id).toBe("u_auditor");
  });

  it("rejects an unknown persona in dev", async () => {
    expect((await as("not_a_role", "/v1/me")).status).toBe(400);
  });

  it("is ignored in any other environment", async () => {
    for (const environment of ["prod", "staging", ""]) {
      const res = await call("/v1/me", {
        email: "nobody@example.invalid",
        persona: "ceo",
        env: { ENVIRONMENT: environment },
      });
      const me = await json(res);
      expect(me.persona, environment).toBeNull();
      expect(me.principal.roleIds, environment).toEqual([]);
    }
    // Even an invalid persona value is ignored (not a 400) outside dev.
    expect(
      (
        await call("/v1/me", {
          email: "n@example.invalid",
          persona: "bogus",
          env: { ENVIRONMENT: "prod" },
        })
      ).status,
    ).toBe(200);
  });

  it("does not raise a stored role either: a stored ceo stays ceo under prod", async () => {
    const me = await json(
      await call("/v1/me", {
        email: "ceo@example.invalid",
        persona: "platform_admin",
        env: { ENVIRONMENT: "prod" },
      }),
    );
    expect(me.principal.roleIds).toEqual(["ceo"]);
  });
});

describe("local dev bypass", () => {
  const bypass = { DEV_AUTH_BYPASS_EMAIL: "dev@example.invalid" };

  it("signs in on localhost, 127.0.0.1 and [::1] in dev", async () => {
    for (const origin of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
      const res = await call("/v1/me", { token: null, env: bypass, origin });
      expect(res.status, origin).toBe(200);
      expect((await json(res)).principal.email).toBe("dev@example.invalid");
    }
  });

  it("is refused on any other host", async () => {
    for (const origin of [
      "https://secondary.example.test",
      "https://localhost.evil.test",
      "http://127.0.0.1.evil.test",
      "http://10.0.0.5:8787",
      "https://secondary-api-dev.workers.dev",
    ]) {
      const res = await call("/v1/me", { token: null, env: bypass, origin });
      expect(res.status, origin).toBe(401);
    }
  });

  it("is refused outside dev even on localhost, and without the var", async () => {
    expect(
      (
        await call("/v1/me", {
          token: null,
          env: { ...bypass, ENVIRONMENT: "prod" },
          origin: "http://localhost:8787",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("/v1/me", {
          token: null,
          env: { DEV_AUTH_BYPASS_EMAIL: "" },
          origin: "http://localhost:8787",
        })
      ).status,
    ).toBe(401);
  });

  it("does not rescue an invalid token", async () => {
    expect(
      (await call("/v1/me", { token: "bad", env: bypass, origin: "http://localhost:8787" })).status,
    ).toBe(401);
  });
});

describe("seed endpoint", () => {
  it("needs the seed token (constant-time compare), and only in dev", async () => {
    const t = (headers: Record<string, string>, env: Record<string, unknown> = {}) =>
      call("/v1/admin/seed", { body: {}, headers, env });
    expect((await t({})).status).toBe(401);
    expect((await t({ "X-Seed-Token": "wrong" })).status).toBe(401);
    expect((await t({ "X-Seed-Token": `${SEED_TOKEN}x` })).status).toBe(401);
    expect((await t({ "X-Seed-Token": SEED_TOKEN })).status).toBe(200);
    expect((await t({ "X-Seed-Token": SEED_TOKEN }, { ENVIRONMENT: "prod" })).status).toBe(404);
    expect((await t({ "X-Seed-Token": SEED_TOKEN }, { SEED_TOKEN: undefined })).status).toBe(503);
    expect((await t({ "X-Seed-Token": "" }, { SEED_TOKEN: "" })).status).toBe(503);
  });

  it("a signed-in user without the token cannot seed", async () => {
    expect((await as("platform_admin", "/v1/admin/seed", { body: {} })).status).toBe(401);
  });

  it("an unseeded tenant answers 503 for content routes and 200 for /v1/me", async () => {
    const env = { TENANT_DOMAINS: JSON.stringify({ "fresh.example.invalid": "tenant_fresh" }) };
    expect((await call("/v1/map", { email: "a@fresh.example.invalid", env })).status).toBe(503);
    const me = await json(await call("/v1/me", { email: "a@fresh.example.invalid", env }));
    expect(me.seeded).toBe(false);
  });
});
