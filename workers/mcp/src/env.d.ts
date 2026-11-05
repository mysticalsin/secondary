// Bindings that `wrangler types` cannot know: secrets and the helper object the OAuth provider injects.
// Augments both the global Env (used in this worker) and Cloudflare.Env (library defaults).
interface Env {
  /** Secret. HMAC key shared with workers/api for internal service auth (>= 32 chars). */
  INTERNAL_HMAC_KEY: string;
  /** Injected by OAuthProvider into the default handler. */
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}
declare namespace Cloudflare {
  interface Env {
    INTERNAL_HMAC_KEY: string;
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
