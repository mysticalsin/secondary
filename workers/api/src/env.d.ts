// Values that are not in wrangler.jsonc (secrets and local-only vars), so `wrangler types` cannot see them.
interface Env {
  /** Secret. Required by POST /v1/admin/seed. */
  SEED_TOKEN?: string;
  /** Secret (at least 32 characters). Shared with workers/mcp to verify signed internal calls. */
  INTERNAL_HMAC_KEY?: string;
  /** Secrets (at least 32 characters). Authenticate this worker to workers/audit. */
  AUDIT_KEY_API?: string;
  AUDIT_KEY_READ?: string;
  /** Local-dev only. Honoured for localhost hosts in ENVIRONMENT=dev. */
  DEV_AUTH_BYPASS_EMAIL?: string;
  /** Var. `access` (default), `entra` or `both`: which identity sources are accepted. */
  AUTH_MODE?: string;
  /** Vars. Entra ID app registration (GUIDs). Entra sign-in is off unless all three are set. */
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  /** Secret. The Entra app client secret. */
  ENTRA_CLIENT_SECRET?: string;
  /** Secret (at least 32 characters). Bearer token Entra presents to /scim/v2. SCIM is off without it. */
  SCIM_TOKEN?: string;
  /** Var. Tenant that owns the SCIM directory and pre-login state. Defaults to DEFAULT_TENANT_ID. */
  SCIM_TENANT_ID?: string;
}
