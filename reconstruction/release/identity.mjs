/**
 * NEW RECONSTRUCTION browser identity for the protected-dev edge.
 * Verifies a JWT with jose against keys configured on the worker.
 * It does not fetch a JWK URL and it does not read dev email headers.
 * A passing local test issuer is not production Access or Entra.
 */
import { createLocalJWKSet, jwtVerify } from "jose";

const PRIVATE = new Set(["d", "p", "q", "dp", "dq", "qi"]);

export async function verifyReleaseJwt(token, env, now = new Date()) {
  const issuer = String(env.AUTH_ISSUER ?? "").trim();
  const audience = String(env.AUTH_AUDIENCE ?? "").trim();
  const raw = String(env.LOCAL_JWKS ?? "").trim();
  if (!issuer || !audience || !raw) return { ok: false, reason: "auth_unconfigured" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "auth_unconfigured" };
  }
  if (!parsed || !Array.isArray(parsed.keys) || parsed.keys.length === 0 || parsed.keys.length > 4) {
    return { ok: false, reason: "auth_unconfigured" };
  }
  if (parsed.keys.some((key) => !key || typeof key !== "object" || Object.keys(key).some((name) => PRIVATE.has(name)))) {
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
