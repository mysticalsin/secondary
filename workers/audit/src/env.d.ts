// Secrets that `wrangler types` cannot see. Each is at least 32 characters, set with `wrangler secret put`.
interface Env {
  /** Append key held by workers/api. */
  AUDIT_KEY_API?: string;
  /** Append key held by workers/mcp. */
  AUDIT_KEY_MCP?: string;
  /** Read key held by workers/api only. */
  AUDIT_KEY_READ?: string;
}
