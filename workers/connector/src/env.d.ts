// Secrets that `wrangler types` cannot see.
interface Env {
  /** Secret. Entra app client secret for the app-only Sites.Selected client. */
  GRAPH_CLIENT_SECRET?: string;
  /** Secret (at least 32 characters). Shared with workers/api. Signs calls in both directions. */
  CONNECTOR_HMAC_KEY?: string;
}
