// Secrets that `wrangler types` cannot see. Each is at least 32 characters, set with `wrangler secret put`.
interface Env {
  BACKUP_KEY?: string;
  BACKUP_KEY_PREVIOUS?: string;
  /** Signs the calls to the API. A key of its own: the MCP worker never holds it. */
  OPS_HMAC_KEY?: string;
  OPS_HMAC_KID?: string;
  OPS_ADMIN_KEY?: string;
  /** Vars. Cloudflare Access in front of the admin surface (required outside dev). */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
declare namespace Cloudflare {
  interface Env {
    BACKUP_KEY?: string;
    BACKUP_KEY_PREVIOUS?: string;
    OPS_HMAC_KEY?: string;
    OPS_HMAC_KID?: string;
    OPS_ADMIN_KEY?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
  }
}
