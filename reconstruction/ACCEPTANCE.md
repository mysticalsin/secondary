# Acceptance checklist

Local reconstruction only. Statuses are for this branch, not a production-readiness claim.
`PASS` was exercised here. `FAIL` is a known closed gap. `NOTRUN` was not executed.
Recovered code and captured delivery bytes were not edited for the MCP milestone.

Pinned local packages checked against their own files, not against newer docs:
`@cloudflare/workers-oauth-provider@1.2.4`, `agents@0.33.0` (`createMcpHandler`), `@modelcontextprotocol/sdk@1.32.2`.
`createMcpHandler` in this pin is the Streamable HTTP route. A legacy HTTP+SSE server was not added.
`1.2.4` puts `requiredScopes` on resource metadata and the Bearer challenge. It does not enforce those scopes inside the library. Recovered `tools.ts` `run()` enforces each tool's scope. That enforcement was tested.

Official notes incorporated from the 2026-11-07 research handoff, without running those clients:
Dust admin MCP onboarding and Claude custom connectors are external-client work. OAuth is the per-person path. A shared bearer is a service identity, not an individual. Hosted clients need a machine-usable OAuth endpoint, not a browser-only Access HTML login. `global_fetch_strictly_public` stays off, so Client ID Metadata Documents are not fetched. Dynamic registration on the loopback issuer was used instead. "my cloud" is not confirmed to mean Claude. No universal client is claimed.

A normal `tools/call` does not carry the caller's model usage. Missing external usage stays unknown, not zero. Client-reported numbers would be `client_reported`, never provider-verified. Streaming usage snapshots are cumulative and must not be summed. A retried provider request is a separate usage event from an idempotent import. This round did not build that ledger.

## 1. Personal brain

| Check | Where | Status |
| --- | --- | --- |
| Seeded `u_consultant` personal plan `pb:u_consultant` | Recovered planner, reconstruction fixture | PASS |
| Plus-address principal has no personal node; original 404 kept | Recovered `planView` | FAIL closed |
| Another owner and a tenant query cannot read that plan | Recovered view | PASS |
| New synthetic users `ada@tenant-a.test` and `bob@tenant-b.test` each get a durable personal workspace that is not `u_consultant` | Reconstruction gate over recovered `POST /v1/personal/items`; workerd `two new users keep separate durable imports across a restart` | PASS |
| Same items are readable after a new workerd process uses the same persistence directory | That test's second boot | PASS |
| Plus-address org-graph plan `pb:<hash>` | Recovered `planView` still has no node | FAIL closed |

## 2. Selected import

| Check | Where | Status |
| --- | --- | --- |
| Paste, `.txt`, and `.md` only, max 7000 characters; path, script, executable, oversize, and URL imports rejected before any personal-item write | `import policy accepts text and markdown and rejects the rest`; workerd `two new users keep separate durable imports across a restart` | PASS |
| Same source, version, and hash is one item; a changed same version conflicts; a higher version appends and keeps the previous id | Workerd import test | PASS |
| No cross-tenant text in the other user's list, including the same hash under another external id | Workerd import test | PASS |
| Unsigned call is 401. The seeded consultant imports into `u_consultant` only. A consultant plus-address stays `u_consultant_<hash>` | Workerd import test | PASS |
| Request `principalId` and `tenantId` do not choose the destination | Workerd import test, Ada body names `u_consultant` and `tenant_beta` but the receipt is her own principal in `tenant_alpha` | PASS |
| Synthetic documents only; no vault, mail, or SharePoint | This round | PASS as a constraint |

## 3. MCP

| Check | Where | Status |
| --- | --- | --- |
| No `MCP_PUBLIC_URL` and `user:grant:synthetic` do not reach tools | Recovered `publicBase`, workerd | PASS |
| Loopback PKCE S256, resource, dynamic client, consent | Recovered OAuthProvider in workerd | PASS |
| `initialize`, `tools/list`, allowed `whoami` | Recovered handler plus local API | PASS |
| `whoami` for a second email is not the consultant email | Recovered API | PASS |
| Read token cannot `propose_page`; body is not stored | Recovered scope check | PASS |
| Foreign redirect rejected; cross-origin consent 403 | Recovered allowlist and origin check | PASS |
| Authorization code replay is `invalid_grant` | Provider | PASS |
| Revoked bearer is `invalid_token` on `tools/list` | Provider revocation on `/token` | PASS |
| Forged bearer is `invalid_token` when the issuer is configured | Provider KV lookup | PASS |
| External issuer is not configured (`resolveExternalToken` unset) | Recovered options | PASS |
| Wall-clock expiry of a live token | TTL is 3600; not shortened | NOTRUN |
| Egress to `https://example.invalid` | `dev.outboundService` deny worker | PASS |
| Dust, Claude, or any hosted client handshake | Needs a protected public endpoint | NOTRUN |
| CIMD fetch | Flag intentionally absent | NOTRUN |
| OAuth write token `personal_note_create` stores an import receipt; a read token is `insufficient_scope` and the refused body is not echoed | `PKCE grant initializes, lists tools, and calls whoami for that principal only`; `two OAuth users roundtrip import receipts through MCP and the same gate` | PASS |
| `ada@tenant-a.test` and `bob@tenant-b.test` initialize, list, import, read, and search the same receipt, hash, and version | `two OAuth users roundtrip import receipts through MCP and the same gate` | PASS |
| A read token sees `personal_import` in `tools/list` and still cannot import | That roundtrip test | PASS |
| Cross-user read of a guessed or real id is `not_found`; search does not cross tenants or fall through to company search | That roundtrip test | PASS |
| Forged principal, tenant, brain, usage, and request id do not change the receipt | That roundtrip test | PASS |
| The same id, hash, version, and request id are returned by a signed read of `/harness/import` | That roundtrip test | PASS |
| Receipts and text survive a new workerd process | That roundtrip test's second boot | PASS |
| Hosted Dust or Claude handshake | Needs a protected public endpoint | NOTRUN |

## 4. Token ledger

| Check | Where | Status |
| --- | --- | --- |
| Provider-verified usage when this backend calls a model | No model call this round | NOTRUN |
| Client-reported usage authenticated and not treated as provider-verified | Contract not added | NOTRUN |
| Import receipts record `usage: "unknown"` and do not invent token counts | Workerd import test and import page | PASS |
| Unknown stays unknown; zero is not a substitute | Import path only | PASS for imports, ledger still NOTRUN |
| Cumulative stream snapshots are not summed; retries are separate from import dedupe | Rule recorded | NOTRUN |

## 5. Observability

| Check | Where | Status |
| --- | --- | --- |
| Settings page, Mantu palette, unknown freshness, audit 403, save 503 | Reconstruction UI | PASS |
| Page reads a usage ledger | No ledger | NOTRUN |

## 6. Deployment

| Check | Where | Status |
| --- | --- | --- |
| Protected non-production preview, bindings, rollback | Not executed | NOTRUN |
| Production deploy, merge, spend, live provider | Disallowed | NOTRUN |
