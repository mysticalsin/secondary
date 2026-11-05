# workers/mcp: Secondary MCP server

Remote MCP server (Streamable HTTP) that Tony can add to Claude, Claude Code, ChatGPT or Dust. Worker name `secondary-mcp-dev`, endpoint `/mcp`. Tools read or draft only. Everything a tool returns comes from `workers/api` as the signed-in user, so policy applies exactly as in the web app. Synthetic data only until the activation gate.

Built on `agents` 0.33 (`createMcpHandler`, stateless), `@cloudflare/workers-oauth-provider` 1.2.4, `@modelcontextprotocol/server` 2.4 and `@modelcontextprotocol/ext-apps` 2.0.

## Endpoints

| Path                                        | What                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/mcp`                                      | MCP, Streamable HTTP. Needs `Authorization: Bearer`. 401 carries `WWW-Authenticate` with `resource_metadata`; 403 `insufficient_scope` names the missing scopes. |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata                                                                                                                                                |
| `/.well-known/oauth-authorization-server`   | RFC 8414 metadata                                                                                                                                                |
| `/authorize`                                | Consent page. Behind Cloudflare Access.                                                                                                                          |
| `/token`, `/register`                       | OAuth token and Dynamic Client Registration. Client ID Metadata Documents are also accepted.                                                                     |
| `/health`                                   | no auth                                                                                                                                                          |

## Tools and scopes

| Tool                                                                                                                      | Scopes (all needed)                          |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `whoami`, `search(q)`, `get_map(lens)`, `get_node(id)`, `get_account(id)`, `list_review_queue()`, `render_view(viewPlan)` | `secondary.read`                             |
| `personal_note_create(title, body)`                                                                                       | `secondary.read`, `secondary.personal.write` |
| `contribute(personalItemId, targetScopeId)`                                                                               | `secondary.read`, `secondary.contribute`     |

No tool approves, deletes or changes membership. `contribute` only creates a candidate in review.

Wiki tools (B3, see `docs/DESIGN-LIVING-WIKI.md`): `wiki_search(q, workspace?)` and `wiki_read(workspace, page)` need `secondary.read` and answer for the caller, with citations the caller cannot read already removed; `wiki_propose(workspace, title, markdown, pageId?)` needs `secondary.contribute` and creates a review item only. No MCP tool approves a wiki change. A missing scope gets HTTP 403 `insufficient_scope` (the SDK `scopeChallenge`, so hosts can step up), and each tool also refuses on its own as a backstop.

Brain tools (v3, see `docs/DESIGN-BRAINS-V3.md`): `get_brain_guide(brainId)` needs `secondary.read` and returns how a brain is structured (collections, required sections, tone, field definitions, publication mode, conventions), never page text or field values. `coach_propose_structure(brainId, answers)` needs `secondary.contribute`, returns a Structure Coach proposal and is refused for a brain the user does not manage; no tool applies it, the user does that in the web app. Every call carries the OAuth grant id and a host label (Claude.ai, ChatGPT, Dust, ...) in the signed principal, so the API can list connections and revoke them: after a revoke the API answers 403 `connection_revoked` and this worker deletes the grant, so the token is dead at both ends.

`render_view` takes a ViewPlan (see `docs/API-CONTRACT.md`, GenUI). Unknown component types are dropped and reported. The rest must pass the precompiled ViewPlan schema, so inline data (`rows`, `items`, free text) rejects the whole plan. Data is resolved through the API as the caller. The tool is linked to the MCP App `ui://secondary/view`, a single self-contained HTML page (Mantu brand, no external script, style, font or network, strings written with `textContent`). Hosts without MCP Apps get the markdown text result.

The validator is generated: `pnpm --filter @secondary/mcp gen:validator` (ajv standalone, because workerd blocks runtime compile). `pnpm test` fails if the committed file is stale.

## Security model

- Authorization: OAuth 2.1 with PKCE (S256 only). Tokens are bound to the resource `<MCP_PUBLIC_URL>/mcp` (RFC 8707) and the provider rejects any other audience. No other issuer is trusted.
- No token passthrough: the API never sees the host's token. See "Internal service auth" in `docs/API-CONTRACT.md` for the signed principal (`X-Secondary-Principal`, `X-Secondary-Timestamp`, `X-Secondary-Signature`, HMAC key secret `INTERNAL_HMAC_KEY`). The verifier for `workers/api` is `verifyInternalRequest`, exported as `@secondary/mcp/internal-auth`.
- Sign-in: Cloudflare Access sits in front of `/authorize`. The Worker verifies `Cf-Access-Jwt-Assertion` itself with jose (issuer `https://<ACCESS_TEAM_DOMAIN>`, audience `ACCESS_AUD`). Access must protect `/authorize*` only. `/mcp`, `/token`, `/register` and `/.well-known/*` must bypass Access, because hosts cannot do SSO there; they are protected by OAuth.
- Consent page: Mantu branded (purple `#6600AE`, yellow `#F8F060`, Carlito then Calibri, text wordmark "mantu"). Shows client name, publisher domain for metadata-document clients, redirect host and each scope. Approve and deny are a POST. CSRF: a same-origin check plus the provider's one-time consent handle, bound to the browser by a `__Host-` cookie. Strict CSP and `frame-ancestors 'none'`.
- Client allowlist (`ALLOWED_REDIRECT_HOSTS`): checked at registration, at `/authorize` and again at approval. https only, plain http only for `localhost` and `127.0.0.1`. Anything else is refused and audited (`register.rejected`, `authorize.rejected`). An empty list denies everything.
- KV (`OAUTH_KV`) holds OAuth provider state. KV is not EU-restricted. It stores hashed tokens, client records, grant metadata (opaque Access `sub`, client id) and grant props encrypted with a key only the token holder can unwrap. No Secondary content is stored. A test reads every KV entry and asserts no plaintext token, email or note text.
- Audit: every tool call writes a receipt through the `AUDIT` binding (who as opaque id, client id, tool, ids, result count, outcome; never content). If the audit write fails the tool returns `audit_unavailable` and no data.
- Dev test mode: only when `ENVIRONMENT=dev`, `ACCESS_TEAM_DOMAIN` is empty AND the request host is `localhost` or `127.0.0.1`, `X-Dev-Email` (and optional `X-Dev-Persona`) stand in for Access at `/authorize`. On any other host the headers are ignored and `/authorize` answers 401 until Access is configured (tested; a deployed dev worker is public). Outside dev, `MCP_PUBLIC_URL` must be set or every request fails with 500.
- No CORS: hosts call server to server.

## Configuration

`wrangler.jsonc` vars: `ENVIRONMENT`, `MCP_PUBLIC_URL` (canonical origin, required outside dev), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_REDIRECT_HOSTS`. Secrets: `INTERNAL_HMAC_KEY` (same value on `workers/api`) and `AUDIT_KEY_MCP` (append-only key for `workers/audit`); never in a file. Bindings: `OAUTH_KV`, service bindings `API` (`secondary-api-dev`) and `AUDIT` (`secondary-audit-dev`). The KV namespace has no `id` yet: it is created at deploy time, not before. The compatibility flag `global_fetch_strictly_public` is required for safe Client ID Metadata Document fetches.

## Run and test

```sh
corepack pnpm install
corepack pnpm --filter @secondary/mcp test        # validator drift check + Vitest in workerd
corepack pnpm --filter @secondary/mcp typecheck
corepack pnpm --filter @secondary/mcp build       # wrangler deploy --dry-run
```

Local run: `corepack pnpm dev:all` from the repo root starts audit, api and mcp with working service bindings and generates the local secrets (see the root README). Point MCP Inspector (or any client) at `http://localhost:8788/mcp`; `corepack pnpm e2e:mcp` runs a scripted host against it. At `/authorize` send `X-Dev-Email: someone@example.invalid` (for example with a header-injecting browser extension, or script the code flow with PKCE). Dynamic registration with `http://localhost:<port>/...` redirect URIs is allowed.

## Add it to a host

All four are "to verify after deploy". Replace `<host>` with the deployed `MCP_PUBLIC_URL` host. Access must be configured first (see Security model).

- **Claude (claude.ai, Desktop):** Settings > Connectors > Add custom connector, name `Secondary`, URL `https://<host>/mcp`, then Connect and approve on the consent page. On Team and Enterprise plans an owner adds it first. To verify after deploy.
- **Claude Code:** `claude mcp add --transport http secondary https://<host>/mcp`, then run `/mcp` inside Claude Code and choose Authenticate. To verify after deploy.
- **ChatGPT:** Settings > Connectors > Advanced > Developer mode, then create a connector with MCP server URL `https://<host>/mcp` and OAuth authentication. Developer mode and workspace admin settings may be required. To verify after deploy.
- **Dust:** workspace admin adds a remote MCP server with URL `https://<host>/mcp` and OAuth, then attaches it to chosen agents. Per standing rules, do not touch existing Dust agents or workspace settings without Tony. To verify after deploy.

## Notes on versions

- `agents` 0.33 `createMcpHandler` takes an SDK v2 server factory, so this worker uses `@modelcontextprotocol/server` 2.4 (the brief named `@modelcontextprotocol/sdk`, which is the v1 line and only a legacy peer here).
- `registerAppTool` has no `scopeChallenge` option, so the scope gate is attached afterwards with `RegisteredTool.update`.
- The MCP App handshake (`ui/initialize`, `ui/notifications/tool-result`) is written inline for protocol version `2026-01-26` to avoid bundling the ext-apps client.
- `workers-oauth-provider` 1.2 ships its own consent helpers and CIMD support, so the consent flow uses `beginConsent` and `approveConsent`.

## Not done here

No deploy, no Cloudflare resources, no merge. The `workers/api` verifier, the real audit write path and the Access application are for the integrator. The MCP App was exercised in a browser against a fake host, not against Claude or ChatGPT.
