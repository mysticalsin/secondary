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
  /** Secret. Anthropic API key. Unset means the AI processor is off ("AI processor not configured"). */
  ANTHROPIC_API_KEY?: string;
  /** Var. Kill switch: "false" (or 0, off, no) switches the AI processor off. Default on. */
  AI_ENABLED?: string;
  /** Var. Model id. Default claude-sonnet-5-5. */
  AI_MODEL?: string;
  /** Var. Tokens per tenant per UTC day. Default 200000. */
  AI_DAILY_TOKEN_BUDGET?: string;
  /** Var. Per-attempt timeout in ms. Default 30000. */
  AI_TIMEOUT_MS?: string;
}
