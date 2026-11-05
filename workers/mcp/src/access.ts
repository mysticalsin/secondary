import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { isDev } from "./config.ts";

export interface Identity {
  /** Opaque stable id (Access `sub`). */
  sub: string;
  email: string;
  /** Dev test mode only. */
  persona?: string;
}

/** Key source for Access JWTs. Tests replace `resolve` with a local key set. */
export const accessKeys: { resolve: (teamDomain: string) => JWTVerifyGetKey } = {
  resolve: (teamDomain) =>
    createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`)),
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

function keysFor(teamDomain: string): JWTVerifyGetKey {
  let k = jwksCache.get(teamDomain);
  if (!k) {
    k = accessKeys.resolve(teamDomain);
    jwksCache.set(teamDomain, k);
  }
  return k;
}

/** Test hook: forget cached key sets after swapping `accessKeys.resolve`. */
export function resetAccessKeyCache(): void {
  jwksCache.clear();
}

/** Verify a Cloudflare Access JWT (signature, issuer, audience, expiry). Returns null on any failure. */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, keysFor(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!payload.sub || !email) return null;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}

/**
 * Who is at /authorize. Cloudflare Access sits in front of the path and sets `Cf-Access-Jwt-Assertion`;
 * we verify it again here (never trust the edge header unverified).
 *
 * Dev test mode: only when ENVIRONMENT=dev AND no Access team domain is configured, the headers
 * `X-Dev-Email` and optional `X-Dev-Persona` stand in for Access, so a scripted client or MCP
 * Inspector can run the flow locally. Both are ignored everywhere else.
 */
export async function authenticate(request: Request, env: Env): Promise<Identity | null> {
  const team = (env.ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.ACCESS_AUD ?? "").trim();
  if (team && aud) {
    const token = request.headers.get("cf-access-jwt-assertion");
    return token ? verifyAccessJwt(token, team, aud) : null;
  }
  if (isDev(env) && !team) {
    const email = request.headers.get("x-dev-email")?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
    const persona = request.headers.get("x-dev-persona")?.trim() || undefined;
    // Opaque id, so the OAuth store never holds the address in clear (grant userId is storage-visible).
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    const sub = `dev-${Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    return { sub, email, ...(persona ? { persona } : {}) };
  }
  return null;
}
