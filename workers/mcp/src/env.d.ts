// Bindings that `wrangler types` cannot know: secrets and the helper object the OAuth provider injects.
// Augments both the global Env (used in this worker) and Cloudflare.Env (library defaults).
interface Env {
  /** Secret. HMAC key shared with workers/api for internal service auth (>= 32 chars). */
  INTERNAL_HMAC_KEY: string;
  /** Var. Key id of INTERNAL_HMAC_KEY (default k1). */
  INTERNAL_HMAC_KID?: string;
  /** Secret (at least 32 characters). Append-only key for workers/audit. */
  AUDIT_KEY_MCP?: string;
  /** Var. Comma separated redirect URIs allowed to receive codes: exact URLs, or a path prefix ending in `*`. */
  ALLOWED_REDIRECT_URIS?: string;
  /** Vars. Rate limit overrides per client address, see src/rate-limit.ts. */
  OAUTH_REGISTER_PER_MIN?: string;
  OAUTH_REGISTER_PER_DAY?: string;
  OAUTH_REGISTER_GLOBAL_PER_DAY?: string;
  OAUTH_TOKEN_PER_MIN?: string;
  OAUTH_AUTHORIZE_PER_MIN?: string;
  /** Test seam: how long the kill switch answer is cached, in ms. Default 5000. */
  SWITCH_CACHE_MS?: string;
  /** Injected by OAuthProvider into the default handler. */
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}
declare namespace Cloudflare {
  interface Env {
    INTERNAL_HMAC_KEY: string;
    INTERNAL_HMAC_KID?: string;
    AUDIT_KEY_MCP?: string;
    SWITCH_CACHE_MS?: string;
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
