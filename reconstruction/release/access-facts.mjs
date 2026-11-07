/**
 * NEW RECONSTRUCTION. Observed Access metadata from a read-only inventory.
 * These constants are not a live handshake and not permission to call Access.
 * Audiences are per application. They are not interchangeable.
 */

export const ACCESS_ISSUER = "https://tony-walteur.cloudflareaccess.com";
export const ACCESS_JWKS_URL = "https://tony-walteur.cloudflareaccess.com/cdn-cgi/access/certs";
export const API_ACCESS_AUD = "0efbc36f4d84025cc095efdc94f9891dbf90a7d718f5c4e0c2837a7aae0a8974";
export const MCP_ACCESS_AUD = "feb4350db153fcca208d1e398e2f5660ab2abf50f3e1d366464addcda517dd89";

/**
 * Point-in-time public document fetched 2026-11-07 15:33:55 America/Sao_Paulo.
 * HTTP 200, 5116 bytes, no credentials. This is not a production key pin.
 * The release worker's AUTH_ISSUER and AUTH_AUDIENCE stay blank.
 */
export const OBSERVED_PUBLIC_JWKS = {
  url: ACCESS_JWKS_URL,
  status: 200,
  bytes: 5116,
  sha256: "b5536252ff8227a04307334611fabaee5f2df05dec40b52f2498bed687760c66",
  fetchedAt: "2026-11-07T18:33:55.000Z",
  cache: { public: true, maxAgeSeconds: 14400, mustRevalidate: true, noTransform: true },
  kids: [
    "624580a63655f3d7a5b62dd0f4b7474ce0341422b8c443e14727a6f152def4cf",
    "882f5fb90ae95c319d655cb16bb7ab917a157234fcea0bae7d75e8766fa4d331",
  ],
  alg: "RS256",
  kty: "RSA",
  use: "sig",
  privateFields: false,
  identityAccepted: false,
};

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"];

export function jwksCacheFresh({ fetchedAtMs, nowMs, maxAgeSeconds, mustRevalidate }) {
  if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(nowMs) || nowMs < fetchedAtMs) return false;
  const age = nowMs - fetchedAtMs;
  if (age >= maxAgeSeconds * 1000) return false;
  if (mustRevalidate && age >= maxAgeSeconds * 1000) return false;
  return true;
}

export function classifyPublicJwk({ origin, keys, kid }) {
  if (origin !== ACCESS_JWKS_URL) return { ok: false, reason: "jwks_url_not_allowlisted" };
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: "jwks_unavailable" };
  const key = keys.find((item) => item && item.kid === kid);
  if (!key) return { ok: false, reason: "unknown_kid" };
  if (PRIVATE_JWK_FIELDS.some((name) => Object.hasOwn(key, name))) return { ok: false, reason: "private_key_field" };
  if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig") return { ok: false, reason: "unexpected_key" };
  return { ok: true, reason: "public_key_format" };
}

const ALLOWED = new Set([ACCESS_JWKS_URL]);

export function assertAllowlistedJwksUrl(url) {
  if (!ALLOWED.has(url)) {
    const error = new Error("jwks_url_not_allowlisted");
    error.reason = "jwks_url_not_allowlisted";
    throw error;
  }
  return url;
}

export async function loadAllowlistedJwks(url, fetchImpl = fetch) {
  assertAllowlistedJwksUrl(url);
  let response;
  try {
    response = await fetchImpl(url, { method: "GET" });
  } catch {
    const error = new Error("jwks_unavailable");
    error.reason = "jwks_unavailable";
    throw error;
  }
  if (!response?.ok) {
    const error = new Error("jwks_unavailable");
    error.reason = "jwks_unavailable";
    throw error;
  }
  const body = await response.json();
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
    const error = new Error("jwks_unavailable");
    error.reason = "jwks_unavailable";
    throw error;
  }
  return body;
}
