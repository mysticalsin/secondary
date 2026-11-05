# Runbook: MCP redirect allowlist and rate limits

The MCP worker is the only internet-facing OAuth server. Two controls sit in its code, and one rule sits in front of it.

## Redirect URIs (B1 L3)

`ALLOWED_REDIRECT_URIS` in `workers/mcp/wrangler.jsonc` lists the callbacks that may receive an authorization code. Each entry is a full URL. `https://claude.ai/api/mcp/auth_callback` matches that path only. An entry ending in `*` matches a path prefix. Loopback entries (`http://localhost/*`) accept any port; every other host must use the default port. A host alone never matches: anyone can register a callback on a shared host such as a custom GPT on `chatgpt.com`, so the path is part of the allowlist.

Before a host is piloted, check the callback it really uses (the consent page shows it) and narrow its entry to that exact URL if it is a prefix. Staging and prod carry no loopback entries. The same check runs at `/register`, at `/authorize` and again when consent is approved. PKCE with S256 is required for every client.

## Rate limits (B1 L4)

The worker counts requests per client address (the address from the edge, kept only as a hash) in `OAUTH_KV`: `/register` 10 a minute and 50 a day per address plus 2000 a day in all, `/token` and `/authorize` 60 a minute. The caps can be changed with `OAUTH_REGISTER_PER_MIN`, `OAUTH_REGISTER_PER_DAY`, `OAUTH_REGISTER_GLOBAL_PER_DAY`, `OAUTH_TOKEN_PER_MIN` and `OAUTH_AUTHORIZE_PER_MIN`. A refusal is 429 with `Retry-After`. KV counters are not atomic, so a burst can slip a few requests through.

In front of it, add one Cloudflare rate limiting rule on the MCP host for the paths `/register`, `/authorize` and `/token` (for example 30 requests a minute per address, action block for a minute). It stops a flood before the worker runs and counts exactly. This is a dashboard or Terraform setting, so it is a step of the MCP pilot checklist, not part of the repository.

Unauthenticated API paths (token verification, the dev seed route) sit behind Cloudflare Access; the seed route has its own counter in the API.
