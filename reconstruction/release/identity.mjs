/**
 * NEW RECONSTRUCTION browser identity for the protected-dev edge.
 * Verifies a JWT with jose against keys configured on the worker.
 * It does not fetch a JWK URL and it does not read dev email headers.
 * A passing local test issuer is not production Access or Entra.
 */
import { createLocalJWKSet, jwtVerify } from "jose";
import { verifyRemoteJwt } from "./jwks-validator.mjs";

const PRIVATE = new Set(["d", "p", "q", "dp", "dq", "qi"]);

/**
 * @param {unknown} value
 * @returns {value is { keys: Record<string, unknown>[] }}
 */
function isLocalJwks(value) {
  if (!value || typeof value !== "object" || !("keys" in value) || !Array.isArray(value.keys)) return false;
  return value.keys.every((key) => key && typeof key === "object" && !Array.isArray(key));
}

/**
 * @param {{ AUTH_BROWSER_AUD?: string, AUTH_AUDIENCE?: string }} env
 * @returns {string}
 */
export function browserAudience(env) {
  return String(env.AUTH_BROWSER_AUD ?? env.AUTH_AUDIENCE ?? "").trim();
}

/**
 * @param {string} token
 * @param {{ AUTH_JWKS_URL?: string, LOCAL_JWKS?: string, AUTH_ISSUER?: string, AUTH_BROWSER_AUD?: string, AUTH_AUDIENCE?: string, AUTH_ALLOW_LOOPBACK_JWKS?: string }} env
 * @param {Date} [now]
 * @returns {Promise<{ ok: true, email: string, sub: string } | { ok: false, reason: string }>}
 */
export async function verifyReleaseJwt(token, env, now = new Date()) {
  const remote = String(env.AUTH_JWKS_URL ?? "").trim();
  const local = String(env.LOCAL_JWKS ?? "").trim();
  if (remote && local) return { ok: false, reason: "auth_unconfigured" };
  if (remote) {
    const audience = browserAudience(env);
    if (!audience) return { ok: false, reason: "auth_unconfigured" };
    return verifyRemoteJwt(token, env, audience, fetch, now.getTime());
  }
  const issuer = String(env.AUTH_ISSUER ?? "").trim();
  const audience = browserAudience(env);
  const raw = local;
  if (!issuer || !audience || !raw) return { ok: false, reason: "auth_unconfigured" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "auth_unconfigured" };
  }
  if (!isLocalJwks(parsed) || parsed.keys.length === 0 || parsed.keys.length > 4) {
    return { ok: false, reason: "auth_unconfigured" };
  }
  if (parsed.keys.some((key) => Object.keys(key).some((name) => PRIVATE.has(name)))) {
    return { ok: false, reason: "auth_unconfigured" };
  }
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(parsed), {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 0,
      currentDate: now,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email.includes("@") || email.length > 254) return { ok: false, reason: "invalid_token" };
    return { ok: true, email, sub: typeof payload.sub === "string" ? payload.sub : "" };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
