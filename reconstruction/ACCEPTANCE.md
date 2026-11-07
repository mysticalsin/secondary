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

Recovered `POST /v1/genui/plan` looks up `nodeId` in the admitted org view. `buildOrg` creates `pb:<id>` only for `personalOwners`, and the dev seed sets that list to the canonical `u_<role>` principals. A non-seed email, including a plus-address, is `principalIdFor` of the whole address. `forNode` returns null, and the route answers 404. Adding that id to `personalOwners` would run `buildPersonalBrain`, which fabricates three synthetic items, and copying a persona's memberships would grant company roles from the mailbox prefix. Neither change was made. The own-brain page reads the personal workspace instead.

A normal `tools/call` does not carry the caller's model usage. Missing external usage stays unknown, not zero. Client-reported numbers are `client_reported`, never provider-verified. `provider_reported` is set only by the server synthetic fixture adapter, with `providerVerified: false`. Streaming snapshots replace a per-request total. A retried provider request is a separate event from an idempotent import. Cost stays unknown. The served dev MCP bundle is `reconstruction/mcp/worker/src/import-entry.ts`. Recovered `index.ts` is not that bundle. The protected-dev client entry is `reconstruction/release/entry.ts`. The fixture server on port 43131 is not that edge. `/harness/*` and the dev identity headers are local-only and are not a production entry. The pinned OAuth library accepts an `http` resource only on a loopback host, so the positive edge proof dispatches to `http://127.0.0.1` on the release worker. The MCP worker in that proof is `ENVIRONMENT=dev`, so its local consent header still works after the edge forwards the request. A non-dev MCP worker rejects that header. That is not an Access login.

## 1. Personal brain

| Check | Where | Status |
| --- | --- | --- |
| Seeded `u_consultant` personal plan `pb:u_consultant` | Recovered planner, reconstruction fixture | PASS |
| Plus-address principal has no org-graph personal node. Recovered `POST /v1/genui/plan` for `pb:<that id>` stays 404. The id is not added to `personalOwners`, so no fabricated seed tasks and no company role is copied from the mailbox prefix | Recovered `planView` / `buildPersonalBrain`. Fixture `recovered routes replace the synthetic gap and the genui flow stays on the session` | FAIL closed |
| Another owner and a tenant query cannot read that plan | Recovered view | PASS |
| New synthetic users `ada@tenant-a.test` and `bob@tenant-b.test` each get a durable personal workspace that is not `u_consultant` | Reconstruction gate over recovered `POST /v1/personal/items`; workerd `two new users keep separate durable imports across a restart` | PASS |
| Same items are readable after a new workerd process uses the same persistence directory | That test's second boot | PASS |
| Plus-address org-graph plan `pb:<hash>` | Recovered `planView` still has no node. A prefix does not inherit the CEO or consultant membership | FAIL closed |
| Own personal plan for a non-seed owner, including a plus-address, from that person's durable imports. This is a notes view, not model GenUI. Empty context stays empty. Coverage is partial when only 20 of more than 100 notes are loaded | `new owners get their own personal plan and not a seed org plan` and `the release edge personal page shows only that token's context` | PASS |
| Release import form stores the posted id, version, and text, confirms the read-back, and keeps duplicate, conflict, and a higher version distinct. Usage stays unknown. Another token does not see those rows | `the release edge personal page shows only that token's context` | PASS |

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
| Cross-user read of a guessed or real id is `not_found`; stored markers are denied in both directions, including Cara in Ada's tenant and Bob in the other tenant | That roundtrip test | PASS |
| Receipt hash matches an independent SHA-256 of the source text | That roundtrip test | PASS |
| Forged principal, tenant, brain, usage, and request id do not change the receipt | That roundtrip test | PASS |
| The same id, hash, version, and request id are returned by a signed read of `/harness/import` | That roundtrip test | PASS |
| Receipts and text survive a new workerd process | That roundtrip test's second boot | PASS |
| Hosted Dust or Claude handshake | Needs a protected public endpoint | NOTRUN |

## 4. Token ledger

| Check | Where | Status |
| --- | --- | --- |
| Import operation is ledgered with `trust: "unknown"` and null tokens, not 0 | `two OAuth users roundtrip import receipts through MCP and the same gate` | PASS |
| Client report persists as `client_reported` with `providerVerified: false` and is readable by `usage_lookup` | That roundtrip test | PASS |
| Server-measured zero fixture is 0; cancelled fixture stays null | That roundtrip test | PASS |
| Same event id and payload is idempotent; a conflicting payload is `conflict` | That roundtrip test; `usage reports reject extra fields, bad totals, and keep unknown distinct from zero`; `stream snapshots replace totals and a conflicting replay does not add` | PASS |
| Cumulative stream replaces totals; a distinct provider request stays separate; a client description does not add those tokens again | Those tests | PASS |
| Another user's request id is `not_found`; a read token cannot report | That roundtrip test | PASS |
| Ledger rows survive a new workerd process. The new process uses a new OAuth token | That roundtrip test's second boot | PASS |
| Live provider-verified billing | No live model call | NOTRUN |
| Old OAuth token still works after restart | Restart tests mint a new token | NOTRUN |

## 5. Observability

| Check | Where | Status |
| --- | --- | --- |
| Settings page, Mantu palette, unknown freshness, audit 403, save 503 | Reconstruction UI | PASS |
| Usage tab reads the session ledger, and a session switch does not keep the previous person's events | Reconstruction Observability page | PASS |
| Status, Agents, Audit, and Preferences remain | That page | PASS |
| Activity tab imports local `relay.codex-review-run/1` NDJSON for the signed-in user, searches and filters it, opens one record, and clears it for another token. Null counts stay null. Notes and evidence paths are text. `trusted_runtime_capture` stays false. A conflicting duplicate and a malformed line do not overwrite. The schema file hash is `7ec06819c880305c91c7eba47b383715c765810c4dcbe4e8380f0d6348993fbb` | `the review schema hash is pinned and extra fields fail closed`, `synthetic review imports stay with the signed-in user`, and `the release activity page escapes notes and clears across tokens` | PASS for synthetic fixtures only |
| The parent's three historical review records rendered in this environment | Those rows were not attached and were not fetched. The offline HTML file also starts empty | NOTRUN |
| Offline paste page bytes stay the exported build | SHA-256 `0efa28faac2b0818831e9b651ee8a713515c82c17bae47ac2b3816212ae3fdd0` of `reconstruction/activity/offline/index.html`. The typed label is not authentication | PASS as a byte pin, not a three-row render |

## 6. Deployment

| Check | Where | Status |
| --- | --- | --- |
| Protected non-production preview, bindings, rollback | Not executed | NOTRUN |
| Production deploy, merge, spend, live provider | Disallowed | NOTRUN |
| Protected-dev edge rejects dev email headers, closes `/harness/*` and fixture routes, and verifies a local test JWT for issuer, audience, signature, and expiry | `protected-dev edge ignores dev headers and closes harness routes` | PASS |
| MCP `/mcp` without a bearer is a machine 401 when `ENVIRONMENT` is not dev | `mcp tools stay a machine 401 when dev email is not a configured identity` | PASS |
| Local test issuer rejects a mismatched resource. The first refresh token is rejected after two rotations. The pinned SDK still accepts the immediately previous refresh token once, so this is not strict one-use | `a local test issuer rejects the wrong resource and rotates refresh tokens` | PASS |
| Non-dev release edge and MCP consent verify a local RS256 JWT by fetching an allowlisted loopback JWKS. Browser audience, MCP consent audience, and the OAuth resource are different. Dev email and persona headers do not authenticate. A redirect or JWKS outage is 503 and is not followed | `non-dev consent uses a fetched JWT and ignores dev headers` and `JWKS redirect and outage fail closed without following the redirect` | PASS |
| Live Access or Entra issuer, a JWT signed by Cloudflare, and a public route | The committed edge config has empty auth settings. The public cert file is not the validator's key set. Numeric `nbf` has no Access claim sample, so production claim compatibility is UNKNOWN | NOTRUN |
| Fetched-JWKS activity import, search, filter, detail, reload, and restart stay with one principal. Same-tenant Cara and cross-tenant Bob do not see the row. A second edge whose admission map omits the domain returns 403 and not the row. API `ENVIRONMENT` is `reconstruction` with `LOCAL_DO_SHIM=workerd` | `fetched JWKS activity stays with one principal across reload and admission` | PASS for synthetic records. The older dev-environment activity fixture remains a separate test |
| Local JWKS cache `max-age=1` expires on a 3 second wall clock. The next outage is 503 and does not return the stored row. Private parameters, a duplicate `kid`, and five keys are refused. Removing key A leaves key B able to read the same principal. A token whose `exp` is already in the past is 401. The node cache test advances the verifier clock 1.5 seconds inside a 600 second token and is labelled as a cache clock | `JWKS cache expiry, outage, recovery, and old-key removal use the verifier clock only for cache` and `a labelled cache clock expires the JWKS cache without expiring the JWT` | PASS as a local fixture. Not Cloudflare rotation |
| Non-dev consent POST from another origin is 403 and does not consume the handle. A different subject's JWT cannot finish that handle. Approving only `secondary.read` makes `personal_import` `insufficient_scope` and leaves `usage_lookup` allowed | `non-dev consent rejects cross-origin, a switched user, and a read-only grant` | PASS |
| Private API with EU Durable Object jurisdiction on workerd | `ns.jurisdiction("eu")` throws in workerd. `LOCAL_DO_SHIM=workerd` only skips that call and is not in the committed config. It is not an identity bypass | NOTRUN |
| OAuth access token expires on the wall clock. The pinned provider rejects a TTL under 60 seconds, so the test sets `accessTokenTTL` to 60 and waits 62 seconds. It is valid before that and `invalid_token` after. No clock was forged | `a 60 second access token expires on the wall clock` | PASS |

## 7. Review gaps still open

| Check | Where | Status |
| --- | --- | --- |
| More than 100 receipts, an older retry, paged coverage, and concurrent same-body or conflicting imports | `imports and usage stay unique past 100 rows and across concurrent retries` | PASS |
| Validated client id, not the request body, namespaces a receipt. A second signed client or a second user does not overwrite it | `imports and usage stay unique past 100 rows and across concurrent retries`. The two client ids are signed internal principals. Two OAuth dynamic-registration clients for one user were not registered | PASS |
| Two OAuth dynamic-registration clients for one verified user, each with its own PKCE grant, through the release edge. Dedup is principal plus that client id. A body client id does not overwrite. Both clients can read that user's notes. Another user cannot | `two OAuth clients keep separate receipts for one user and survive restart` | PASS |
| A stored `server_measured` / `server_clock` row stays a measured zero. New synthetic fixtures are not relabeled onto it | `usage reports reject extra fields, bad totals, and keep unknown distinct from zero` | PASS |
| Receipt hash checked with `node:crypto` `createHash`, not the importer's own helper | `two OAuth users roundtrip import receipts through MCP and the same gate` | PASS |
| Same-tenant Cara cannot read Ada's usage request or reuse Ada's usage event id | That roundtrip test | PASS |
| Release edge serves captured shell bytes and the Mantu Observability page, and MCP initialize/import/ledger go through that edge | `the release edge is the only client path for pages and MCP` | PASS |
| Encoded harness paths, repeated slash, case, query path, `X-Original-URL`, method override, import cross-origin, future `nbf`, `alg: none`, a bad signature with the same `kid`, and `Cf-Access-Jwt-Assertion` agreement | `protected-dev edge ignores dev headers and closes harness routes` | PASS |
| A configured JWKS that contains a private-key field is refused. An unknown local `kid` is refused. This is not a fetch of the live certs | `API and MCP audiences stay distinct and a JWKS failure stays closed` | PASS |
| Public Access cert endpoint returned HTTP 200 on 2026-11-07 15:33:55 America/Sao_Paulo. 5116 bytes, SHA-256 `b5536252ff8227a04307334611fabaee5f2df05dec40b52f2498bed687760c66`. Two RSA-2048 RS256 signature keys, no private fields, cache `max-age=14400` and `must-revalidate`. This snapshot is not a production pin | `the observed public cert document is a format check, not an identity pin` | PASS |
| A live Access JWT, signature acceptance against the Cloudflare certs, key rotation on Cloudflare, admission of a real user, and a real browser login | The local rotation and outage tests use a fixture JWKS server. They are not Cloudflare rotation | NOTRUN |
| Wrong OAuth resource, audience, expiry, refresh rotation, or a real identity provider | Local dev issuer only | NOTRUN |
| Installed `@modelcontextprotocol/sdk` is 1.32.2 and public `registerTool` refuses a second `personal_note_create` | `the MCP SDK pin cannot replace a tool through the public registerTool API` | PASS |
| If the pinned SDK no longer exposes `personal_note_create.remove`, the MCP entry throws `mcp_tool_map_unsupported` instead of serving the untracked tool. An upgrade was not run | `the MCP SDK pin cannot replace a tool through the public registerTool API` | PASS as a guard, upgrade NOTRUN |
| OAuth KV survives a new workerd on the same persistence directory. The unrevoked token and its scope still work. A revoked refresh grant stays revoked after the next workerd. The immediately previous refresh token works once. The first refresh token is `invalid_grant` after two rotations | `two OAuth clients keep separate receipts for one user and survive restart` | PASS |
| Production entry without `/harness/*` or dev synthetic identity | Local harness only | NOTRUN |
| Hosted Dust or Claude, production auth review, protected Cloudflare preview | Not run | NOTRUN |
