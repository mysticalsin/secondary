// Secrets that `wrangler types` cannot see. Each is at least 32 characters, set with `wrangler secret put`.
interface Env {
  /** Append key held by workers/api. */
  AUDIT_KEY_API?: string;
  /** Append key held by workers/mcp. */
  AUDIT_KEY_MCP?: string;
  /** Read key held by workers/api only. */
  AUDIT_KEY_READ?: string;
  /** Erase key held by workers/api only. Allows pseudonymising a principal id in stored receipts. */
  AUDIT_KEY_ERASE?: string;
}
// The same secrets on Cloudflare.Env, which `cloudflare:workers` uses (wrangler types splits the two once env blocks exist).
declare namespace Cloudflare {
  interface Env {
    AUDIT_KEY_API: string;
    AUDIT_KEY_MCP: string;
    AUDIT_KEY_READ: string;
    AUDIT_KEY_ERASE: string;
  }
}
