// Secrets that `wrangler types` cannot see.
interface Env {
  /** Secret. Entra app client secret for the app-only Sites.Selected client. */
  GRAPH_CLIENT_SECRET?: string;
  /** Secret (at least 32 characters). Shared with workers/api. Signs calls in both directions. */
  CONNECTOR_HMAC_KEY?: string;
  /** Vars. Key id of the key (default k1) and, during a rotation, the previous key and its id (default k0). */
  CONNECTOR_HMAC_KID?: string;
  CONNECTOR_HMAC_KEY_PREVIOUS?: string;
  CONNECTOR_HMAC_KID_PREVIOUS?: string;
}
