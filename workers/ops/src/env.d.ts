// Secrets that `wrangler types` cannot see. Each is at least 32 characters, set with `wrangler secret put`.
interface Env {
  BACKUP_KEY?: string;
  BACKUP_KEY_PREVIOUS?: string;
  INTERNAL_HMAC_KEY?: string;
  OPS_ADMIN_KEY?: string;
}
declare namespace Cloudflare {
  interface Env {
    BACKUP_KEY?: string;
    BACKUP_KEY_PREVIOUS?: string;
    INTERNAL_HMAC_KEY?: string;
    OPS_ADMIN_KEY?: string;
  }
}
