/**
 * NEW RECONSTRUCTION. Remote RS256 JWT check for a configured issuer.
 * The worker fetches only an allowlisted certs URL, with redirects refused.
 * A local test issuer is not Cloudflare Access. The observed public JWKS file is not a key pin.
 */
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

export const PRODUCTION_ISSUER = "https://tony-walteur.cloudflareaccess.com";
export const PRODUCTION_JWKS_URL = "https://tony-walteur.cloudflareaccess.com/cdn-cgi/access/certs";
const LOOPBACK_JWKS = /^http:\/\/127\.0\.0\.1(?::\d+)?\/jwks$/;
const MAX_AGE_CAP_SECONDS = 14400;
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"];

const cache = {
  url: "",
  fetchedAt: 0,
  maxAgeSeconds: 0,
  keys: null,
};

export function resetJwksCache() {
  cache.url = "";
  cache.fetchedAt = 0;
  cache.maxAgeSeconds = 0;
  cache.keys = null;
}

export function boundedMaxAge(header) {
  const match = /(?:^|,\s*)max-age=(\d+)/i.exec(String(header ?? ""));
  if (!match) return 60;
  return Math.min(MAX_AGE_CAP_SECONDS, Number(match[1]));
}

function fail(reason) {
  return Object.assign(new Error(reason), { reason });
}

export function resolveJwksTarget(env) {
  const issuer = String(env.AUTH_ISSUER ?? "").trim();
  const jwks = String(env.AUTH_JWKS_URL ?? "").trim();
  if (!issuer || !jwks) throw fail("auth_unconfigured");
  let url;
  try {
    url = new URL(jwks);
  } catch {
    throw fail("jwks_url_not_allowlisted");
  }
  if (url.username || url.password || url.search || url.hash) throw fail("jwks_url_not_allowlisted");
  const href = url.href;
  const production = href === PRODUCTION_JWKS_URL && issuer === PRODUCTION_ISSUER;
  const loopback = LOOPBACK_JWKS.test(href) && env.AUTH_ALLOW_LOOPBACK_JWKS === "local-test";
  if (!production && !loopback) throw fail("jwks_url_not_allowlisted");
  return { issuer, url: href };
}

function publicKeys(body) {
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 4) throw fail("jwks_unavailable");
  const kids = new Set();
  for (const key of body.keys) {
    if (!key || typeof key !== "object") throw fail("jwks_unavailable");
    if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" || typeof key.kid !== "string" || typeof key.n !== "string") {
      throw fail("jwks_unavailable");
    }
    if (kids.has(key.kid)) throw fail("jwks_unavailable");
    kids.add(key.kid);
    if (PRIVATE_FIELDS.some((name) => Object.hasOwn(key, name))) throw fail("jwks_unavailable");
  }
  return body;
}

export async function fetchJwks(env, fetchImpl, now, force) {
  const target = resolveJwksTarget(env);
  if (!force && cache.url === target.url && cache.keys && now < cache.fetchedAt + cache.maxAgeSeconds * 1000) {
    return {
      url: cache.url,
      fetchedAt: cache.fetchedAt,
      maxAgeSeconds: cache.maxAgeSeconds,
      keys: cache.keys,
      target,
      refreshed: false,
    };
  }
  let response;
  try {
    response = await fetchImpl(target.url, { method: "GET", redirect: "manual" });
  } catch {
    throw fail("jwks_unavailable");
  }
  if (response.status >= 300 && response.status < 400) throw fail("jwks_redirect");
  if (!response.ok) throw fail("jwks_unavailable");
  const keys = publicKeys(await response.json());
  cache.url = target.url;
  cache.fetchedAt = now;
  cache.maxAgeSeconds = boundedMaxAge(response.headers.get("cache-control"));
  cache.keys = keys;
  return { url: cache.url, fetchedAt: cache.fetchedAt, maxAgeSeconds: cache.maxAgeSeconds, keys, target, refreshed: true };
}

function presentedToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const assertion = request.headers.get("cf-access-jwt-assertion")?.trim() ?? "";
  const cookie = /(?:^|; )CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? "";
  const values = [bearer, assertion, cookie].filter(Boolean);
  if (values.length === 0) return { ok: false, reason: "unauthorized" };
  if (new Set(values).size !== 1) return { ok: false, reason: "invalid_token" };
  return { ok: true, token: values[0] };
}

export async function verifyRemoteJwt(token, env, audience, fetchImpl = fetch, now = Date.now()) {
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "invalid_token" };
  let loaded;
  try {
    loaded = await fetchJwks(env, fetchImpl, now, false);
    if (!loaded.keys.keys.some((key) => key.kid === header.kid)) {
      loaded = await fetchJwks(env, fetchImpl, now, true);
    }
  } catch (error) {
    const reason = error && typeof error === "object" && "reason" in error && typeof error.reason === "string" ? error.reason : "jwks_unavailable";
    return { ok: false, reason };
  }
  if (!loaded.keys.keys.some((key) => key.kid === header.kid)) return { ok: false, reason: "unknown_kid" };
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(loaded.keys), {
      issuer: loaded.target.issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 0,
      currentDate: new Date(now),
    });
    if (typeof payload.exp !== "number" || typeof payload.nbf !== "number") return { ok: false, reason: "invalid_token" };
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub || sub.length > 128 || !email.includes("@") || email.length > 254) return { ok: false, reason: "invalid_token" };
    return { ok: true, email, sub };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

export function tokenFromRequest(request) {
  return presentedToken(request);
}

export function admittedTenant(email, mapJson) {
  const domain = String(email ?? "").toLowerCase().split("@")[1] ?? "";
  if (!domain) return null;
  let map;
  try {
    map = JSON.parse(String(mapJson ?? ""));
  } catch {
    return null;
  }
  const tenant = map && typeof map === "object" ? map[domain] : undefined;
  if (typeof tenant !== "string" || !/^[a-z0-9_]{3,64}$/.test(tenant)) return null;
  return tenant;
}
