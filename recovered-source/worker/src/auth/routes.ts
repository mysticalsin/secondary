// /auth/*: Entra ID sign-in (authorization code + PKCE), sign-out and a public provider list.
// These are not under /v1, so they are not behind `authenticate`.

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { tenantFor } from "../auth.ts";
import { safeEqual } from "../security.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import {
  accessAllowed,
  allowGuests,
  directoryTenant,
  entraConfig,
  entraEnabled,
  scimConfigured,
} from "./config.ts";
import { LOGIN_COOKIE, SESSION_COOKIE } from "./limits.ts";
import {
  authorizeUrl,
  discover,
  exchangeCode,
  OidcError,
  pkceChallenge,
  randomToken,
  sha256Hex,
  verifyIdToken,
} from "./oidc.ts";
import {
  clearLoginCookie,
  clearSessionCookie,
  newSessionValue,
  parseSessionValue,
  safeReturnTo,
  sameOrigin,
  setLoginCookie,
  setSessionCookie,
} from "./session.ts";

const LOGIN_LIMIT_PER_MIN = 60;

const log = (reason: string) => console.warn(JSON.stringify({ at: "entra_login", reason }));

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const nowOf = () => deps.now?.() ?? Date.now();
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  // Public: lets the UI show or hide the Entra button. No secrets, no tenant ids.
  app.get("/providers", (c) =>
    c.json({ entra: entraEnabled(c.env), access: accessAllowed(c.env), loginUrl: "/auth/login" }),
  );

  app.get("/login", async (c) => {
    const cfg = entraConfig(c.env);
    const dir = directoryTenant(c.env);
    if (!entraEnabled(c.env) || !cfg || !dir) return c.json({ error: "entra_disabled" }, 404);
    const now = nowOf();
    const stub = tenantStub(c.env, dir);
    const ip = c.req.header("CF-Connecting-IP") ?? "local";
    const hit = await stub.hit(`auth_login:${ip}`, now, LOGIN_LIMIT_PER_MIN);
    if (hit.limited) {
      c.header("Retry-After", String(hit.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    let doc: Awaited<ReturnType<typeof discover>>;
    try {
      doc = await discover(cfg, deps.entra ?? {}, now);
    } catch (e) {
      log(e instanceof OidcError ? e.code : "discovery_failed");
      return c.json({ error: "sign_in_unavailable" }, 502);
    }
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    await stub.loginStatePut(
      await sha256Hex(state),
      nonce,
      verifier,
      safeReturnTo(c.req.query("returnTo")),
      now,
      (await sha256Hex(`login-ip:${ip}`)).slice(0, 16),
    );
    setLoginCookie(c, state);
    return c.redirect(
      authorizeUrl(cfg, doc, {
        redirectUri: `${new URL(c.req.url).origin}/auth/callback`,
        state,
        nonce,
        challenge: await pkceChallenge(verifier),
      }),
      302,
    );
  });

  app.get("/callback", async (c) => {
    const cfg = entraConfig(c.env);
    const dir = directoryTenant(c.env);
    if (!entraEnabled(c.env) || !cfg || !dir) return c.json({ error: "entra_disabled" }, 404);
    const now = nowOf();
    const cookieState = getCookie(c, LOGIN_COOKIE);
    clearLoginCookie(c);
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (c.req.query("error")) {
      log(`idp_${(c.req.query("error") ?? "").replace(/[^a-z_]/g, "").slice(0, 40)}`);
      return c.json({ error: "sign_in_failed" }, 400);
    }
    // The browser that started the login must be the one that finishes it (login CSRF).
    if (!state || !code || !cookieState || !safeEqual(state, cookieState))
      return c.json({ error: "invalid_state" }, 400);
    // Single use: the record is consumed, so a replayed callback finds nothing.
    const saved = await tenantStub(c.env, dir).loginStateTake(await sha256Hex(state), now);
    if (!saved) return c.json({ error: "invalid_state" }, 400);

    let identity: Awaited<ReturnType<typeof verifyIdToken>>;
    try {
      const entra = deps.entra ?? {};
      const doc = await discover(cfg, entra, now);
      const idToken = await exchangeCode(cfg, doc, entra, {
        code,
        verifier: saved.verifier,
        redirectUri: `${new URL(c.req.url).origin}/auth/callback`,
      });
      identity = await verifyIdToken(idToken, cfg, doc, entra, saved.nonce, now);
    } catch (e) {
      const reason = e instanceof OidcError ? e.code : "unexpected";
      log(reason);
      return c.json({ error: "sign_in_failed" }, 401);
    }
    if (identity.groupsOverage) log("groups_overage");
    // H-01: B2B guests come from other directories and can carry any mail attribute. Refused unless allowed.
    if (identity.guest && !allowGuests(c.env)) {
      log("guest_refused");
      return c.json({ error: "guest_refused" }, 403);
    }

    // Guests (when allowed) are not routed by a mail domain they may have set themselves.
    const tenantId = identity.guest ? dir : tenantFor(identity.email, c.env);
    // M-09: SCIM writes go to the directory tenant, so a SCIM-managed sign-in must land there too.
    if (scimConfigured(c.env) && tenantId !== dir) {
      log("tenant_mismatch");
      return c.json({ error: "account_disabled" }, 403);
    }
    const value = newSessionValue(tenantId);
    const made = await tenantStub(c.env, tenantId).sessionCreate(
      await sha256Hex(value),
      {
        tid: identity.tid,
        oid: identity.oid,
        email: identity.email,
        emailIsUpn: identity.emailIsUpn,
        guest: identity.guest,
      },
      identity.groups,
      now,
      scimConfigured(c.env),
    );
    if (!made.ok) {
      log(`signin_${made.reason}`);
      return c.json({ error: "account_disabled" }, 403);
    }
    // L-07: a session the browser already held is ended, not left to expire.
    const held = getCookie(c, SESSION_COOKIE);
    const heldParsed = held ? await parseSessionValue(held, c.env) : null;
    if (heldParsed) await tenantStub(c.env, heldParsed.tenantId).sessionDelete(heldParsed.hash);
    setSessionCookie(c, value);
    return c.redirect(saved.returnTo ?? "/", 303);
  });

  app.post("/logout", async (c) => {
    if (!sameOrigin(c.req.raw)) return c.json({ error: "forbidden" }, 403);
    const raw = getCookie(c, SESSION_COOKIE);
    const p = raw ? await parseSessionValue(raw, c.env) : null;
    if (p) await tenantStub(c.env, p.tenantId).sessionDelete(p.hash);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return app;
}
