# B1 interface contract (shared by policy, api, mcp and web agents)

This is the source of truth for cross-package shapes. If a change is needed, update this file first and tell the other agents.

## Two layers (sponsor requirement)

- **Personal Brain (My Secondary).** One per user. It is visible to its owner only and never appears on the Company Map, in search for other users, or to any admin, CEO or auditor role. Content is notes, private briefs, saved views and drafts. A user can "Contribute" a personal item to a Company scope, which creates a candidate copy that enters review. The personal original stays private.
- **Company Brain (Business Secondary).** Holds Company Global, departments and governances, circles, and account workspaces. It is governed by `packages/policy`.

## packages/policy (pure TS, no I/O)

```ts
type ScopeType = 'personal'|'global'|'department'|'circle'|'account'|'region'
type Action = 'view_structure'|'view_content'|'comment'|'contribute'|'edit'|'review'|'approve_release'|'manage_members'|'configure'|'request_access'
interface Grant { scope_type: ScopeType; scope_id: string /* id or '*' */; actions: Action[]; conditions: Record<string, unknown> }
interface Role { id: string; label: string; summary: string; grants: Grant[]; exclusions: string[]; never: string[]; elevation?: {actions: Action[]; hours: number}; breakGlass?: boolean }
interface Principal { id: string; email: string; tenantId: string; roleIds: string[]; memberships: {scope_type: ScopeType; scope_id: string}[] }
interface Ctx { ndaGrants?: string[]; elevatedUntil?: number; now: number }
admittedView(principal, org, ctx): AdmittedView      // the only function that reads raw org data
canDo(principal, org, nodeId, action, ctx): { allowed: boolean; reason: string }
describe(principal, org): { see: string[]; do: string[]; never: string[] }
```

- Personal scope: only `principal.id === owner` is admitted. Every role's grants are ignored for personal scopes, and a test asserts this for every role.
- Roles are ported from `prototypes/company-map/index.html` (CEO, Head of Bid & Pre-sales, Account lead Acme, Consultant Delivery, Knowledge reviewer, Platform admin, Auditor) and kept as data in `packages/policy/src/roles.ts`.
- Org data shape comes from `packages/fixtures` (synthetic) plus the real Mantu structure: 12 governances, 433 use cases, 28 countries in 4 regions, 5 business lines and 7 corporate functions.

## workers/api (Hono, same origin as the web app)

Every response is JSON with `Cache-Control: no-store`. Auth comes from the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), verified against `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` with aud `ACCESS_AUD`. In dev only (`ENVIRONMENT=dev`), the header `X-Demo-Persona: <roleId>` selects a synthetic persona for the signed-in email. In prod the header is ignored, and a test covers this.

| Method | Path | Returns |
|---|---|---|
| GET | /v1/health | `{ok, env, version}` (no auth) |
| GET | /v1/me | `{principal:{id,email,roleIds}, persona, describe:{see,do,never}, env}` |
| GET | /v1/map?lens=departments\|accounts\|topics\|governances | `MapView` (below) |
| GET | /v1/nodes/:id | `NodeDetail` |
| GET | /v1/search?q= | `{results:[{id,label,kind,plane}]}` admitted only |
| GET | /v1/accounts | admitted account cards |
| GET | /v1/accounts/:id | account workspace sections |
| GET | /v1/governances | the 12 governances with stage counts |
| GET | /v1/review | candidates in the caller's review scope |
| POST | /v1/actions | `{nodeId, action, revision?, payload?}` returns `{ok, receiptId}` or 403 `{reason}`. The server re-checks `canDo`, two-person approval and self-approval |
| GET/POST | /v1/personal/items | owner-only Personal Brain items |
| POST | /v1/personal/items/:id/contribute | `{targetScopeId}` creates a candidate in review |
| POST | /v1/genui/plan | `{prompt?, nodeId?}` returns a ViewPlan validated against `view-plan.schema.json` |
| POST | /v1/admin/seed | dev only. Needs a valid Access identity AND header `X-Seed-Token` = secret `SEED_TOKEN` (constant-time compare, 10 attempts per minute per user). Loads fixtures into the DOs |

```ts
MapView = { lens, viewerScopeHash, core:{id,label,topicCount}, hubs: Hub[], links: Link[] }
Hub = { id, label, kind:'department'|'region'|'theme'|'governance', group?, access:'full'|'partial'|'locked', counts:{items,topics,open,gaps,stars}|null, children: MapNode[] }
MapNode = { id, label, kind, plane, access, counts|null, freshnessDays|null, signals:{open:boolean,star:boolean,gap:boolean}, children?: MapNode[] }
NodeDetail = { node: MapNode & {facts:Record<string,string>, badges:string[]}, items:[{title,source,ownerRole,revision,evidence,plane,reviewedBy2}], backlinks:[{id,label,type}], actions:[{action,label,group:'Collaborate'|'Govern'|'Admin',allowed,reason}] }
```

Locked nodes have `counts:null` and no children. Hidden nodes are absent. Structure-only nodes (for example under Platform admin) also have `counts:null`.

Clarifications fixed by `packages/policy` (B1):

- `Link = { from, to, kind: 'replication'|'in-sector', label? }`. Both ends are in the viewer's view. Links appear on the `accounts` lens only; a replication link needs the use case it derives from to be admitted too.
- Node ids are slash-free tokens matching `^[a-z0-9][a-z0-9_.:-]*$`, so `/v1/nodes/:id` routes cleanly (for example `c_bid:pricing-models`, `a_acme:eng:0`, `pb:<principalId>`).
- `plane` uses `common.schema.json` names: `GLOBAL_NONPERSONAL` (core, themes, governances), `TEAM_RESTRICTED` (departments, circles, topics), `ACCOUNT_RESTRICTED`, `PERSONAL_HOSTED`. `revision` is an integer.
- `toNodeDetail(view, nodeId, principal)` returns `null` for a node outside the view. Actions use the ctx stored on the view (`view.ctx`). `request_access` is listed only for locked nodes.
- `Ctx.ndaGrants` holds account ids (named grant per account). Elevation is active while `now < elevatedUntil` and `elevatedUntil - now <= role.elevation.hours`.
- The Personal Brain never appears in `MapView`. It is reachable through `NodeDetail` by its owner only.
- `view-plan.schema.json` is the GenUI ViewPlan v1. `Callout` takes a `template` key (no free text); `ItemList`, `Table` and the rest take queries only, and every props object has `additionalProperties:false`.

## GenUI (ViewPlan)

- A ViewPlan is `{version:1, title, components:[{type, props}]}` with `type` taken from this catalog only: `KpiRow`, `NodeCard`, `ItemList`, `AccountSummary`, `StageBoard`, `MapMini`, `Callout`, `Table`.
- `props` hold **queries** (for example `{nodeId}` or `{lens, filter}`), never data. The renderer (web or MCP App) resolves the data through the API as the viewer. A plan cannot raise permission. Plans are schema-validated, and unknown types are dropped.
- The B1 planner is deterministic (rule-based from prompt keywords and node kind). An LLM planner is added later behind the same schema. When Secondary is used through MCP, the host LLM acts as the planner by calling `render_view`.

## workers/mcp (remote MCP server, addable to any LLM host)

- Built with `agents` (createMcpHandler or McpAgent) and `@cloudflare/workers-oauth-provider`. The server follows MCP spec 2026-07-28: RFC 9728 protected resource metadata, RFC 8707 resource indicator and audience checks, and no token passthrough.
- The OAuth authorize step signs the user in through Cloudflare Access (upstream IdP), so the user identity is the same principal as the web app. Consent screen is Mantu-branded.
- Client allowlist (B-05, L3): redirect URIs on an allowlist of exact URLs or path prefixes (`ALLOWED_REDIRECT_URIS`: the Claude and ChatGPT callbacks, the Dust OAuth path, loopback for Claude Code and MCP Inspector). A host alone never matches, a port is accepted on loopback only, and credentials, fragments and plain http off loopback are refused. Anything else is rejected and audited. PKCE with S256 is required for every client, confidential ones included.
- Rate limits (L4): `/register` (10 a minute, 50 a day per address, 2000 a day in all), `/token` and `/authorize` (60 a minute per address) answer 429 with `Retry-After`. See `docs/runbooks/MCP-EDGE-LIMITS.md`.
- Tools are read and draft only in B1, and every one goes through `packages/policy`:
  - `whoami`
  - `search(q)`
  - `get_map(lens)`
  - `get_node(id)`
  - `get_account(id)`
  - `list_review_queue()`
  - `personal_note_create(title, body)`, owner only
  - `contribute(personalItemId, targetScopeId)`, which creates a candidate and never publishes
  - `render_view(viewPlan)`, which returns an MCP App UI resource (`ui://secondary/view`) rendering the ViewPlan with trusted components, plus a text fallback
- No tool approves, deletes or changes membership.
- Per-tool scopes are `secondary.read`, `secondary.personal.write` and `secondary.contribute`. A token without a scope gets 403 insufficient_scope.
- Every tool call writes an audit receipt (who, host client id, tool, scope ids, result count; no content).

## workers/api: final shapes (B1, written by the API agent)

These replace the "returns ..." column above where they differ. Lists are bare JSON arrays. Plane names are the policy names (`GLOBAL_NONPERSONAL`, `TEAM_RESTRICTED`, `ACCOUNT_RESTRICTED`, `PERSONAL_HOSTED`). An id outside the caller's view answers 404 on GET and 403 `{reason:"Not in your view"}` on `/v1/actions`.

- `GET /v1/me` adds `tenantId`, `seeded` and `capabilities:{configure, review}` (derived from the caller's roles; advice for the rail, every action is re-checked).
- `GET /v1/accounts` returns `AccountCard[]`: `{id, name, country, region, sector, status, aiProcessing:"allowed"|"not allowed"|"unknown", openItems, stars, plane}`. Facts are empty strings for structure-only viewers.
- `GET /v1/accounts/:id` returns `{account: AccountCard, members: null, sections:[{key, label, items:[{id, title, status, revision:string, note?, story?:{internal, lesson, external:{available, reason}}}]}]}`. `members` is always null in B1 (no per-account member list in the directory). Sections follow the account branches (`eng`, `out`, `dec`, `com`, `risk`, `con` for members only) plus `meetings` and `bids`.
- `GET /v1/governances` returns `GovernanceCard[]`: `{id, label, group:"Business line"|"Corporate function", useCases, stages:{Discover, "In design", Building, Piloting, Deployed}}`. `GET /v1/governances/:id` returns `{governance, useCases:[{id, title, stage, evidence}]}` (empty for structure-only viewers).
- `GET /v1/review` returns `Candidate[]`: `{id, nodeId, title, scopeLabel, plane, author, revision:string, previousRevision:string|null, submittedAt, diff:[{type:"add"|"del"|"same", text}], flags:[{kind, span, reason}], twoPerson:{required, approvals, needed}, approve:{allowed, reason}, requestChanges:{allowed, reason}, origin, release}`. `nodeId` is the id to send to `/v1/actions` (a seeded node id or `cand:<target>:<8hex>`). Request changes is `action:"review"` with `payload.verdict:"changes_requested"`; approve is `approve_release` with the exact `revision`. The contributor never sees their own item here. The diff is the whole text as `add` lines (no previous revision body is kept in B1).
- Sensitivity: every contribute path (`/v1/personal/items/:id/contribute` and `contribute` on `/v1/actions`) runs the deterministic detector on the server and ignores anything the client reports. Flags `{id, type, field, start, excerpt}` come back in `sensitivity_flags`; contribute is refused with 422 `sensitivity_flags_pending` until each flag id is in `acknowledged_flags`, and with 422 `user_validation_required` unless `user_validated:{by, at, revision}` names the caller, a time within 24 h and the current revision.
- `GET /v1/personal/items` returns `PersonalItem[]`: `{id, title, body, kind:"note"|"brief"|"view"|"draft", updatedAt, contributedTo?:[{scopeId, candidateId, at}], revision, status, sensitivity_flags}`. `POST /v1/personal/items {title, body?, kind?}` returns the item (201). `GET /v1/personal/targets` returns `[{id, label, group}]`, the nodes the caller may contribute to. Contribute body: `{targetScopeId, user_validated, acknowledged_flags?, releaseTarget?:"scope"|"global"}` returns 201 `{ok, receiptId, candidateId, status, sensitivity_flags}`.
- `GET /v1/admin/roles` returns `AdminRole[]` with `members` counts; `GET /v1/admin/audit` returns `[{id, at, actor, action, scope, result}]` (no content). Both need the Platform admin (configure) or the Auditor; others get 403.
- `GET /v1/activity` returns `[{id, title, scopeLabel, revision:string, at, nodeId}]`: the 20 most recent edits and releases in scopes where the caller has content access.
- `GET /v1/audit/receipts?principal=` (Auditor only) returns raw receipts, including `clientId` and `tool` for calls that came through MCP.
- Release rule: one approver for a scope release, two distinct approvers when the item is released to Company Global (`releaseTarget:"global"` or a `GLOBAL_NONPERSONAL` item). The contributor never counts. The approval is for one exact revision; an edit starts a new revision with no approvals.
- Workers config: secrets `SEED_TOKEN` and `INTERNAL_HMAC_KEY` (at least 32 characters, shared with workers/mcp), local var `DEV_AUTH_BYPASS_EMAIL`, `DO_JURISDICTION` (`eu`; `off` only for local workerd). Internal service auth from `workers/mcp` follows the section above and is enforced in `workers/api/src/auth.ts`.

## Internal service auth (workers/mcp to workers/api)

`workers/mcp` calls `workers/api` through the service binding `API`. It never forwards the host's OAuth access token (no token passthrough). It sends a signed principal instead. The shared helper is `workers/mcp/src/internal-auth.ts` (WebCrypto only), exported as `@secondary/mcp/internal-auth`: `signInternalRequest` for the signer, `verifyInternalRequest(request, env.INTERNAL_HMAC_KEY)` for the verifier. If the integrator prefers, move the file to a shared package; the wire format below is the contract.

Headers (all five required):

| Header | Value |
|---|---|
| `X-Secondary-Principal` | base64url(JSON), `{v:1, iss:"secondary-mcp", aud:"secondary-api", sub, email, persona?, client_id, scope:[...], tool}` |
| `X-Secondary-Timestamp` | unix seconds, integer |
| `X-Secondary-Key-Id` | which key signed (`k1` by default). The verifier holds a ring `{kid: secret}`: the current key and, during a rotation, `INTERNAL_HMAC_KEY_PREVIOUS` (`k0` by default). An unknown id is refused |
| `X-Secondary-Nonce` | 16 random bytes, base64url. The api remembers it for 120 s (a table in the directory tenant's TenantPolicy object) and refuses a second use, so a captured request cannot be replayed |
| `X-Secondary-Signature` | `v2=` + lowercase hex HMAC-SHA256 |

`signature = HMAC-SHA256(secret of kid, ["v2", kid, nonce, timestamp, METHOD, pathname+search, sha256hex(body), principalHeaderValue].join("\n"))`. The key is the secret `INTERNAL_HMAC_KEY` (at least 32 characters), set on `workers/api` and `workers/mcp` only. Skew is 60 seconds either way. Method, path, query, body, principal, key id and nonce are all signed. The nonce is spent only by a correctly signed request. The same format (kid, nonce, replay cache, key ring) covers `CONNECTOR_HMAC_KEY` (api and connector, each side keeps its own replay cache) and the ops scheme below. Rotation without a lockstep deploy: `docs/runbooks/KEY-ROTATION.md`.

**Ops calls (M-01).** `workers/ops` signs its calls to `/v1/internal/ops/*` (targets, export, restore, retention) with `OPS_HMAC_KEY`, a secret shared with `workers/api` only. The MCP worker never holds it, so a compromised MCP cannot export or restore tenant data. Headers `X-Secondary-Ops-Timestamp`, `-Key-Id`, `-Nonce`, `-Signature` (`v2=`), signing string prefix `ops-v2` (`packages/contracts/src/ops-auth.ts`). The MCP worker's kill switch pre-check uses its own read-only route, `GET /v1/internal/mcp/switches?tenant=`, signed with `INTERNAL_HMAC_KEY`; the old `/v1/internal/ops/switches` is gone. `RESTORE_ENABLED` is `yes` in dev only; staging and prod are `no`. The ops worker admin surface (`/snapshots`, `/backup`, `/restore`) needs `X-Ops-Key` and, in staging and prod, a valid Cloudflare Access JWT (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`; 401 without it, 404 while Access is not configured). A snapshot restores only into the environment that wrote it (`wrong_environment`).

What `workers/api` must do:

1. Call `verifyInternalRequest` before the Access path whenever `X-Secondary-Signature` is present. A present but invalid signature is a 401. It never falls through to Access or to `X-Demo-Persona`.
2. Resolve the Principal from `email` exactly as for an Access JWT. Honor `persona` only when `ENVIRONMENT=dev`, as `X-Demo-Persona`.
3. Allow internal principals only these routes, and refuse the rest with 403: `GET /v1/me`, `/v1/map`, `/v1/nodes/:id`, `/v1/search`, `/v1/accounts/:id`, `/v1/governances`, `/v1/review` (need scope `secondary.read`), `POST /v1/personal/items` (needs `secondary.personal.write`), `POST /v1/personal/items/:id/contribute` (needs `secondary.contribute`). `/v1/actions` and `/v1/admin/*` are never reachable this way, so MCP cannot approve, delete or change membership.
4. Record `client_id` and `tool` in the API's own audit receipt.
5. Request and response shapes `workers/mcp` assumes beyond this contract: `POST /v1/personal/items` body `{kind:"note", title, body}`; `GET /v1/accounts/:id` returns `{label?, sections:[{title|label, count?, items?:[{title}]}]}`; `GET /v1/governances` returns `{governances:[{id,label,stages: {name:count} | [{stage,count}]}]}` or the bare array; `GET /v1/review` returns `{candidates:[...]}` or an array. The MCP resolver is tolerant, but the API owner should confirm.

`workers/mcp` audit receipts (service binding `AUDIT`, `POST /append`, JSON): `{at, source:"secondary-mcp", kind:"mcp.tool_call"|"mcp.oauth", action, who, client_id, oauth_scopes, scope_ids, result_count, outcome:"ok"|"denied"|"error", reason?, redirect_host?}`. Identity and counts only, never content. The audit worker owner maps it to `audit-event.schema.json`.

## Integration notes (B1 integrator, after the security review)

- **Audit receipt contract.** One shape for all writers: `packages/contracts/src/audit-receipt.ts` (`Receipt`, `parseReceipt`, `newReceiptId`). `workers/api` sends the base fields. `workers/mcp` sends the same shape with `scopeIds`, `resultCount`, `oauthScopes` and `redirectHost` filled (tenant `DEFAULT_TENANT_ID`, principal `who` or `anonymous`, URL client ids hashed to `h_<16 hex>`). `workers/audit` parses with the shared parser and stamps `source` (`api` or `mcp`) from the caller's key, never from the body. This supersedes the earlier `{source:"secondary-mcp", kind, outcome, ...}` event.
- **Audit worker keys.** Every request needs `X-Audit-Key`. Secrets: `AUDIT_KEY_API` and `AUDIT_KEY_MCP` (append only), `AUDIT_KEY_READ` (read, held by `workers/api` only). Each is at least 32 characters. The MCP worker, which faces the internet, cannot read receipts.
- **Seed.** Needs both a valid Access identity (on localhost in dev, `DEV_AUTH_BYPASS_EMAIL`) and `SEED_TOKEN`.
- **Dev personas.** `X-Demo-Persona` binds to the signed-in email. A seeded persona address (`<role>@...`) keeps the id `u_<role>`. Any other email gets `u_<role>_<10 hex of sha256(email)>`, so two testers with the same persona have separate Personal Brains and separate approver identities.
- **Release rules.** Whoever wrote or edited an item counts as its author, on every revision, for review and approve. Only the contributor edits a candidate (others comment or request changes). Knowledge reviewers hold `review` and `approve_release` on Company Global. A global release needs two distinct approvers, none of them the contributor or an editor. `own_drafts` means authored by the caller.
- **MCP dev sign-in.** `X-Dev-Email` and `X-Dev-Persona` count only on a loopback host (localhost, 127.0.0.1) in dev with Access unset. Anywhere else `/authorize` answers 401 until the Access team domain and aud are configured.
- **Web.** Planes in the UI use the policy names. `GET /v1/admin/roles` and `/v1/admin/audit` are bare arrays, so the web derives "structure only" from the viewer's roles (Platform admin, Auditor).

## Identity (B2 ID workstream)

Code: `workers/api/src/auth/*` (Entra OIDC, sessions) and `workers/api/src/scim/*`. Setup: `docs/runbooks/ENTRA-SETUP.md`.

- `AUTH_MODE` is `access` (default), `entra` or `both`. Entra login needs vars `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and secret `ENTRA_CLIENT_SECRET`; without all three it is off. `SCIM_TOKEN` (32+ characters) turns SCIM on. Optional var `SCIM_TENANT_ID` (default `DEFAULT_TENANT_ID`).
- `GET /auth/providers` (no auth) returns `{entra, access, loginUrl}`. The web hides the Entra button when `entra` is false.
- `GET /auth/login?returnTo=/path` redirects (302) to Entra with PKCE S256, state and nonce. `GET /auth/callback` verifies the ID token (signature, iss, aud, tid, nonce, exp), creates the session and redirects (303). Failures: 400 `invalid_state`, 401 `sign_in_failed`, 403 `account_disabled`. `POST /auth/logout` (needs a same-origin `Origin`) deletes the session.
- Session cookie `__Host-secondary_session` (Secure, HttpOnly, SameSite=Lax, Path=/), value `<tenantId>.<random>`; the server stores only a hash. 8 hours absolute, 30 minutes idle. On every request the principal's status is re-read. A session-cookie request with a non-GET method must carry an `Origin` equal to the request origin, else 403.
- A principal deprovisioned in SCIM answers 401 on every identity source (session, Access JWT) until reactivated.
- **Identity key (H-01).** An Entra principal is keyed by `tid:oid` (both from the verified ID token; `oid` must be a GUID). The email is an attribute: the UPN (`preferred_username`) when present, else the `email` claim, which Entra does not guarantee to be verified. A second `oid` that carries the same email as an existing principal gets 403 `account_disabled` (no session). A principal that exists only by email (seeded, SCIM) is bound to an Entra subject on first sign-in only by a member whose UPN equals that email. A B2B guest (`acct` = 1 or a `#EXT#` UPN) is refused with 403 `guest_refused` unless the var `ENTRA_ALLOW_GUESTS` is `yes`; an allowed guest is routed to the directory tenant and never binds to an existing principal.
- **Access and MCP identities stay separate (H-01).** Once an Entra sign-in has bound a principal, a Cloudflare Access JWT or an MCP call with the same email is refused (401) unless that email is listed in the var `ACCESS_LINKED_EMAILS` (comma separated). Principals nobody has bound are unaffected.
- **Deprovisioning fails closed (H-02).** When `SCIM_TOKEN` is set, or SCIM has provisioned anyone, the tenant is SCIM-managed: sign-in needs a provisioned user, matched by SCIM `externalId` = the token's `oid` (Entra maps `externalId` to the object id), or, for a SCIM record with no `externalId`, by `userName` = UPN. Anyone else gets 403 `account_disabled`, and an Access/MCP identity with no principal is 401. A SCIM `active=false` therefore stops the person whatever UPN or email they sign in with. A SCIM-managed sign-in that would route to a tenant other than the SCIM directory tenant is refused (M-09).
- A renamed or unknown email loads no NDA grants or elevations (M-10). A directory group never confers a role that holds `configure` (M-11): `groupMapSet` refuses it and the mapping ignores it.
- Roles of a request are the stored role assignments plus the roles mapped from the principal's Entra groups (`TenantPolicy.groupMapSet/List/Delete`, keyed by group object id). A SCIM-provisioned principal takes groups from SCIM only, others from the groups claim of their last login.
- SCIM 2.0 at `/scim/v2` with `Authorization: Bearer <SCIM_TOKEN>`: `Users` and `Groups` (GET list with `filter=attr eq "value"` on `userName`, `externalId`, `id` / `displayName`, `externalId`; `startIndex`, `count`; GET/POST; PATCH add, remove, replace; DELETE), `ServiceProviderConfig`, `ResourceTypes`. A group is matched to the role table by its `externalId` (the Entra object id). PUT, Bulk, sort and complex filters are not supported.

## B2 GOV: governance console (`/v1/admin/*`, `workers/api/src/admin`)

Roles are data in TenantPolicy (seeded from `packages/policy` roles, versioned with history). MCP can never reach these routes. Refusals are `{error, reason}` and the console shows `reason`. Every mutation writes a content-free receipt (`gov.<kind>.<propose|approve|reject|withdraw|apply>`, `gov.elev.*`, `gov.access.*`, `gov.audit.read`); free text stays in the Durable Object.

- Roles: `GET /roles`, `GET /roles/:id/history`, `POST /roles`, `PUT /roles/:id` (configure holders only). An edit to a role that grants account or restricted scopes, or `configure`, is a pending change that a different configure holder approves. Others apply at once. A change that would leave nobody able to configure the tenant is refused.
- Changes: `GET /changes`, `POST /changes/:id/approve|reject|withdraw`. The proposer can never decide, and neither can the person the change is about (`payload.principalId`) or the requester of the linked access request: 403 `beneficiary_decision` (H-04). `canDecide` is false for them. Each change also carries `requestedBy` (the requester's principal id, or null). Pending changes lapse after 72 h.
- Memberships: `GET /scopes`, `GET /principals`, `GET /memberships`, `POST /memberships {op, principalId, scope_type, scope_id, subspace?}`. A steward manages only scopes where a role of theirs holds `manage_members` (Head of Bid: the Bid circle). Restricted circles, accounts and Contacts need a second approver.
- NDA: `GET /nda`, `POST /nda {principalId, accountId, reason, expiresAt}` (always two-person, at most one year), `POST /nda/revoke` (one person).
- Elevation: `GET /elevation`, `GET /elevations`, `POST /elevations {hours, reason}`, `POST /elevations/:id/approve|deny|end`. Hours are capped by the role (`elevation.hours`); `elevation.approval` requires a different configure holder. Expiry is automatic.
- Access requests: `POST /access-requests {nodeId, reason}`, `GET /access-requests?view=mine|queue`, `POST /access-requests/:id/approve|deny`. Approval adds the membership, through the two-person path for restricted scopes.
- Inbox: `GET /notifications`, `POST /notifications/read`. Audit viewer: `GET /audit?principal&action&from&to&limit` (auditor or configure holder).
- `GET /v1/admin/audit` rows gain `reason` and `revision`.
## Operations: kill switches and data subject rights

- `GET|POST /v1/admin/switches` (configure holders): `mcp`, `connector`, `ai`, `contribute`. Re-enabling needs a second person in prod.
- `POST /v1/admin/rights/export` with `{"principal":"<id or email>"}` (a GET answers 405, N-03) (H-06): a person's Personal Brain, authored items and receipt metadata. It needs two different configure holders within 24 hours: the first call answers 202 `{status:"pending", needs:"second_person", pseudonym}` and returns no data; the second person's call returns the bundle (`Content-Disposition: attachment`). Both steps are audited as `rights_export_request` and `rights_export` with the subject's pseudonym in the reason (never the id or the content). 503 `export_disabled` while `PSEUDONYM_KEY` is not set.
- `POST /v1/admin/rights/erase {principal}`: always two people, unchanged.

## Connector (B2 CONN)

- `workers/connector` syncs SharePoint/OneDrive into Workspaces and confirms read access. Runbook: `docs/runbooks/GRAPH-SITES-SELECTED.md`.
- `POST /internal/connector/{upsert,delete,purge}` on the api: signed with `CONNECTOR_HMAC_KEY`, principal `secondary-connector` only. Not under `/v1`.
- The api calls `POST /internal/acl/check` on the connector (signed with the user's id and email). Only an explicit `allowed: true` shows an item.
- `GET /v1/search` may return `kind: "source"` results. `GET /v1/sources/:id` returns the file record, or 403 `source permission could not be confirmed`. A caller without content access to the item's gate node gets 404. The web app renders them: the palette lists a source result with the hint "Source file" and opens `/sources/:id` (text only, the link to the source opens only for http(s) addresses, and a 403 reads "could not be confirmed at the source").

## AI processor (B2, `workers/api/src/ai`)

- Off unless all three are set (M-06): the secret `ANTHROPIC_API_KEY`, the var `AI_ENABLED=true` and the var `AI_PROCESSOR_CONTRACT=approved` (the processor contract is signed off). A key alone never turns AI on: without `AI_ENABLED` the answer is 503 `ai_disabled`, without the contract flag 503 `ai_not_configured` ("AI processor contract not approved"), without a key 503 `ai_not_configured`. The `ai` kill switch (`/v1/admin/switches`) covers every AI path, `POST /v1/briefs`, `/v1/briefs/save`, `/v1/ai/*` and `/v1/genui/plan`: 503 `{error:"switched_off", switch:"ai"}` (H-05). Every AI entry point, including future wiki ingest hooks, must call `gate(env, session.switches.ai)` from `src/ai/brief.ts` and be listed in the `ai` gate of `src/ops-admin.ts`. Other vars: `AI_MODEL` (default `claude-sonnet-5-5`), `AI_DAILY_TOKEN_BUDGET` (per tenant per UTC day, default 200000), `AI_TIMEOUT_MS`. Calls go to the Anthropic Messages API over fetch, tool-free, 2 retries, at most 8 evidence excerpts, about 12k evidence tokens and 1500 output tokens.
- `GET /v1/ai/status` returns `{state: ready|disabled|not_configured, reason, processor, model, region}`. No secrets.
- `POST /v1/briefs {accountId | nodeId, meetingId?, question?, save?}` returns `{brief, saved}`. Evidence comes only from the caller's admitted view. Refusals make no model call: 503 `ai_disabled` and `ai_not_configured`, 403 `ai_constraint` (the account's "AI use with client" is `unknown` or `not allowed`), 429 `ai_budget_exhausted`, 404 outside the view, 403 for Personal Brain nodes. The model must cite evidence ids (`E1`...) or mark a claim `unknown`; the server drops uncited claims and invalid ids. `save` defaults to true and stores a private Personal Brain item (kind `brief`, one item per target and meeting, a new revision each time).
- `POST /v1/briefs/save {brief}` saves a brief the caller holds, re-validated against the caller's view.
- R-110: personal segments (health, family, holidays, HR, private life) are removed before any text reaches a prompt or storage. The response lists what was excluded for the owner. Storage keeps counts only.
- `POST /v1/genui/plan` uses the model when the processor is ready and falls back to the deterministic planner on any failure (schema, node outside the view, upstream error).
- Each brief writes an `ai.brief` receipt (ids only) before anything leaves the system.
## B2 UX additions (workers/api/src/ux)

All owner-only or policy-checked, all audited when they write (identity and ids, never content).

- `PUT /v1/personal/items/:id {revision, title?, body?, kind?, tags?}` is a new revision. Type and tags alone change no revision. `DELETE /v1/personal/items/:id` answers `{copiesLeftInReview}`. `GET .../history`, `POST .../restore {revision, fromRevision}` (copies an old revision forward), `GET .../contributions` (status and reviewer words per contribution). Personal items also carry `tags`.
- `GET|PUT|DELETE /v1/ux/drafts[/:key]`: autosaved working copies (`new` or the item id). Not revisions. A saved revision drops the draft.
- `GET|PUT /v1/ux/prefs {lang: "en"|"fr"|null, tourDone}`: per user.
- `GET /v1/ux/review/:id`: previous and current text, discussion, decisions. `POST .../comments {text}` and `POST .../decision {revision, verdict, comment?}` need review or approve rights, never the contributor. Approve stays `approve_release` on `/v1/actions`.
- `GET /v1/ux/accounts/:id/records`, `POST` (create), `PUT .../:rid`, `POST .../:rid/permission {revision, granted, reference, text?}`, `GET .../:rid/history`: decisions, commitments, risks and success stories (sections `dec`, `com`, `risk`, `out`). Reads need content access, writes need `edit` on the account. The external story text is stored but returned only while customer permission is on record, and the permission covers exactly the text it was recorded with (`text`, or the stored text when omitted; it must not be empty). Rewriting the external text later leaves it locked until permission is recorded again (M-12).
- `GET /v1/ux/attention`: open decisions, commitments and risks across the accounts the caller can read, overdue first.

## Memberships reach the policy, and review notices (B2 integration)

- A grant may carry the condition `membership: true`. It then applies only where the principal holds a membership of that scope (`department`, `circle` or `account`, by the node's own scope id), so a steward's approval of a membership or an access request changes what the person sees on the next request (the revocation epoch bumps). Seeded roles `head_bid`, `acme_lead` and `consultant` hold three such grants (department and circle: view, comment, contribute; account: the same plus Contacts, and NDA accounts still need the named grant). A department membership never admits a restricted circle or topic; those need their own circle membership (H-03). Roles without them (CEO, reviewer, platform admin, auditor) are not widened by a membership. Role edits that only carry `membership` grants are not "sensitive" edits; restricted memberships keep their own two-person rule. Tenants seeded before this change keep their stored role bodies until reseeded (dev) or edited in the console.
- `POST /v1/admin/access-requests` is what the drawer's "Request access" button calls (not `/v1/actions`). Approval adds the membership (two-person for restricted scopes) and the requester sees the node on the next request.
- Review events post to the inbox (`GET /v1/admin/notifications`), content-free (the title names the scope): `review_requested` (to people who may review or approve the target, never the contributor), `review_changes_requested`, `review_approved` (first of two approvals), `review_released` (to the contributor) and `review_second_approval` (to the other approvers). Delivery is best effort and never fails the action.
- Deploy: `scripts/deploy.sh <env>` creates the sync queue, deploys audit, api, connector, mcp, ops, and bridges the api/connector service-binding cycle with a 503 placeholder worker under the connector's name on a first deploy.

## Living Wiki (B3, `workers/api/src/wiki`, `apps/web/src/views/wiki`)

Normative design: `docs/DESIGN-LIVING-WIKI.md`. One wiki per workspace, stored in that workspace's Durable Object (the `Workspace` class extends `WikiBase`), so a snapshot, an erasure and a reseed cover it.

Tables: `wiki_pages` (id, type, title, markdown, revision, status), `wiki_page_revisions`, `wiki_facts` (subject, predicate, object, valid_at, invalid_at, recorded_at, checked_at, source_ids, source_hashes, confidence, origin `human|agent|connector`, verified_by), `wiki_log` (append only: no method or route edits or deletes a row), `wiki_schema` (page types, required sections), `wiki_sources` (content hash last read), `wiki_jobs`, `wiki_findings` (dedupe key per lint finding), `wiki_promotions`. The index is derived from pages. Raw sources are existing workspace items of kind `record`, `meeting_record`, personal notes, promotion candidates, and connector `source_items`, each with a SHA-256 content hash.

Claims are Markdown bullets with `{src:<source id>}` tokens. Links are `[[page-id]]`, and `[[global:page-id]]` toward Company Global only (any other `[[x:y]]` is removed). Facts use `kind: title` subjects (`decision:`, `commitment:`, `risk:`) and the predicates `status`, `owner`, `due`, `severity`. Decision log, commitments, risk register and overview are generated from the facts that hold now.

`:ws` is a node id (an account, circle, department, or `core` for Company Global) or `me` for the caller's own Personal Brain wiki. The workspace must be in the caller's view at content level, else 404. Read routes need that. Writes need `contribute` (propose), `edit` (meeting records), or review, release or edit rights (decide, run, settings, verify). Personal: the owner has all of them.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/wiki/health` | per admitted wiki: pages, facts, unverified, openFindings, openProposals, stale, score (map signal) |
| GET | `/v1/wiki/:ws/index` | pages (id, title, type, one-line summary), schema, health, settings, `can` |
| GET | `/v1/wiki/:ws/pages/:pid?rev=` | page with citations resolved for the caller; `restricted` counts dropped claims |
| GET | `/v1/wiki/:ws/pages/:pid/history?limit=&before=` | revisions with line diffs, newest first, at most `limit` (default 20, max 50). Header `X-Next-Before` is the cursor for the next answer |
| GET | `/v1/wiki/:ws/facts?all=1&subject=` | facts over time, unverified flag, readable sources only |
| GET | `/v1/wiki/:ws/log` | append-only log. Entries hold ids; proposal titles are looked up per caller |
| GET | `/v1/wiki/:ws/search?q=` , `/ask?q=` | index first. `ws` may be `all` (admitted wikis). `ask` answers with cited lines or `{unknown: true, answer: null}` |
| GET | `/v1/wiki/:ws/proposals?status=` , `/proposals/:id` | wiki review items (decide rights) |
| POST | `/v1/wiki/:ws/proposals/:id/decide {decision: approve\|reject, revisionHash}` | `approve` names the exact revision read (`revisionHash` of `GET .../proposals/:id`), else 400 `revision_required`; 409 when the proposal was edited since or a page moved since the draft. The author, anyone who edited the proposal and anyone who wrote a source it is drawn from are refused (403), except in the owner's own Personal Brain. Where two approvers are required (Company Global) the first approval answers `status: "pending"` and a different person's applies it; an edit starts a new revision and drops earlier approvals |
| POST | `/v1/wiki/:ws/proposals/:id/edit {pageId, markdown}` | a reviewer's own wording, applied as written. The editor becomes an author, the revision moves on, generated pages (decision log, commitments, risks, overview) are refused (422), and a citation to a source the editor cannot read is removed |
| POST | `/v1/wiki/:ws/propose {title, markdown, pageId?}` | creates a `wiki_ingest` review item (origin human). MCP `wiki_propose` |
| POST | `/v1/wiki/:ws/meetings {title, date?, decisions[], commitments[], risks[], notes?}` | stores a `meeting_record` source and queues an ingest |
| POST | `/v1/wiki/:ws/run {jobs?: ["lint","dream"]}` | runs what is due now, plus lint or dreaming on demand |
| POST | `/v1/wiki/:ws/facts/:id/verify` | a person confirms a fact |
| PUT | `/v1/wiki/:ws/settings {autoAccept?, freshnessDays?}` | `autoAccept` is for `me` only |
| POST | `/v1/wiki/:ws/pages/:pid/promote {user_validated, acknowledged_flags}` | account wikis only. De-identified candidate to Company Global through the contribute flow (sensitivity flags, release needs 2 approvers). Registers the candidate in the global wiki, which publishes the page once it is released |

**Per-viewer masking (security review B3, H-02, M-01).** Every text derived from a source is re-checked for the caller. A generated or authored line is shown only when every source it cites is readable; a page whose cited sources are all unreadable is not listed, read, searched or shown in history; a proposal (title, rationale, detail, fact subjects and objects, page titles, `/v1/review` rows) rests on `titleSources` and shows `restricted source` when the caller cannot read all of them. Proposal titles in the log are looked up the same way.

**Limits (M-03, M-05).** Pages hold at most 1,000 lines; diffs above 1,000 changed lines are shown as a replacement; at most 500 pages are loaded per call. Search and ask: `WIKI_SEARCH_PER_MIN` (default 30) per person, one connector check per query, at most 20 hit pages. Writes (propose, edit, meetings, run): `WIKI_WRITE_PER_MIN` (default 30). A source ingested in the last 10 minutes waits for that window before its next ingest. The wiki spends at most 40% of the tenant's daily AI budget (its own counter, also counted in the tenant's).

**Retention and rights (M-02).** Deleting a source, purging a Personal Brain note or removing an item deletes the facts that rest on it, removes the page lines citing it from pages and every revision, rebuilds search, rejects and empties the proposals that cite it, and drops its title from source rows, jobs and log. Erasure also replaces the person's id, address and aliases inside wiki text. The subject export carries the personal wiki and what the person did in company wikis.

Review items are workspace items of kind `wiki_ingest`, `wiki_lint` or `wiki_dream` (id `cand:<node>:<hex>`), so they appear in `GET /v1/review` with `kind` set; `/v1/actions` refuses to decide them. The body is a JSON proposal (pages with before and after, new facts, facts to end, facts to confirm, sources and hashes).

Jobs: a new or changed source (record create or update, meeting record, Personal Brain note, connector upsert) queues an ingest job in the workspace's own object. A Durable Object alarm runs jobs, lint daily and dreaming at 02:00 UTC. Var `WIKI_ALARMS=off` turns the scheduling off (tests). Ingest triage: unchanged hash or no new fact means a log entry only. Otherwise the deterministic extractor (structured records, `Decision:`, `Commitment:`, `Risk:` lines) or, where the processor is ready and the account contract says `allowed`, the model drafts facts and pages with a citation each. Personal Brain sources never go to a model. A fact that disagrees with a valid one ends the older one when the newer is approved (`invalid_at`), and history stays.

Lint findings (review items, one each): contradiction, orphan page, broken link, source hash changed or gone, stale claim, uncited claim, missing schema section. Dreaming proposes merges, summary sections and cross-links, within the workspace, and never writes.

MCP (`workers/mcp`): `wiki_search` and `wiki_read` (scope `secondary.read`), `wiki_propose` (`secondary.read` + `secondary.contribute`, creates a review item only). No tool approves.
