import { beforeAll, describe, expect, it } from "vitest";
import { AUD, as, call, json, SEED_TOKEN, seed, sign, TEAM, tenantDo } from "./helpers.ts";

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
  const who = "seeder@example.invalid";
  const t = (
    headers: Record<string, string>,
    env: Record<string, unknown> = {},
    email: string | null = who,
  ) => call("/v1/admin/seed", { body: {}, headers, env, ...(email ? { email } : {}) });

  it("needs the seed token (constant-time compare), and only in dev", async () => {
    expect((await t({})).status).toBe(401);
    expect((await t({ "X-Seed-Token": "wrong" })).status).toBe(401);
    expect((await t({ "X-Seed-Token": `${SEED_TOKEN}x` })).status).toBe(401);
    expect((await t({ "X-Seed-Token": SEED_TOKEN })).status).toBe(200);
    expect((await t({ "X-Seed-Token": SEED_TOKEN }, { ENVIRONMENT: "prod" })).status).toBe(404);
    expect((await t({ "X-Seed-Token": SEED_TOKEN }, { SEED_TOKEN: undefined })).status).toBe(503);
    expect((await t({ "X-Seed-Token": "" }, { SEED_TOKEN: "" })).status).toBe(503);
  });

  it("M1: the token alone is not enough, a valid Access identity is required too", async () => {
    // No Access JWT: 401 even with the right token.
    expect((await t({ "X-Seed-Token": SEED_TOKEN }, {}, null)).status).toBe(401);
    // A forged JWT: 401.
    const forged = await call("/v1/admin/seed", {
      body: {},
      token: await sign(who, { signWithStranger: true }),
      headers: { "X-Seed-Token": SEED_TOKEN },
    });
    expect(forged.status).toBe(401);
    // Access identity without the token: 401.
    expect((await t({})).status).toBe(401);
  });

  it("M1: attempts are rate limited per signed-in user", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await t({ "X-Seed-Token": "wrong" }, {}, "hammer@example.invalid")).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Another user is not affected.
    expect((await t({ "X-Seed-Token": "wrong" }, {}, "calm@example.invalid")).status).toBe(401);
  });

  it("a signed-in user without the token cannot seed", async () => {
    expect((await as("platform_admin", "/v1/admin/seed", { body: {} })).status).toBe(401);
  });

  it("an unseeded tenant answers 503 for content routes and 200 for /v1/me (never auto-seeded outside dev)", async () => {
    const env = {
      ENVIRONMENT: "prod",
      TENANT_DOMAINS: JSON.stringify({ "fresh.example.invalid": "tenant_fresh" }),
    };
    expect((await call("/v1/map", { email: "a@fresh.example.invalid", env })).status).toBe(503);
    const me = await json(await call("/v1/me", { email: "a@fresh.example.invalid", env }));
    expect(me.seeded).toBe(false);
    expect(await tenantDo("tenant_fresh").getConfig()).toBeNull();
  });
});

describe("dev auto-seed", () => {
  const domains = (d: string, t: string) => JSON.stringify({ [`${d}.example.invalid`]: t });

  it("the first authenticated request in dev seeds the org once; the second does not reseed", async () => {
    const env = { TENANT_DOMAINS: domains("auto1", "tenant_auto1") };
    const first = await json(await call("/v1/me", { email: "a@auto1.example.invalid", env }));
    expect(first.seeded).toBe(true);
    const epoch = await tenantDo("tenant_auto1").epoch();
    expect(epoch).toBeGreaterThan(0);
    // Change the directory, then make another request: a reseed would wipe this grant.
    await tenantDo("tenant_auto1").grantNda("u_x", "acct_x");
    const afterGrant = await tenantDo("tenant_auto1").epoch();
    const second = await json(await call("/v1/me", { email: "b@auto1.example.invalid", env }));
    expect(second.seeded).toBe(true);
    expect(await tenantDo("tenant_auto1").epoch()).toBe(afterGrant);
    expect(await tenantDo("tenant_auto1").getConfig()).not.toBeNull();
  });

  it("concurrent first requests seed exactly once", async () => {
    const env = { TENANT_DOMAINS: domains("auto2", "tenant_auto2") };
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) => call("/v1/me", { email: `u${i}@auto2.example.invalid`, env })),
    );
    expect(await tenantDo("tenant_auto2").epoch()).toBe(1);
  });

  it("a non-dev environment never seeds", async () => {
    const env = { ENVIRONMENT: "prod", TENANT_DOMAINS: domains("auto3", "tenant_auto3") };
    const me = await json(await call("/v1/me", { email: "a@auto3.example.invalid", env }));
    expect(me.seeded).toBe(false);
    expect(await tenantDo("tenant_auto3").epoch()).toBe(0);
  });
});

describe("M2: personas are bound to the signed-in email", () => {
  it("two testers with the same persona are two principals with separate Personal Brains", async () => {
    const me = async (email: string) =>
      json(await call("/v1/me", { email, persona: "consultant" })).then((m) => m.principal.id);
    const a = await me("tester.a@example.invalid");
    const b = await me("tester.b@example.invalid");
    expect(a).toMatch(/^u_consultant_[0-9a-f]{10}$/);
    expect(b).toMatch(/^u_consultant_[0-9a-f]{10}$/);
    expect(a).not.toBe(b);
    // The seeded persona address keeps the canonical id the synthetic items refer to.
    expect(await me("consultant@example.invalid")).toBe("u_consultant");

    const note = await call("/v1/personal/items", {
      email: "tester.a@example.invalid",
      persona: "consultant",
      body: { title: "Mine alone", body: "private" },
    });
    expect(note.status).toBe(201);
    const list = async (email: string) =>
      json<{ title: string }[]>(await call("/v1/personal/items", { email, persona: "consultant" }));
    expect((await list("tester.a@example.invalid")).map((i) => i.title)).toContain("Mine alone");
    expect((await list("tester.b@example.invalid")).map((i) => i.title)).not.toContain(
      "Mine alone",
    );
  });
});
