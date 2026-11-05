// Values that are not in wrangler.jsonc (secrets and local-only vars), so `wrangler types` cannot see them.
interface Env {
  /** Secret. Required by POST /v1/admin/seed. */
  SEED_TOKEN?: string;
  /** Secret (at least 32 characters). Shared with workers/mcp to verify signed internal calls. */
  INTERNAL_HMAC_KEY?: string;
  /** Vars. Key id of INTERNAL_HMAC_KEY (default k1) and, during a rotation, the previous key and its id (default k0). */
  INTERNAL_HMAC_KID?: string;
  INTERNAL_HMAC_KEY_PREVIOUS?: string;
  INTERNAL_HMAC_KID_PREVIOUS?: string;
  /** Secret (at least 32 characters). Shared with workers/ops only, never with the MCP worker. Signs the full export, restore and retention calls. */
  OPS_HMAC_KEY?: string;
  OPS_HMAC_KID?: string;
  OPS_HMAC_KEY_PREVIOUS?: string;
  OPS_HMAC_KID_PREVIOUS?: string;
  CONNECTOR_HMAC_KID?: string;
  CONNECTOR_HMAC_KEY_PREVIOUS?: string;
  CONNECTOR_HMAC_KID_PREVIOUS?: string;
  /** Secrets (at least 32 characters). Authenticate this worker to workers/audit. */
  AUDIT_KEY_API?: string;
  AUDIT_KEY_READ?: string;
  /** Secret (at least 32 characters). Keys the pseudonyms that replace a person's id on erasure. */
  PSEUDONYM_KEY?: string;
  /** Secret (at least 32 characters). Lets this worker ask workers/audit to pseudonymise receipts. */
  AUDIT_KEY_ERASE?: string;
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
  /** Var. "yes" lets Entra B2B guests sign in. Default: guests are refused. */
  ENTRA_ALLOW_GUESTS?: string;
  /** Var. Comma separated emails whose Access/MCP identity may use an Entra-bound principal. */
  ACCESS_LINKED_EMAILS?: string;
  /** Secret (at least 32 characters). Shared with workers/connector: signs calls in both directions. */
  CONNECTOR_HMAC_KEY?: string;
  /** Secret. Anthropic API key. Unset means the AI processor is off ("AI processor not configured"). */
  ANTHROPIC_API_KEY?: string;
  /** Var. Explicit enable: the AI processor is off unless this is "true" (or yes, 1, on). */
  AI_ENABLED?: string;
  /** Var. Must be exactly "approved" (the Anthropic processor contract is signed off) before any AI call. */
  AI_PROCESSOR_CONTRACT?: string;
  /** Var. Model id. Default claude-sonnet-5-5. */
  AI_MODEL?: string;
  /** Var. Tokens per tenant per UTC day. Default 200000. */
  AI_DAILY_TOKEN_BUDGET?: string;
  /** Var. Per-attempt timeout in ms. Default 30000. */
  AI_TIMEOUT_MS?: string;
}
