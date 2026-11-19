// Browser session cookie: `<tenantId>.<random>`. The tenant prefix says which TenantPolicy object
// holds the session (the email is not known until the session is read). Only tenants this
// deployment knows about are honoured, so a forged prefix cannot spawn objects. The Durable Object
// stores a SHA-256 of the whole value, never the value itself.

import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types.ts";
import { ABSOLUTE_MS, LOGIN_COOKIE, SESSION_COOKIE } from "./limits.ts";
import { randomToken, sha256Hex } from "./oidc.ts";

const TENANT = /^[a-z0-9_]{3,64}$/;

export function knownTenants(env: Env): Set<string> {
  const out = new Set<string>();
  for (const t of [env.DEFAULT_TENANT_ID, env.SCIM_TENANT_ID]) if (t && TENANT.test(t)) out.add(t);
  try {
    const parsed: unknown = JSON.parse(env.TENANT_DOMAINS || "{}");
    if (parsed && typeof parsed === "object")
      for (const v of Object.values(parsed))
        if (typeof v === "string" && TENANT.test(v)) out.add(v);
  } catch {
    // A broken mapping adds nothing.
  }
  return out;
}

export const newSessionValue = (tenantId: string): string => `${tenantId}.${randomToken()}`;

export async function parseSessionValue(
  raw: string,
  env: Env,
): Promise<{ tenantId: string; hash: string } | null> {
  const dot = raw.indexOf(".");
  if (dot < 3 || raw.length > 200) return null;
  const tenantId = raw.slice(0, dot);
  if (!knownTenants(env).has(tenantId)) return null;
  return { tenantId, hash: await sha256Hex(raw) };
}

const base = { secure: true, httpOnly: true, sameSite: "Lax" as const, path: "/" };

export const setSessionCookie = (c: Context<AppEnv>, value: string): void => {
  setCookie(c, SESSION_COOKIE, value, { ...base, maxAge: Math.floor(ABSOLUTE_MS / 1000) });
};
export const clearSessionCookie = (c: Context<AppEnv>): void => {
  deleteCookie(c, SESSION_COOKIE, { secure: true, path: "/" });
};
/** Lax, not Strict: the IdP redirects back with a top-level cross-site GET that must carry it. */
export const setLoginCookie = (c: Context<AppEnv>, state: string): void => {
  setCookie(c, LOGIN_COOKIE, state, { ...base, maxAge: 600 });
};
export const clearLoginCookie = (c: Context<AppEnv>): void => {
  deleteCookie(c, LOGIN_COOKIE, { secure: true, path: "/" });
};

export const isUnsafeMethod = (m: string): boolean =>
  m !== "GET" && m !== "HEAD" && m !== "OPTIONS";

/**
 * CSRF check for cookie-authenticated mutations: browsers always send Origin on a POST, so the
 * Origin must be present and equal to this request's own origin. SameSite=Lax is the second layer.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

/** A relative path on this site, or null. Blocks `//host`, `/\host` and control characters. */
export function safeReturnTo(v: string | undefined): string | null {
  if (!v || v.length > 200) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  return /^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(v) ? v : null;
}
