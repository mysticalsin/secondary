import { beforeAll, describe, expect, it } from "vitest";
import { exchangeCode, OidcError } from "../src/auth/oidc.ts";
import {
  CLIENT,
  CLIENT_SECRET,
  cookieOf,
  ENTRA_ENV,
  makeIdp,
  ORIGIN,
  OTHER_TENANT,
  req,
  setCookieLine,
  signIn,
  TENANT,
} from "./entra-helpers.ts";
import { ALPHA, call, json, seed, tenantDo } from "./helpers.ts";

let n = 0;
const email = () => `entra${++n}-${Date.now()}@example.invalid`;
const GROUP_REVIEWER = "0f0f0f0f-1111-4222-8333-444444444444";

const me = async (cookie: string | null, o: { now?: number; env?: Record<string, unknown> } = {}) =>
  req("/v1/me", { headers: cookie ? { Cookie: cookie } : {}, ...o });

beforeAll(async () => {
  await seed();
  await tenantDo(ALPHA).groupMapSet(GROUP_REVIEWER, "reviewer");
});

describe("provider list", () => {
  it("hides Entra until all three values are set and AUTH_MODE allows it", async () => {
    const on = await json(await req("/auth/providers"));
    expect(on).toEqual({ entra: true, access: false, loginUrl: "/auth/login" });
    for (const env of [
      { ENTRA_CLIENT_SECRET: "" },
      { ENTRA_TENANT_ID: "" },
      { ENTRA_CLIENT_ID: "not-a-guid" },
      { AUTH_MODE: "access" },
    ]) {
      const r = await json(await req("/auth/providers", { env }));
      expect(r.entra, JSON.stringify(env)).toBe(false);
    }
    expect((await json(await req("/auth/providers", { env: { AUTH_MODE: "both" } }))).access).toBe(
      true,
    );
    expect((await req("/auth/providers")).headers.get("Cache-Control")).toBe("no-store");
  });

  it("login and callback answer 404 while Entra is off", async () => {
    for (const env of [{ ENTRA_CLIENT_SECRET: "" }, { AUTH_MODE: "access" }]) {
      expect((await req("/auth/login", { env })).status).toBe(404);
      expect((await req("/auth/callback?code=x&state=y", { env })).status).toBe(404);
    }
  });
});

describe("authorization request", () => {
  it("is a code flow with PKCE S256, state and nonce, to the configured tenant only", async () => {
    const r = await req("/auth/login", { idp: makeIdp() });
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get("Location") as string);
    expect(u.origin + u.pathname).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    );
    const q = u.searchParams;
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("scope")).toContain("openid");
    expect(q.get("state")?.length).toBeGreaterThanOrEqual(40);
    expect(q.get("nonce")?.length).toBeGreaterThanOrEqual(40);
    // The login cookie carries the state, Lax so the IdP redirect back can send it.
    const line = setCookieLine(r, "__Host-secondary_login");
    expect(line).toContain(`=${q.get("state")}`);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\//);
    expect(line).not.toMatch(/Domain=/i);
    // Each login is fresh.
    const r2 = await req("/auth/login", { idp: makeIdp() });
    expect(new URL(r2.headers.get("Location") as string).searchParams.get("state")).not.toBe(
      q.get("state"),
    );
  });

  it("answers 502 when discovery describes another tenant", async () => {
    const idp = makeIdp({
      discoveryIssuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`,
    });
    expect((await req("/auth/login", { idp })).status).toBe(502);
  });
});

describe("sign-in", () => {
  it("creates a __Host- session cookie and a principal with the mapped roles", async () => {
    const idp = makeIdp();
    const e = email();
    const s = await signIn(idp, { email: e, groups: [GROUP_REVIEWER] });
    expect(s.callback.status).toBe(303);
    expect(s.callback.headers.get("Location")).toBe("/");
    const line = setCookieLine(s.callback, "__Host-secondary_session");
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=28800/);
    expect(line).not.toMatch(/Domain=/i);
    // The login cookie is spent.
    expect(setCookieLine(s.callback, "__Host-secondary_login")).toMatch(/Max-Age=0/);

    // The token request carried the PKCE verifier and the client secret, nothing else leaked.
    const tokenReq = idp.requests.find((r) => r.body)?.body as URLSearchParams;
    expect(tokenReq.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
    expect(tokenReq.get("client_secret")).toBe(CLIENT_SECRET);

    const res = await me(s.cookie);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.principal.email).toBe(e);
    expect(body.principal.roleIds).toEqual(["reviewer"]);
  });

  it("gives no roles to a principal without mapped groups (Personal Brain only)", async () => {
    const idp = makeIdp();
    for (const groups of [[], ["deadbeef-0000-4000-8000-000000000000"], undefined]) {
      const s = await signIn(idp, { email: email(), groups });
      const body = await json(await me(s.cookie));
      expect(body.principal.roleIds).toEqual([]);
    }
  });

  it("re-applies the groups claim at every login", async () => {
    const idp = makeIdp();
    const e = email();
    const a = await signIn(idp, { email: e, groups: [GROUP_REVIEWER.toUpperCase()] });
    expect((await json(await me(a.cookie))).principal.roleIds).toEqual(["reviewer"]);
    const b = await signIn(idp, { email: e, groups: [] });
    expect((await json(await me(b.cookie))).principal.roleIds).toEqual([]);
  });

  it("accepts only same-site return paths", async () => {
    const idp = makeIdp();
    expect(
      (
        await signIn(idp, { email: email() }, { returnTo: "/map?lens=accounts" })
      ).callback.headers.get("Location"),
    ).toBe("/map?lens=accounts");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "map"]) {
      const s = await signIn(idp, { email: email() }, { returnTo: bad });
      expect(s.callback.headers.get("Location"), bad).toBe("/");
    }
  });
});

describe("callback rejects", () => {
  const fails = async (claims: Parameters<typeof signIn>[1], status = 401) => {
    const s = await signIn(makeIdp(), claims);
    expect(s.callback.status).toBe(status);
    expect(s.cookie).toBeNull();
    expect(await json(s.callback)).toEqual({ error: "sign_in_failed" });
  };

  it("a token from another tenant", () => fails({ email: email(), tid: OTHER_TENANT }));
  it("a token with the right tid but another issuer", () =>
    fails({ email: email(), iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }));
  it("a token for another client (aud)", () => fails({ email: email(), aud: "someone-else" }));
  it("an expired token", () =>
    fails({ email: email(), exp: Math.floor(Date.now() / 1000) - 3600 }));
  it("a token with the wrong nonce", () => fails({ email: email(), nonce: "replayed-nonce" }));
  it("a token signed by another key", () => fails({ email: email(), signWithStranger: true }));
  it("a token with no email", () => fails({ email: null }));

  it("a callback without the login cookie (login CSRF)", async () => {
    const idp = makeIdp();
    const login = await req("/auth/login", { idp });
    const url = new URL(
      await idp.approve(login.headers.get("Location") as string, { email: email() }),
    );
    const r = await req(`${url.pathname}${url.search}`, { idp });
    expect(r.status).toBe(400);
    expect(await json(r)).toEqual({ error: "invalid_state" });
    expect(cookieOf(r, "__Host-secondary_session")).toBeNull();
  });

  it("a state that does not match the cookie", async () => {
    const idp = makeIdp();
    const a = await req("/auth/login", { idp });
    const b = await req("/auth/login", { idp });
    const url = new URL(await idp.approve(a.headers.get("Location") as string, { email: email() }));
    const r = await req(`${url.pathname}${url.search}`, {
      idp,
      headers: { Cookie: `__Host-secondary_login=${cookieOf(b, "__Host-secondary_login")}` },
    });
    expect(r.status).toBe(400);
  });

  it("a replayed callback: the state is single use", async () => {
    const idp = makeIdp();
    const login = await req("/auth/login", { idp });
    const loginCookie = `__Host-secondary_login=${cookieOf(login, "__Host-secondary_login")}`;
    const url = new URL(
      await idp.approve(login.headers.get("Location") as string, { email: email() }),
    );
    const path = `${url.pathname}${url.search}`;
    const first = await req(path, { idp, headers: { Cookie: loginCookie } });
    expect(first.status).toBe(303);
    const second = await req(path, { idp, headers: { Cookie: loginCookie } });
    expect(second.status).toBe(400);
    expect(cookieOf(second, "__Host-secondary_session")).toBeNull();
  });

  it("a state the server never issued", async () => {
    const r = await req("/auth/callback?code=c&state=forged", {
      headers: { Cookie: "__Host-secondary_login=forged" },
      idp: makeIdp(),
    });
    expect(r.status).toBe(400);
  });

  it("an expired login state", async () => {
    const idp = makeIdp();
    const t0 = Date.now();
    const login = await req("/auth/login", { idp, now: t0 });
    const cookie = `__Host-secondary_login=${cookieOf(login, "__Host-secondary_login")}`;
    const url = new URL(
      await idp.approve(login.headers.get("Location") as string, { email: email() }),
    );
    const r = await req(`${url.pathname}${url.search}`, {
      idp,
      headers: { Cookie: cookie },
      now: t0 + 11 * 60_000,
    });
    expect(r.status).toBe(400);
  });

  it("an IdP error response and a missing code", async () => {
    const idp = makeIdp();
    const login = await req("/auth/login", { idp });
    const cookie = `__Host-secondary_login=${cookieOf(login, "__Host-secondary_login")}`;
    const state = new URL(login.headers.get("Location") as string).searchParams.get("state");
    expect(
      (
        await req(`/auth/callback?error=access_denied&state=${state}`, {
          idp,
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(400);
    const login2 = await req("/auth/login", { idp });
    const c2 = `__Host-secondary_login=${cookieOf(login2, "__Host-secondary_login")}`;
    const s2 = new URL(login2.headers.get("Location") as string).searchParams.get("state");
    expect((await req(`/auth/callback?state=${s2}`, { idp, headers: { Cookie: c2 } })).status).toBe(
      400,
    );
  });

  it("the code exchange without a PKCE verifier never reaches the IdP", async () => {
    const idp = makeIdp();
    const cfg = { tenantId: TENANT, clientId: CLIENT, clientSecret: CLIENT_SECRET };
    const doc = {
      issuer: "x",
      authorization_endpoint: "x",
      token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      jwks_uri: "x",
    };
    await expect(
      exchangeCode(cfg, doc, idp.deps, { code: "c", verifier: "", redirectUri: "r" }),
    ).rejects.toThrow(OidcError);
    expect(idp.requests).toHaveLength(0);
  });

  it("a code redeemed with a verifier that does not match the challenge (as the IdP sees it)", async () => {
    const idp = makeIdp();
    const login = await req("/auth/login", { idp });
    const cb = new URL(
      await idp.approve(login.headers.get("Location") as string, { email: email() }),
    );
    const cfg = { tenantId: TENANT, clientId: CLIENT, clientSecret: CLIENT_SECRET };
    const doc = {
      issuer: "x",
      authorization_endpoint: "x",
      token_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      jwks_uri: "x",
    };
    await expect(
      exchangeCode(cfg, doc, idp.deps, {
        code: cb.searchParams.get("code") as string,
        verifier: "not-the-verifier",
        redirectUri: `${ORIGIN}/auth/callback`,
      }),
    ).rejects.toThrow("token_exchange_rejected");
  });
});

describe("session lifetime", () => {
  const MIN = 60_000;

  it("expires after 30 minutes idle and slides while in use", async () => {
    const idp = makeIdp();
    const t0 = Date.now();
    const s = await signIn(idp, { email: email() }, { now: t0 });
    expect((await me(s.cookie, { now: t0 + 29 * MIN })).status).toBe(200);
    expect((await me(s.cookie, { now: t0 + 58 * MIN })).status).toBe(200);
    expect((await me(s.cookie, { now: t0 + 89 * MIN })).status).toBe(401);
    // The idle session is gone for good, even for a request inside the window.
    expect((await me(s.cookie, { now: t0 + 90 * MIN })).status).toBe(401);
  });

  it("expires after 8 hours however active it is", async () => {
    const idp = makeIdp();
    const t0 = Date.now();
    const s = await signIn(idp, { email: email() }, { now: t0 });
    for (let m = 25; m <= 470; m += 25)
      expect((await me(s.cookie, { now: t0 + m * MIN })).status, `minute ${m}`).toBe(200);
    expect((await me(s.cookie, { now: t0 + 479 * MIN })).status).toBe(200);
    expect((await me(s.cookie, { now: t0 + 481 * MIN })).status).toBe(401);
  });

  it("is refused when the cookie is forged, truncated or names an unknown tenant", async () => {
    const idp = makeIdp();
    const s = await signIn(idp, { email: email() });
    const value = (s.cookie as string).split("=")[1] as string;
    for (const bad of [
      `${value}x`,
      value.slice(0, -2),
      `tenant_unknown.${value.split(".")[1]}`,
      "garbage",
      "",
    ]) {
      expect((await me(`__Host-secondary_session=${bad}`)).status, bad).toBe(401);
    }
  });
});

describe("CSRF on cookie sessions", () => {
  it("refuses a mutation without a same-origin Origin header", async () => {
    const s = await signIn(makeIdp(), { email: email() });
    const send = (origin?: string) =>
      req("/v1/personal/items", {
        headers: { Cookie: s.cookie as string, ...(origin ? { Origin: origin } : {}) },
        body: { kind: "note", title: "t", body: "b" },
      });
    expect((await send()).status).toBe(403);
    expect((await send("https://evil.example")).status).toBe(403);
    expect((await send("null")).status).toBe(403);
    const ok = await send(ORIGIN);
    expect(ok.status).not.toBe(403);
    expect(ok.status).not.toBe(401);
    // Reads need no Origin.
    expect((await me(s.cookie)).status).toBe(200);
  });
});

describe("sign-out", () => {
  it("deletes the server-side session and clears the cookie", async () => {
    const s = await signIn(makeIdp(), { email: email() });
    expect(
      (await req("/auth/logout", { method: "POST", headers: { Cookie: s.cookie as string } }))
        .status,
    ).toBe(403);
    const out = await req("/auth/logout", {
      method: "POST",
      headers: { Cookie: s.cookie as string, Origin: ORIGIN },
    });
    expect(out.status).toBe(200);
    expect(setCookieLine(out, "__Host-secondary_session")).toMatch(/Max-Age=0/);
    // The old cookie is dead even if a browser kept it.
    expect((await me(s.cookie)).status).toBe(401);
  });
});

describe("AUTH_MODE", () => {
  it("entra: the Access JWT is not accepted", async () => {
    const res = await call("/v1/me", { email: "someone@example.invalid", env: ENTRA_ENV });
    expect(res.status).toBe(401);
  });

  it("access (default): a session cookie is ignored and Access still works", async () => {
    const s = await signIn(makeIdp(), { email: email() });
    expect((await me(s.cookie, { env: { AUTH_MODE: "access" } })).status).toBe(401);
    expect((await call("/v1/me", { email: "someone@example.invalid" })).status).toBe(200);
  });

  it("both: either identity source signs a request in", async () => {
    const env = { ...ENTRA_ENV, AUTH_MODE: "both" };
    const s = await signIn(makeIdp(), { email: email() });
    expect((await me(s.cookie, { env })).status).toBe(200);
    expect((await call("/v1/me", { email: "someone@example.invalid", env })).status).toBe(200);
    // A dead cookie falls through to a valid Access token.
    const dead = await call("/v1/me", {
      email: "someone@example.invalid",
      env,
      headers: { Cookie: "__Host-secondary_session=tenant_mantu_synthetic.dead" },
    });
    expect(dead.status).toBe(200);
    expect((await call("/v1/me", { token: null, env })).status).toBe(401);
  });
});
