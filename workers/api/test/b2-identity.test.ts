// B2 security review L-07: pending sign-ins are capped per address, and a re-login ends the session
// the browser already held.

import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { cookieOf, makeIdp, req, signIn } from "./entra-helpers.ts";
import { ALPHA, seed, tenantDo } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const LOGIN_COOKIE = "__Host-secondary_login";
const ip = (n: number) => ({ "CF-Connecting-IP": `203.0.113.${n}` });

/** Starts a sign-in and returns what is needed to finish it later. */
async function start(idp: ReturnType<typeof makeIdp>, from: number) {
  const login = await req("/auth/login", { idp, headers: ip(from) });
  expect(login.status).toBe(302);
  return {
    authorizeUrl: login.headers.get("Location") ?? "",
    cookie: cookieOf(login, LOGIN_COOKIE),
  };
}
async function finish(
  idp: ReturnType<typeof makeIdp>,
  s: { authorizeUrl: string; cookie: string | null },
  email: string,
  extra: Record<string, string> = {},
) {
  const u = new URL(await idp.approve(s.authorizeUrl, { email }));
  return req(`${u.pathname}${u.search}`, {
    idp,
    headers: { Cookie: [`${LOGIN_COOKIE}=${s.cookie}`, extra.Cookie].filter(Boolean).join("; ") },
  });
}

describe("L-07: login states are capped per address", () => {
  it("one address flooding /auth/login evicts its own old states, not anybody else's", async () => {
    const idp = makeIdp();
    const first = await start(idp, 10);
    const legit = await start(idp, 11);
    for (let i = 0; i < 12; i++) await start(idp, 10);

    // The flooder's first sign-in was pushed out by its own later ones.
    const gone = await finish(idp, first, "flood-first@example.invalid");
    expect(gone.status).toBe(400);
    // Another address still completes its sign-in.
    const ok = await finish(idp, legit, "flood-legit@example.invalid");
    expect(ok.status).toBe(303);
  });

  it("when the table is full, the busiest addresses lose rows first", async () => {
    const t = tenantDo(ALPHA);
    await runInDurableObject(t, async (inst, state) => {
      state.storage.sql.exec("DELETE FROM login_state");
      const now = Date.now();
      // A legitimate sign-in is the oldest row; then 1005 more arrive from 100 addresses.
      inst.loginStatePut("legit", "n", "v", null, now, "ip-legit");
      for (let i = 0; i < 1005; i++)
        inst.loginStatePut(`h${i}`, "n", "v", null, now + 1 + i, `ip${i % 100}`);
      const rows = state.storage.sql.exec("SELECT COUNT(*) AS c FROM login_state").one()
        .c as number;
      expect(rows).toBeLessThanOrEqual(1000);
      expect(inst.loginStateTake("legit", now + 5000)).not.toBeNull();
    });
  });
});

describe("L-07: a new sign-in ends the session the browser held", () => {
  it("the old session cookie stops working after a re-login", async () => {
    const idp = makeIdp();
    const email = "relogin@example.invalid";
    const a = await signIn(idp, { email });
    expect(a.cookie).not.toBeNull();
    expect((await req("/v1/me", { headers: { Cookie: a.cookie as string }, idp })).status).toBe(
      200,
    );

    const s = await start(idp, 12);
    const cb = await finish(idp, s, email, { Cookie: a.cookie as string });
    expect(cb.status).toBe(303);
    expect((await req("/v1/me", { headers: { Cookie: a.cookie as string }, idp })).status).toBe(
      401,
    );
    const fresh = `__Host-secondary_session=${cookieOf(cb, "__Host-secondary_session")}`;
    expect((await req("/v1/me", { headers: { Cookie: fresh }, idp })).status).toBe(200);
  });
});
