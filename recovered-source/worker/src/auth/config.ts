// Auth configuration read from the environment. Everything is optional: with no Entra values the
// Entra login is off and Cloudflare Access (the default AUTH_MODE) is the only identity source.

import { asciiLower, normalEmail } from "../../../../src/state/actor.ts";

export type AuthMode = "access" | "entra" | "both";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const authMode = (env: Env): AuthMode => {
  const m = env.AUTH_MODE?.trim().toLowerCase();
  return m === "entra" || m === "both" ? m : "access";
};

/** Whether the Cloudflare Access JWT (and the local dev bypass) may identify a request. */
export const accessAllowed = (env: Env): boolean => authMode(env) !== "entra";

export type EntraConfig = { tenantId: string; clientId: string; clientSecret: string };

/** All three values must be present and well formed. Anything less disables Entra login. */
export function entraConfig(env: Env): EntraConfig | null {
  const tenantId = env.ENTRA_TENANT_ID ? asciiLower(env.ENTRA_TENANT_ID.trim()) : undefined;
  const clientId = env.ENTRA_CLIENT_ID ? asciiLower(env.ENTRA_CLIENT_ID.trim()) : undefined;
  const clientSecret = env.ENTRA_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  if (!GUID.test(tenantId) || !GUID.test(clientId)) return null;
  return { tenantId, clientId, clientSecret };
}

export const entraEnabled = (env: Env): boolean =>
  authMode(env) !== "access" && entraConfig(env) !== null;

/** The tenant whose Durable Object holds pre-login state and the SCIM directory. */
export const directoryTenant = (env: Env): string | null => {
  const t = (env.SCIM_TENANT_ID?.trim() || env.DEFAULT_TENANT_ID || "").trim();
  return /^[a-z0-9_]{3,64}$/.test(t) ? t : null;
};

const SCIM_MIN_TOKEN = 32;
/** SCIM is on (a long enough bearer token is set): the directory manages who may sign in (H-02). */
export const scimConfigured = (env: Env): boolean =>
  (env.SCIM_TOKEN ?? "").length >= SCIM_MIN_TOKEN;

/** B2B guests are refused unless ENTRA_ALLOW_GUESTS is "yes" or "true" (H-01). */
export const allowGuests = (env: Env): boolean =>
  ["yes", "true"].includes((env.ENTRA_ALLOW_GUESTS ?? "").trim().toLowerCase());

/**
 * Emails whose Cloudflare Access (or MCP) identity may use the principal an Entra sign-in is bound
 * to. Anything else is a different identity source and is refused: `ACCESS_LINKED_EMAILS` is the
 * explicit link, a comma separated list.
 */
export const accessLinked = (env: Env, email: string): boolean => {
  const needle = normalEmail(email);
  if (!needle) return false;
  return (env.ACCESS_LINKED_EMAILS ?? "").split(",").some((e) => normalEmail(e) === needle);
};
