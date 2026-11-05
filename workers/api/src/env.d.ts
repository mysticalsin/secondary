// Values that are not in wrangler.jsonc (secrets and local-only vars), so `wrangler types` cannot see them.
interface Env {
  /** Secret. Required by POST /v1/admin/seed. */
  SEED_TOKEN?: string;
  /** Secret (at least 32 characters). Shared with workers/mcp to verify signed internal calls. */
  INTERNAL_HMAC_KEY?: string;
  /** Local-dev only. Honoured for localhost hosts in ENVIRONMENT=dev. */
  DEV_AUTH_BYPASS_EMAIL?: string;
}
