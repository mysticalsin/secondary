// Auth configuration read from the environment. Everything is optional: with no Entra values the
// Entra login is off and Cloudflare Access (the default AUTH_MODE) is the only identity source.

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
  const tenantId = env.ENTRA_TENANT_ID?.trim().toLowerCase();
  const clientId = env.ENTRA_CLIENT_ID?.trim().toLowerCase();
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
