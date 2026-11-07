/**
 * NEW RECONSTRUCTION. Observed Access metadata from a read-only inventory.
 * These constants are not a live handshake and not permission to call Access.
 * Audiences are per application. They are not interchangeable.
 */

export const ACCESS_ISSUER = "https://tony-walteur.cloudflareaccess.com";
export const ACCESS_JWKS_URL = "https://tony-walteur.cloudflareaccess.com/cdn-cgi/access/certs";
export const API_ACCESS_AUD = "0efbc36f4d84025cc095efdc94f9891dbf90a7d718f5c4e0c2837a7aae0a8974";
export const MCP_ACCESS_AUD = "feb4350db153fcca208d1e398e2f5660ab2abf50f3e1d366464addcda517dd89";

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
