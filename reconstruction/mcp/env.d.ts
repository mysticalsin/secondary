/**
 * NEW RECONSTRUCTION for secondary-mcp-dev. Not recovered source.
 * OAUTH_PROVIDER is the helper the recovered fetch handler calls. No secret values.
 */
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    API: Fetcher;
    AUDIT: Fetcher;
    OAUTH_KV: KVNamespace;
    OAUTH_PROVIDER: OAuthHelpers;
    ENVIRONMENT: string;
    DEFAULT_TENANT_ID: string;
    ACCESS_AUD?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ALLOWED_REDIRECT_URIS?: string;
    AUDIT_KEY_MCP?: string;
    INTERNAL_HMAC_KEY: string;
    INTERNAL_HMAC_KID?: string;
    MCP_PUBLIC_URL?: string;
    SWITCH_CACHE_MS?: string;
  }
}
export {};
