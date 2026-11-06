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

## UX v2 endpoints (docs/DESIGN-UX-V2.md), normative shapes

All are policy-gated and use the caller's scope, with `no-store`.

- `POST /v1/ask {q, scope?}`, response `text/event-stream`. Events are named `status`, `citation`, `plan`, `answer` and `usage`:
  - `status`: `{stage}`.
  - `citation`: `{pageId, title, workspaceId, sourceIds[]}`.
  - `plan`: a ViewPlan.
  - `answer`: `{markdown, unknown: boolean}`.
  - `usage`: `{inputTokens, outputTokens, indexTokensRead, fullContextEstimate, savedPct, processor:"anthropic"|"deterministic"}`.
  - The stream ends with `done`. Without AI the deterministic path still emits every event.
- `GET /v1/brain/tree?root=personal|company`, response `{roots:[TreeNode]}`, where `TreeNode={id, label, kind:"workspace"|"folder"|"page", access:"full"|"partial"|"locked", count?, children?: TreeNode[]}`. Folders are the wiki page types (Clients, Projects, Opportunities, Bids, Offers, Expertise, Interactions, Entities, Contacts). Locked nodes have no children. Hidden nodes are absent.
- `GET /v1/questions`, response a list of `{id, kind:"ingest"|"contradiction"|"lint"|"review"|"release", title, workspaceId, createdAt, summary, options:[{action, label}], detail}`. `detail` for a contradiction is `{current:{text, sources[]}, incoming:{text, sources[]}}`. `POST /v1/questions/:id {action, revisionHash?, note?}` returns `{ok}` or 403 `{reason}`.
- Routines:
  - `GET/POST /v1/routines`, `GET/PUT/DELETE /v1/routines/:id`.
  - A Routine is `{id, name, source:{kind:"sharepoint"|"meetings"|"notes"|"manual", ref?}, schedule:"daily"|"weekly"|"manual", targetScopeId, guardrails:{excludePersonal:true, excludeHR:true, excludeNewsletters:boolean}, enabled}`.
  - `POST /v1/routines/:id/run` returns a run.
  - `GET /v1/routines/:id/runs` returns a list of `{id, at, ingested, skipped, asked, tokens, items:[{title, verdict:"ingest"|"skip"|"ask", reason}]}`.
- `GET /v1/usage?period=7d|30d`, response `{me:{tokens, runs, answers, savedPct}, byCapability:[{capability, tokens, runs}], tenant?: {...}}`. `tenant` is present for admins only.
- `GET /v1/brain/export?workspaceId=` returns a zip of Markdown: one folder per page type, an `index.md` per folder, and frontmatter on each page. It contains readable content only.
- Behaviour notes for the UX v2 endpoints (shapes above are unchanged, these are additive):
  - `/v1/ask`: body `{q (1 to 500 characters), scope?}`; `scope` is `me` or a policy node id, and a scope the caller cannot read is 404. `savedPct` is a fraction between 0 and 1. The model path runs only when the AI gate is open, the processor contract allows it, every account among the sources says `allowed`, and no Personal Brain page is a source; otherwise the answer is deterministic (`processor: "deterministic"`, zero tokens).
  - `/v1/brain/tree`: ids are `me` or the node id for a workspace, `<workspace>#<type>` for a folder, `<workspace>/<pageId>` for a page. A workspace the caller sees by name only is `locked` and has no `children`. `root` omitted means both roots.
  - `/v1/questions`: `detail` also carries `revisionHash`, `approvals` and `required` (candidates and wiki proposals). A contradiction's `current` and `incoming` are `{text, validFrom, sources:[{id,title}]}`. Option actions by kind: `ingest` (`ingest`, `skip`), `contradiction` (`prefer_incoming`, `keep_current`), `lint` (`approve`, `reject`), wiki `review` (`approve`, `reject`), candidate `review` (`accept`, `request_changes`), `release` (`approve`, `request_changes`). Actions that approve need `revisionHash` (400 `revision_required` without it, 409 when stale). Refusals: 403 `{reason}` for a visible question the caller may not decide (including `self_approval`), 404 for one the caller cannot see.
  - Routines: `targetScopeId` is `me` or a node id the owner may contribute to (404 when the node is not in the owner's view, 403 when it is but contribution is not allowed), checked again at every run. `guardrails.excludePersonal` and `excludeHR` cannot be false. A `manual` routine takes `{items:[{title,text}]}` in the run body; `notes` reads the owner's Personal Brain notes and needs a shared target; `meetings` reads the meeting records of the workspace in `source.ref`; `sharepoint` searches synced files by the words in `source.ref`, each confirmed by the connector.
  - `/v1/usage`: `byCapability` is the caller's own. `tenant` has the same fields as `me` plus its own `byCapability`, and the key is absent for everyone but admins. Capabilities written today: `ask`, `routine`, `brief`, `planner`, `wiki_ingest`.
  - `/v1/brain/export`: `workspaceId` is `me` or a node id the caller reads at content level (404 otherwise). Folder names are the page type keys; frontmatter values are JSON-quoted (valid YAML). Frontmatter also carries `origin` (`human` or `seed`) and, for dev seed pages, `synthetic: "Synthetic seed (dev data)"`.
  - `GET /v1/ask/suggestions`, response `{questions:[{q, workspaceId, pageId}]}`, at most 5. Built from pages the caller can read (a page needs a readable source), one per page, company pages before Personal Brain pages, worded from the page's title so the question finds it. A caller who can read no page gets `[]`. Each question answers (not unknown) when asked.
  - `/v1/ask` deterministic answer (index first): the question words minus question words ("what", "the", ...) pick pages; the title counts most. The answer lists up to 4 pages as `- **Title**: one line [n]`, then up to 4 key points under "Key points:", each with its page's citation number. It is unknown only when no readable page matches.
  - `GET /v1/wiki/:ws/pages/:pid` also returns `origin` (`human`, or `seed` for the dev synthetic seed; a person's edit makes it `human`).
- Export format, decision D17 (proposed): follow **Open Knowledge Format v0.2** (https://github.com/GoogleCloudPlatform/open-knowledge-format, SPEC.md; licence still to be confirmed, but we adopt the format, not the code).
  - Reserved files: `index.md` (grouped bullet links with one-line descriptions) and `log.md` at each level.
  - Every other `.md` file is a concept page.
  - Frontmatter: `type` is required. Also emitted: `title`, `description`, `tags`, `sources`, `generated`, `verified`, `status`, `stale_after`.
  - Links are root-absolute Markdown links.
  - The same format is accepted on import into Personal Brain (planned).

## v3 brains (docs/DESIGN-BRAINS-V3.md), normative shapes

Written first so the web agent can build against it. All routes are policy-gated, answer from the caller's admitted view only (a brain the view does not reach at content level is 404, so absence and denial look the same), and send `no-store`. `:id` is a brain id: `me` (the caller's Personal Brain) or a policy node id (account, circle, department, `core`). Refusals are `{error, reason}`; a policy bound is 422 `{error:"policy_bound", reason}`; a feature outside the caller's pilot cohort is 403 `{error:"not_in_pilot", flag}`.

**Vocabulary.**
- `BrainType`: `personal | team | account | global`. A circle or department is `team`, an account is `account`, `core` is `global`.
- `BrainRole`: `reader | contributor | editor | steward | owner`. Policy mapping (also `brainRoleActions` in `packages/policy`): reader = view_structure, view_content; contributor = reader + comment, contribute; editor = contributor + edit; steward = editor + review, approve_release; owner = steward + manage_members. A stored role only ever narrows what the policy already allows (the wiki write routes apply it); a person with no stored role is decided by the policy alone.
- `Publication`: `review | direct`. `Everyone` (Everyone at Mantu): `none | reader | contributor`.
- `Sensitivity`: `none | confidential | personal`. `FieldType`: `text | number | date | select | email | phone | url`.
- `Template`: `personal | team | account | bid | practice | global | blank`.
- `Health`: `{score: 0..100, components: {lint: C|null, freshness: C, orphans: C, backlog: C|null, coverage: C & {have, want, missing: string[]}}}` with `C = {value: number, score: 0..100}`. `lint` and `backlog` are `null` (and left out of the score) for a caller who cannot decide proposals. Every count and the score are computed from the pages the caller can read (a page whose cited sources are all unreadable is left out), so two callers can see two scores.
- `BrainCard`: `{id, type, name, template, readers, manages, restricted, publication, pages, health: {score}, lastActivityAt: ISO|null}`. `readers` counts members (stored members plus memberships; 1 for personal, the directory size for global). `manages` is true for the Personal Brain owner and for a caller who holds `manage_members` on the node (narrowed by a stored role: only `owner` or no stored role).

**Policy bounds (`packages/policy` `brainRules`).**

| Brain | Publication allowed | Everyone at Mantu allowed | Members and roles |
|---|---|---|---|
| personal | review, direct (default review, as today) | none | none: a Personal Brain is never shared (422 `personal_not_shareable`) |
| team, not restricted | review, direct (default review) | none, reader, contributor | yes |
| team, restricted | review only | none only | yes, two-person |
| account (any, NDA included) | review only | none only | yes, two-person |
| global | review only | reader only | role changes only |

`restricted` is the policy node's `restricted` flag, or an account. Direct publishing takes effect only for a caller with `edit` right and is re-checked on every propose, so a later change to restricted turns it off.

### Directory and home

- `GET /v1/brains?type=&q=` returns `{brains: BrainCard[]}`: admitted brains only, the Personal Brain first, then by name. `type` filters by `BrainType`, `q` by name.
- `GET /v1/brains/:id` returns a `BrainCard` plus `{health: Health, collections: [{type, label, count, expected}], changedThisWeek: {since: ISO, total, items: [{pageId, title, type, change: "new"|"updated", revision, at: ISO, actor: string|null, added, removed}]}, coach: {available: boolean, suggestions: [{kind: "missing_collection", collection, message}]}}`. `collections` are the brain's collections (its wiki page types, generated ones and the journal left out) with the count of pages the caller can read (`expected` is true when the template asks for it, a collection with no page has `count: 0`). `changedThisWeek` lists at most 50 pages changed in the last 7 days, visible pages only, with line counts of the diff. `coach.available` is `manages`.
- `POST /v1/brains/:id/template {template}` (needs `manages`) sets the brain's template and adds its collections to the brain's page types (never removes one). Returns `{ok, template, added: string[]}`. A brain with no stored template uses the default of its type.

### Access

- `GET /v1/brains/:id/access` returns `{brainId, type, canManage, publication: {mode, allowed: Publication[], forced: boolean, reason: string|null}, everyone: {level, allowed: Everyone[], reason: string|null}, roles: [{id, label, summary, actions: string[]}], members: [{principalId, email, role, state: "active"|"pending"}] | null}`. `members` is `null` unless `canManage`.
- `PUT /v1/brains/:id/access {publication?, everyone?}` (needs `manages`) returns `{ok: true, publication, everyone}`. A value outside the bounds table is 422 `policy_bound` and nothing changes. **Everyone at Mantu** now widens the admitted view (policy engine, `Ctx.openBrains`, `AdmittedView.lifted`): for a team or Company Global brain only, never account, NDA, restricted, contacts or Personal, and never a node under a restricted or NDA ancestor. It lifts `view_structure` and `view_content` and nothing else (no comment, contribute, edit, review, release or members). The only open level is `reader` (`allowed` is `["none","reader"]`; `contributor` is not offered, 422 `policy_bound`). **Opening takes two people** (M-8): the first `PUT` answers 202 `{ok, status:"pending", needs:"second_person"}` and changes nothing, the same person again is 409 `same_person`, a different person sending the same level within 24 hours applies it. Closing (`none`) is one person. The level is kept per tenant (`open_brains`, in the tenant snapshot).
- `PUT /v1/brains/:id/access/members/:principalId {role}` adds a member or changes their role (needs `manages`; the target must be in the tenant directory, and nobody changes their own role: 422 `own_role`). Returns `{ok: true, status: "applied"|"pending", changeId?: string, member: {principalId, role}}`. Admission goes through the governance membership change, so on a restricted brain it is `pending` until a second person approves it in the console. A role change for an existing member on a restricted brain, and any grant of `steward` or `owner` there, uses the two-person rule: the first request answers 202 `{ok: true, status: "pending"}` and a different human repeating it applies it (409 `same_person` for the same human).
- `DELETE /v1/brains/:id/access/members/:principalId` removes the member (same rules, same answer shape).
- A stored brain role narrows everywhere a decision is taken (H-2): Questions (list, single decide, batch) need `review` (`approve_release` for a release) and the hidden-version read in `GET /v1/wiki/:ws/pages/:pid?rev=` needs `edit`. A proposal made through an MCP session always waits for review, whatever the brain's publication mode (M-5).

### Business fields (typed schema per brain)

- `GET /v1/brains/:id/fields` returns `{fields: FieldDef[], types: FieldType[], sensitivities: Sensitivity[]}`; `FieldDef = {key, label, type, options?: string[], sensitivity, retentionDays: number|null, appliesTo: string[]}` (`appliesTo` are page types; empty means every page). Any reader may read the definitions.
- `PUT /v1/brains/:id/fields {fields}` (needs `manages`) replaces the schema. Making a field more visible (personal to confidential or none, confidential to none) or dropping a sensitive field needs a second person bound to that exact schema (M-4): the first request answers 202 `{status:"pending", needs:"second_person", fields:[keys]}`, the same person again is 409 `same_person`. A stricter change applies at once. Limits: at most 30 fields, `key` matches `^[a-z][a-z0-9_]{0,31}$`, unique; `select` needs `options` (at most 20); `retentionDays` 1 to 3650 or null.
- `GET /v1/brains/:id/pages/:pid/fields` returns `{pageId, fields: [{key, label, type, sensitivity, value: string|null, masked: boolean}]}`. The same list rides on `GET /v1/wiki/:ws/pages/:pid` as `fields`.
- `PUT /v1/brains/:id/pages/:pid/fields {values: {key: string|null}, acknowledgedFlags?: string[]}` (needs `edit`; the page must be readable) stores values and returns `{ok: true, fields}`.
- What sensitivity does:
  - **Masking.** `none` shows to every reader. `confidential` shows to a caller with `edit` right (else `value: null, masked: true`). `personal` is never shown to anyone but the person who wrote it, and is refused in a shared brain: 422 `personal_field_shared_brain`.
  - **Detectors.** Every value goes through the R-110 and R-111 detector. A `none` field with a flag is 422 `sensitive_value {flags}`; a `confidential` field needs the flag ids in `acknowledgedFlags`, else the same 422.
  - **Export filter.** `/v1/brain/export` writes only `none` fields (frontmatter `properties`); the other two never leave.
  - **AI gate.** Any caller on an MCP (agent) session, and any model path, sees only `none` fields.
  - **Retention.** A value older than its field's `retentionDays` is deleted by the daily job.

### Hidden versions

- `GET /v1/brains/:id/pages/:pid/versions` returns `{versions: [{revision, at: ISO, actor, hidden: boolean, hiddenAt?, hiddenBy?, reason?}]}`, newest first, at most 50. A caller without `edit` right gets `{revision, at, hidden: true}` only for a hidden one (no actor, no reason).
- `POST /v1/brains/:id/pages/:pid/versions/:rev/hide {reason}` and `.../restore` (need `edit`) return `{ok: true}`. The current revision cannot be hidden (422 `current_revision`). Both write a receipt (`brain.version_hide`, `brain.version_restore`) and a log entry. A hidden revision is also hidden in `GET /v1/wiki/:ws/pages/:pid/history` for a caller without `edit`: the entry is `{revision, hidden: true, at, diff: []}`, the next revision shows no removed line (those lines are the hidden text), and `?rev=` answers 404. Editors see everything, with `hidden: true` on the entry. Erasure of a person stays a separate, two-person flow.

### Questions upgrades

- `GET /v1/questions?q=&brain=&kind=&age=` filters the list (still an array of the same `Question` shapes). `q` matches title and summary (as the caller sees them), `brain` is a `workspaceId`, `kind` is a `QuestionKind`, `age` is `1d | 7d | 30d` (newer than) or `older` (older than 30 days).
- `POST /v1/questions/batch {items: [{id, action, revisionHash?, note?}]}` (1 to 50 distinct ids) returns `{results: [{id, ok, status, error?, reason?}], ok: number, failed: number}`. Each item runs the exact single-item rules (rights on the live record, never your own, `revisionHash` required for an approval, two-person counted per item). One refusal never stops the others, and one person's batch approval of an item that needs two is the first approval only.

### Import

- `POST /v1/brains/:id/import?format=okf|obsidian|outline` (needs `contribute`; body is the raw archive: `application/zip`, or `application/json` for a single Outline collection file; at most 5 MB) returns `{ok: true, format, imported: [{pageId, title, state: "published"|"draft", proposalId?}], skipped: [{path, reason}], asked: number}`.
- Every page passes the routine classifier (R-110 personal passages removed, R-111 contact details masked, HR and mostly-personal items skipped). In a shared brain every kept page becomes a draft (a wiki review item, `state: "draft"`); in the Personal Brain a clean page is published directly (`state: "published"`) and a page the classifier would ask about stays a draft. Nothing in a shared brain is published by an import.
- Guards: at most 200 entries and 200 pages, 256 KB per page, 20 MB unpacked, compression ratio at most 100:1, no encrypted or zip64 archive. Entry names with `..`, a leading `.`/`..` segment, a leading `/` or a drive, a backslash or a NUL are skipped with reason `unsafe_path`. A page id is the slug of the file name (`okf`) or of the title (`obsidian`, `outline`), and must match the wiki id rule; a path is only ever a label. An id that already exists makes the import an edit proposal, never an overwrite. HTML, `javascript:` and `data:` links, event handlers and embedded images are stripped from the Markdown. `okf` skips `index.md` and `log.md`; `obsidian` skips `.obsidian/`, attachments and canvas files, turns `[[Note|alias]]` into text and `![[embed]]` into nothing; `outline` reads each document's `text`, or its ProseMirror `data`.
- **Dry run** (`POST /v1/brains/:id/import?format=...&dryRun=1`, same body and rights): returns `{ok: true, dryRun: true, format, pages: [{path, pageId, title, type, verdict: "ingest"|"ask", reason, excluded: {category: n}, replaces: boolean, state: "published"|"draft"}], skipped: [{path, reason}], asked}` and writes nothing (no proposal, no receipt). The web wizard runs it on the check step and shows the verdicts before the button that imports. 20 dry runs a minute per person.
- Archive reading counts the real unpacked bytes against the total (headers may lie), refuses entries that share or overlap bytes, and refuses a local header whose name differs from the central directory (M-7).
- Rate limit 5 imports per minute per person. Errors: 400 `invalid_format`, 413 `too_large`, 422 `invalid_archive` (with `reason`).

### Journal

- `GET /v1/brains/:id/journal` returns `{days: [{date: "YYYY-MM-DD", pageId}]}`, newest first, at most 60 (journal pages the caller can read).
- `POST /v1/brains/:id/journal/run {date?}` (needs `edit`; `date` defaults to yesterday, never in the future) writes or rewrites the page for that UTC day and returns `{ok: true, pageId: string|null, created: boolean}`; `pageId` is null for a day with nothing in the log (no page is written). A Durable Object alarm does the same each night for yesterday (and any day missed in the last week).
- The page is type `journal`, id `journal-YYYY-MM-DD`, and is built only from that brain's own wiki log. It holds counts and `[[page-id]]` links (ingested, decided, contradictions, lint, approvals), never titles or text, so it carries nothing another brain or a restricted source could leak.

### Structure Coach and MCP

- `GET /v1/brains/:id/coach` (needs `manages`) returns `{brainId, questions: [{id, prompt, kind: "choice"|"text"|"list", options?: string[]}], templates: [{id, label, collections: [{type, label, required: string[]}]}], current: {template, collections: string[]}}`.
- `POST /v1/brains/:id/coach/propose {answers: {role?, accounts?: string[], recurring?: string[], template?}}` (needs `manages`) returns `{proposalId, hash, template, collections: [{type, label, required: string[], action: "add"|"keep"}], rationale, expiresAt}`. It stores a proposal and changes nothing else. An unknown template is 400 `invalid_template`.
- `POST /v1/brains/:id/coach/apply {proposalId, hash}` (needs `manages`) adds the proposed collections and sets the template; returns `{ok: true, created: string[]}`. A stale or unknown proposal is 404, a wrong `hash` is 409. It creates collections only (no pages, no members).
- `GET /v1/brains/:id/guide` (read; also for MCP) returns `{brain: {id, type, name, template}, publication, collections: [{type, label, required, count}], tone, fields: FieldDef[] (definitions only), conventions: string[], howToPropose: string}`. It never contains page text or field values.
- MCP tools: `get_brain_guide {brainId}` (scope `secondary.read`) calls the guide route; `coach_propose_structure {brainId, answers}` (scopes `secondary.read` + `secondary.contribute`) calls `coach/propose` and answers 403 for a brain the user does not manage. No MCP tool applies a structure.

### Agent connections

- `GET /v1/agents` returns `{hosts: [{id: "claude_code"|"claude_ai"|"chatgpt"|"codex"|"dust"|"copilot_studio"|"other", label, connected: boolean, lastCallAt: ISO|null, calls, scopes: string[], connections: [{id, lastCallAt, lastTool, scopes, state: "active"|"revoked"}]}]}`. Only the caller's own connections. A host with no connection is listed with `connected: false`.
- `GET /v1/agents/config` returns `{mcpUrl: string|null}`: the API's `MCP_PUBLIC_URL` (an origin) plus `/mcp`, or null when none is configured; Settings > Agents builds every connect command from it and guesses from the page host only on null.
- An MCP call must carry its `grant_id`: without it the API answers 400 `grant_required` and the MCP worker 403 `grant_unknown` (M-3). A malformed connection id is 400 `connection_id_required`. `POST /v1/agents/revoke-all {confirm: true}` revokes every connection of the caller (400 `confirm_required` otherwise).
- `POST /v1/agents/connections/:id/revoke` and `POST /v1/agents/hosts/:host/revoke` return `{ok: true, revoked: number}` (404 for an id that is not the caller's). From the next call, the API refuses that token with 403 `connection_revoked`, and the MCP worker deletes the OAuth grant, so the token is dead at both ends. Connecting again creates a new grant and works.
- Recorded per call by the API from the signed MCP principal (`grant_id`, `client_id`, `host`, scopes, tool; `grant_id` and `host` are optional fields the MCP worker adds, the host label comes from the client's redirect URIs). No token, no content. The records are not part of a tenant snapshot, so a restore never brings back a revoked connection.

### Pilot cohorts (admin only: a role with `configure`)

- `GET /v1/admin/pilot` returns `{cohorts: [{id, name, members: string[] (emails), flags: {key: boolean}, createdAt}], flagKeys: string[]}`. `flagKeys` are `brains_v3`, `imports`, `coach`, `batch_review`, `journal`.
- `POST /v1/admin/pilot {name, members, flags}` creates (201 `{id}`), `PUT /v1/admin/pilot/:id` replaces, `DELETE /v1/admin/pilot/:id` removes (all audited). At most 20 cohorts, 500 members each.
- `GET /v1/me/flags` returns `{flags: {key: boolean}}` for the caller. A key is **managed** once any cohort sets it: then it is on only for members of a cohort that turns it on. A key no cohort mentions is on for everyone. `imports`, `coach`, `batch_review` and `brains_v3` (the whole `/v1/brains` family) are enforced by the API.

## v4 (docs/DESIGN-V4-BRAINS-UI.md), normative shapes

All of it sits behind the `brains_v3` flag and answers from the caller's admitted view only. A brain is opened only when the caller is admitted to the node itself at content level (`opensBrain` in `packages/policy`): a department shown as `partial` because a circle inside it is admitted is **not** a brain they can open (it was readable before; it is 404 now).

### Nav and `scope=all`

- `GET /v1/brains/nav` returns `{items: NavItem[]}`, `NavItem = BrainCard & {group: "personal"|"governance"|"global", governanceId?: string, children?: BrainCard[]}`. Order: the caller's Personal Brain, then the governances in this order, then Company Global (when readable). A governance the caller has no brain for is left out: no name, count or placeholder.
  - Governances: Bid & Pre-sales (`c_bid`), Sales (`c_sales`), Accounts, Delivery (`c_delivery`), Finance (A&F) (`d_af`), HR, Legal and Hub Operations (`d_hr`), IT (`d_it`), Marketing & Communication (`d_mkt`), Strategy, Innovation & AI (`d_sia`), Performance (`d_perf`), Sustainability (`d_sus`), Recruitment (`d_recruit`), then the business-line brains Amaris (`d_amaris`), LittleBig Connection (`d_lbc`), Eleven VMS (`d_eleven`), Creative Intelligence (`d_ci`). `id` is the real brain id and `name` the governance's label. `governanceId` is the use-case governance's `g_*` id where one exists, else the node id; `accounts` for Accounts.
  - **Accounts** is a group: `id: "accounts"` (not a brain id: `GET /v1/brains/accounts` is 404), `readers: 0`, `pages` the sum and `health.score` the mean of its children, `children` the account brains the caller may open (by name). It appears only with at least one child. Circles and departments outside the list (Engineering Practices, Delivery Escalations, other circles) are in the directory but not in the nav.
- `BrainCard` gains `role: BrainRole`: the caller's effective role (Personal: `owner`; else owner if they manage, steward if they decide, editor if they edit, contributor if they contribute, else reader).
- `GET /v1/brains?scope=all` returns `{brains: Entry[]}`: every openable brain as the directory gives it plus `canOpen: true`, then the brains the caller can **see but not open**: `{id, type, name, canOpen: false, restricted, canRequestAccess}` (identity only, no pages, readers or health; names the caller's map already shows, never an NDA account without a grant). `canRequestAccess` is the policy's `request_access` right; ask with `POST /v1/admin/access-requests {nodeId: id, reason}` (the existing steward queue). `type` and `q` filter both lists; any other `scope` is 400 `invalid_scope`. Without `scope` the directory is unchanged.

### Seen changes

- A **change** is a maximal run of consecutive added or removed lines in one page's diff, numbered from 0 in page order.
- `GET /v1/wiki/:ws/proposals/:id` adds `changeCount` and, on every `pages[].diff` line that is not `same`, `change: number`. The Waiting-for-you question (`GET /v1/questions`) of a wiki proposal adds `detail.changeCount` and `detail.pages: [{pageId, title, diff: [{type, text, change?}]}]` (same numbering, same masking). Both carry `revisionHash`.
- Approving needs `seenChanges: {revisionHash: string, indexes: number[]}`, on every path that can approve: `POST /v1/wiki/:ws/proposals/:id/decide {decision: "approve", revisionHash, seenChanges}`, `POST /v1/questions/:id {action: "approve" | "prefer_incoming" | "keep_current", revisionHash, seenChanges}` and, per item, `POST /v1/questions/batch {items: [{id, action, revisionHash, seenChanges}]}`. Refused with 409 `{error: "changes_not_seen", reason, changeCount}` (the batch item fails with `error: "changes_not_seen"`) when `seenChanges` is missing, its `revisionHash` is not the proposal's current one, or `indexes` do not cover `0..changeCount-1`. A proposal with no page change needs none. A malformed value is 400 `invalid_seen_changes`. Reject needs no acknowledgement. A missing `revisionHash` is still 400 `revision_required`.
- `[[links]]` in what a reader gets back (search and Ask snippets, page history, proposal diffs, Waiting-for-you diffs) never name a page the reader cannot see: snippets carry no links, the others drop a link to a hidden page, as the page read already did.

### MCP: pushing into a brain

Tools act with the user's rights and name, need the `secondary.read` and `secondary.contribute` scopes (`list_brains` only `secondary.read`), and are audited per call (`mcp.tool_call`, plus the API receipt `brain.push_page`, `brain.push_change`, `brain.push_session_report` with the tool name).

| Tool | Input | API call |
|---|---|---|
| `list_brains` | `{}` | `GET /v1/brains` projected to `{brains: [{id, name, type, role, publication}]}` |
| `propose_page` | `{brainId, title (1..120), markdown (1..20000), type?}` | `POST /v1/brains/:id/push/page` |
| `propose_change` | `{brainId, pageId, markdown, rationale? (..500)}` | `POST /v1/brains/:id/push/change` |
| `write_session_report` | `{brainId, markdown, date? (YYYY-MM-DD)}` | `POST /v1/brains/:id/push/session-report` |

`brainId` is a brain id from `list_brains` or `me`. The three endpoints answer 201 `{ok, brainId, pageId, proposalId, status: "candidate"|"published"}` (`write_session_report` adds `folder: ["Sources", "Session reports", "<Person>"]`) and are also callable from the app with the same rules.
- Rights: the contribute right in that brain (contributor role or above, a stored role only narrows), opened through the admitted view. A brain the caller cannot read is 404 `{error: "not_found"}`, byte for byte what a brain that does not exist gives, whatever the body; a brain they can read but not contribute to is 403 `forbidden`. Rate limit: the wiki write budget (`WIKI_WRITE_PER_MIN`, default 30 a minute), shared with `wiki_propose`.
- The proposal waits in **that brain's** review queue (Waiting for you, `workspaceId` = the brain) and in no other, as a `wiki_ingest` item the person reviews like any other. It is never published directly (M-5), with one exception: `write_session_report` into the caller's own Personal Brain follows that brain's publication mode (`direct` publishes at once, status `published`).
- `propose_change` needs a published page the caller can read (else 404), keeps the page's title and type, and stores `rationale` as the proposal's rationale. A page's cited sources are re-checked for the caller as for any proposal (L-01).
- A session report is a page of type `session_report` (a collection every brain knows, left out of health and the coach), id `session-report-<person>-<date>-<4 hex>`, title `Session report <Person> <date>`, whose Markdown starts with `Folder: Sources / Session reports / <Person>` (the folder; `<Person>` is the display name derived from the address). Two reports on one day are two pages.
- `wiki_propose`, `wiki_search`, `wiki_read`, `get_brain_guide` and `coach_propose_structure` are unchanged. The API accepts these MCP calls only for the routes listed in `INTERNAL_ROUTES` (`workers/api/src/auth.ts`).

## v5 Brain Insights (docs/DESIGN-V5-BRAIN-INSIGHTS.md), normative shapes

Both endpoints aggregate on the server, one brain at a time, from the pages the caller may read (a page resting on a source outside their view does not exist for them). No page body leaves the server; a title appears only for a page the caller can read. `Cache-Control: no-store`, same `brains_v3` pilot flag as `/v1/brains`. Code: `workers/api/src/brains/insights*.ts`; tests `v5-insights*.test.ts`.

### `GET /v1/brains/:id/insights?mode=relevance|freshness&q=&window=7d|30d|90d&scoreKind=freshness|confidence|evidence&focus=<pageId>`

Brain opened through the admitted view like every brain route (not readable or not there: 404, byte for byte the same). `mode` defaults to `relevance`, `window` to `30d`, `scoreKind` to `freshness`; anything else is 400 `invalid_mode`, `invalid_window`, `invalid_score_kind`, `invalid_focus`. `q` is trimmed to 120 characters. A `focus` that is not a readable page of this brain is 404.

```
{ brainId, name, generatedAt, window,
  constellation: {
    mode, q, seed,                      // seed (uint32) is the layout seed: same data, same picture
    terms: [{term, hits}],              // the words of q and the pages each hits
    sectors: [{id, label, count}],      // one per collection (page type) that holds pages, by label
    dots: [{pageId: string|null, sector, r, score, k, inZone, title?, label?, highlight?}],
    rings: [50, 70, 85],                // score rings; r = sqrt((100 - score) / 60) clamped to 0..1
    legend: {inZone, below, perDot, threshold: 85, total} },
  focus: { kind: "brain"|"page", pageId: string|null, title, type,
    coverage: [{key, label, value, target, unit: "pages"|"lines", state: "ok"|"low"|"missing"}],
    timeline: [{label, start, end, kind}],            // ISO days
    activity: {from, to, days: [{date, count}]},
    status: {value: "active"|"watch"|"dormant", since: string|null} | null },  // account brains, brain focus only
  health: { scoreKind, threshold: 60, total, perPoint,
    points: [{pageId: string|null, title: string|null, score, scores: {freshness, confidence, evidence}, source, k}],
    above: {freshness, confidence, evidence},         // pages at or above the threshold, per kind
    weekDelta: {freshness, confidence, evidence},     // of those, pages written in the last 7 days
    sources: [{kind: "sharepoint"|"meetings"|"agents"|"manual"|"import", count}] },
  flow: { window, stages: [{key: "ingested"|"proposed"|"reviewed"|"published"|"promoted", count}],
    publishRate: number|null, medianDaysToReview: number|null, seenAllRate: number|null },
  activity: {from, to, days: [{date, count}]},        // 182 days, only days with edits, readable non-generated pages
  timeline: [{label, start, end, kind}] }              // up to 6 dated pages, oldest first
```

- **Dots.** `k` is the number of pages a dot stands for and `pageId` is null when `k > 1`. A brain with more than 640 pages is bucketed per sector in score order, `legend.perDot` pages to a dot (`ceil(total / 640)`), so `sum(k) = legend.total`. `title` (a readable page title, up to 60 characters) is on every single-page dot. `highlight` and `label` (the title, up to 40 characters) go to at most five single-page dots scoring 60 or more, the best of each collection first so the names spread around the map; they are kept out of the buckets. Score in relevance mode: with a query, a page that hits a word scores 55 to 98 by how well the words fit (title 5, summary 3, body up to 2 points per word with diminishing returns for repeats, each word weighted by how few pages carry it), by how many of the words hit, and by a little for being well linked, so pages that hit the same words land on different scores; one that hits nothing scores 28 to about 84 by nearness (central pages, a collection that holds hits, links with a hit). Without a query: centrality (links in, citations), 40 to 95. In freshness mode: `100 * (1 - age / (1.5 * freshnessDays))`. `inZone` is `score >= 85`.
- **Health scores** (0 to 100, review below 60): freshness as above; confidence is the verified share of the valid facts resting on the page's sources, weighted by stored confidence (no such fact: 50 if the page cites, else 30); evidence is the share of content lines carrying a citation. `source` is `agents` for session reports and pages whose latest proposal came from an agent, `import` for imports, else `sharepoint` or `meetings` by the cited readable sources, else `manual`. Above 1200 pages points are bucketed too (`perPoint`).
- **Flow** counts the proposals created in the window whose title can show only sources the caller may read. `ingested` is at least `proposed`. `promoted` appears for team and account brains only. `medianDaysToReview` is the median of decision time minus creation time of reviewed proposals. `seenAllRate` is 100 when any approval went through review (the server refuses an approval without every change seen), else null.
- **Focus.** Brain focus: `coverage` is one row per collection the brain's template expects (`target` 3 pages); `status` is derived from the last edit (active within 30 days, watch within 90, else dormant). Page focus: `coverage` is one row per section the page's type requires (`target` 2 lines), `timeline` its revisions. Changing a status in the app files a proposal through `POST /v1/brains/:id/push/page`, so it goes through the brain's review.

### `GET /v1/brains/overview`

`{generatedAt, brains: OverviewTile[]}` for the brains the sidebar would list (Personal, governance brains, account brains, Company Global) that the caller may open, in the sidebar's order. Each tile is computed from that brain only; a brain the caller cannot open adds no tile, count or title. Tile: `{id, type, name, template, pages, health: {score}, zone: {inZone, total}, seed, sectors, dots: [{s, r, z, k}], sparkline: number[12], lastActivityAt}` (a freshness constellation capped at 140 dots; `s` is the sector index, `sparkline` weekly edit counts, oldest first). No titles.

## v6 My Agent (docs/DESIGN-V6-MY-AGENT-GENUI.md), normative shapes

The line language, component registry, Zod props, planner and re-resolution live in `packages/contracts/src/agent-ui/` (import `@secondary/contracts/agent-ui`; deep-import in the Worker). Findings: `docs/research/OPENUI-SPIKE.md`. An answer is a program of lines `id = Component(arg1, ...)` with positional arguments in the key order of `schemas.ts`; `root = Stack([...])` comes first. Props are queries and ids, never data: every number, title and list is resolved server-side for the viewer by the existing endpoints (`/v1/brains/:id/insights`, search, pages).

### `POST /v1/agent/turn` (server-sent events)

Request (`TurnRequest`, strict): `{text?: string(1-500), action?: {action, values}, previous?: string, lang?: "en"|"fr", density?: "compact"|"comfortable"}`. One of `text` or `action` is required. `action` is the structured event of a button click (`focus {brain, page?}`, `compare {a, b}`, `filter {brain, q}`, `ask {text}`); anything else is 400. `previous` is the last answer's program, so "make it denser" or "add the funnel" edits a plan. History is kept in the browser, never on the server.

Response `200 text/event-stream`, events in this order: `meta {turnId, mode: "ai"|"deterministic", reason?}`, zero or more `line {text}` (one finished statement each, already checked by `lineOk` and by the caller's admitted brains; on the AI path each goes out as the model finishes it), `reset {}` when the lines so far are not the answer (the model went on to call a tool, or failed: the client clears them and a second `meta` follows), optional `dropped {count}`, `usage {inputTokens, outputTokens, model: string|null}`, `done {turnId, lines}`; or `error {code}` instead of the rest. A refused AI gate is not an error: the turn answers with `mode: "deterministic"` and `reason` (`ai_disabled`, `ai_not_configured`, `ai_budget_exhausted`, `ai_unavailable`, `ai_constraint`). The deterministic planner (`planProgram`) writes the same lines. 400 `invalid_body` (unknown key, no `text` and no `action`, a link action such as `open_page` or `open_brain`, bad action values), 401, 403 (`brains_v3` flag off), 413 (body over 32 KB), 429 rate limit (20 turns a minute a person). Code: `workers/api/src/agent/`.

Implementation notes (normative for the client):
- `meta` is sent once the answer is known, so its `mode` is the mode that answered: a turn that falls back from the model says `deterministic` with `reason: "ai_unavailable"` (refusal, `max_tokens` with nothing finished, `pause_turn`, a provider error, a cut stream, no valid line, no root, more than 4 rounds) or `ai_budget_exhausted` (the budget ran out between rounds). Lines are sent when the last model round ends, each already checked on its own (`lineOk`) and against the caller's admitted brains; text written before a tool call is discarded. `dropped.count` counts every refused line of that answer.
- Deterministic mode ignores `previous` (the planner answers the text or action on its own); the AI path gets its statement lines as the current view to edit.
- The model's tools never reach Personal (`me`) or an account whose `AI use with client` is not `allowed`; a question or action that names such an account is answered deterministically with `reason: "ai_constraint"` and no call.
- `usage.inputTokens` counts the input the provider reports, cached prefix tokens included, summed over rounds. The ledger row and the receipt are written before `done`, and also when the client has gone.
- The receipt is `agent.turn`, `nodeId` the turn id, `reason` `mode=<mode> lines=<n> dropped=<n> [reason=<code>] [tools=<names>]`.

AI path: the Worker streams the Anthropic Messages API (system prompt = `agentSystemPrompt()`, frozen and cached) with these read-only tools, all run with the caller's rights and name: `list_brains`, `search`, `read_page`, `brain_insights`, `wiki_facts` (`AGENT_TOOLS` in the contract). Retrieved page text goes back inside `<data ...>...</data>` with `<` escaped, as data, never instructions. No write tool exists. The gate is the usual one (tenant `ai` switch, `AI_ENABLED`, `AI_PROCESSOR_CONTRACT=approved`, daily tenant and per-user budgets, the account contract check before reading an account page). Each turn writes tokens to Usage (capability `agent`, `runs` 1, `answers` 1, `tokens` 0 for a deterministic answer) and one receipt with ids only (`agent.turn`, never text).

### Saved views `/v1/views`

Plan and layout only, never data. Personal by default (the caller's own scope). A view: `{id, name, pin: "home" | {brain}, layout?: {x, y, w, h} (12-column grid), program, updatedAt, shared: boolean}`.

- `GET /v1/views[?pin=home|<brainId>]` answers `{views: [...]}`, newest first, each with `tree` (below); another `pin` value is 400 `invalid_pin`. `GET /v1/views/:id` one view. `POST /v1/views` (`SavedViewInput`: name 1-60, program up to 8 KB that must be a finished program with a root and no dropped or refused statement, else 400 `invalid_program`; every brain it names and the pin's brain must be readable by the caller, else 400 `brain_not_readable`; unknown keys 400 `invalid_body`) answers 201. `PUT /v1/views/:id` changes any of name, program, pin, layout. `DELETE /v1/views/:id` answers 204. At most 50 per person (409 `too_many_views`). Another person's id is 404.
- `tree` is the program parsed, validated and **re-resolved for the viewer**: `lockTree` replaces every card that names a brain the viewer cannot read with `{type: "Locked", props: {reason: "no_access"}}` carrying no title, id or text, and drops buttons that name one. The same happens when the owner opens a view after losing access.
- `POST /v1/views/:id/share` returns 200 `{shareId, path: "/agent/shared/<shareId>"}` (the same link again if already shared; it follows the owner's edits); `DELETE /v1/views/:id/share` revokes it (204); deleting the view revokes it too. `GET /v1/views/shared/:shareId` returns `{name, tree}` for any signed-in person of the tenant, re-resolved for that person: a lower-privilege person gets less or locked cards, never more. A share is a link to the plan, never a snapshot of data.
- Receipts (`agent.pin`, `agent.unpin`, `agent.share`) hold ids only.

### Settings

Density, card theme, language, token display and the cleared history are per device (local storage); the server stores none of them.

## v7 Operate: Brain activity, Sources, Platform health

Design: `docs/DESIGN-V7-GOVERN-OPERATE.md` sections 2 to 4. Pure model (statuses, retry plan, latency stats, buckets, heatmap) in `packages/contracts/src/ops-v7.ts`. **Ids, counts, timings and `ruleId@version` only. No page content, title or text in any response.** Every response is `Cache-Control: no-store`. `partial: true` means the audit worker did not answer, so the receipts part of the numbers is missing (the audit worker returns the newest 200 receipts of the tenant, so a busy tenant shows a shorter span than the window). `synthetic: true` marks numbers produced by the dev stand-in (mocked Graph, `OPS_SYNTHETIC=on`, dev only); staging and prod never answer synthetic data.

Shared vocabulary: status `published | needs_review | blocked | failed | retrying`; failure reason `permission_denied | graph_429 | timeout | blocked_by_rule | classifier_asked | parse_error`.

### Event shape (`OpEvent`)

`{id: "evt_<16 hex>", type, source: {kind: "agent"|"connector"|"human"|"system", label}, status, attempts: {count, max, outcomes: ("fail"|"ok"|"scheduled")[]}, latencyMs: number|null, at: ISO, reason: FailureReason|null, ruleRef: "ruleId@version"|null, retryable: boolean}`. `type` is `wiki.propose_page`, `connector.sync`, `ingest.run`, `classifier.ask` and so on. `source.label` is a host name (Claude, ChatGPT, Dust, Codex, Copilot), a connector source name, or "Person" (never a name). `ruleRef` is read from the receipt (a `ruleId@version` token in its reason) and is null when none is named.

### `GET /v1/brains/:id/activity?window=60m|24h|7d&status=all|needs_review|blocked|failed&q=&from=&to=`

Brain managers only (the caller needs `manage` on the brain: 403 otherwise, 404 outside the admitted view). `status=failed` matches `failed` and `retrying`. `q` (max 80) matches type, source label, event id or rule ref. `from`/`to` (ISO, inside the window) narrow the table to a brushed span; the timeline always shows the whole window.

`{brainId, window, from, to, generatedAt, synthetic, partial, perDot, buckets: [{start, end, total, counts: {published, needs_review, blocked, failed, retrying}}], callout: {since, kind: "blocked"|"failed", label, count}|null, totals: {all, published, needs_review, blocked, failed, retrying, matching}, events: OpEvent[] (newest first, at most 200)}`. 60 buckets of a minute, 48 of 30 minutes, 84 of 2 hours. `perDot` is how many events one dot stands for (so a column never stacks more than 14 dots).

### `GET /v1/brains/:id/activity/:eventId`

Same access. `{...OpEvent, steps: [{kind: "attempt"|"classifier"|"rule"|"review"|"policy", label, state: "ok"|"fail"|"pending"|"skipped", at: ISO|null, ms: number|null, code: string|null}], metadata: {receiptId?, action?, nodeId?, scopeId?, decision?, requestId?, clientId?, tool?, host?, ruleId?, ruleVersion?, sourceId?, jobId?, verdict?}, retry: {requestedAt: ISO}|null}`. `metadata` is ids and short codes only. An unknown or out-of-scope id is 404.

### `POST /v1/brains/:id/activity/:eventId/retry`

Brain managers only. Retryable events are connector sync failures (the source is synced now) and ingest or classifier failures (the ingest job is queued again). Anything else is 409 `not_retryable`. **Idempotent:** the first call answers 202 `{ok: true, retryId, kind: "connector"|"ingest", already: false}`; any later call for the same event answers 200 with the same `retryId` and `already: true` and does nothing. Audited once as `activity.retry` (ids only). Never re-sends content anywhere.

### `GET /v1/agents/activity?window=60m|24h|7d&host=&status=&q=` and `GET /v1/agents/activity/:eventId`

The caller's own agent connection calls only (receipts with their principal and an MCP client). Same shapes as above without `brainId`, `retry` and `retryable` (always false); adds `hosts: [{id, label, count}]`. Shown under Settings, Agents.

### Sources (admins; `configure` right)

`GET /v1/sources` lists. `GET /v1/sources/:id` with an id of the form `src_...` (no colon) is the source config; an id of the form `src:<sourceId>:<hex>` stays the file record described under Connector. Everyone else is 403.

- `GET /v1/sources` -> `{synthetic, sources: [{id, name, provider: "sharepoint_drive"|"onedrive_folder", target: {brainId, label, collection}, status: "active"|"paused", lastSyncAt: ISO|null, lastError: string|null, files, nextRunInSeconds: number|null, synthetic}]}`.
- `GET /v1/sources/:id` -> `{id, name, provider, location: {label, folder}, target: {brainId, label, collection}, chips: {selected: string[], available: string[], total}, credential: {name, rotatedAt: ISO|null, pending: {requestedAt}|null}, schedule: {deltaMinutes}, retry: RetryPolicy, timeoutSeconds, aclMaxAgeSeconds, status, lastSyncAt, lastError, synthetic}`. `chips` are file types and folders ("pdf", "docx", "/Proposals"). `credential.name` is the secret's name, never a value.
- `PUT /v1/sources/:id` (merge, every field optional): `{chips?: string[] (max 40, each 1-60 of [A-Za-z0-9/._ -]), schedule?: {deltaMinutes: 5..1440}, retry?: RetryPolicy, timeoutSeconds?: 1..120, aclMaxAgeSeconds?: 60..86400, status?: "active"|"paused"}`. `RetryPolicy` is `{kind: "exponential", baseSeconds: 1..3600, maxSeconds: <=86400, tries: 2..12} | {kind: "linear", everySeconds, tries} | {kind: "fixed", times: number[1..11]} | {kind: "none"}`. 400 `invalid_retry` and similar codes name the field. Audited `source.config` (ids and key names only). Answers the new config.
- `POST /v1/sources/:id/run` -> 202 `{ok: true}` ("Run sync now"); 409 `paused` while paused. Audited `source.run`.
- `POST /v1/sources/:id/credential/rotate` -> **two people**. First call 202 `{status: "pending", needs: "second_person", name}`; a different admin's call within 24 hours 200 `{status: "rotated", name, rotatedAt}`; the same person twice stays pending. Neither answer, nor any receipt, holds a secret value. Audited `source.rotate_request` and `source.rotate`.
- `GET /v1/sources/:id/stats?window=24h|7d` -> `{synthetic, retry: {plan: [{try, afterSeconds, atSeconds}], tries, totalSeconds, honoursRetryAfter: true, next: {try, inSeconds, last: "429"|"timeout"|"503"|...}|null}, latency: {n, timeoutSeconds, p50Ms, p95Ms, timedOut, timedOutShare, hint: {raiseTimeout, suggestedSeconds}, points: [{ms, outcome: "ok"|"timeout"|"429"|"error"}]}, acl: {maxAgeSeconds, total, confirmed, stale, failClosed, share}}`. `points` are the last N Graph calls (at most 320), newest last.

### `GET /v1/health?window=1h|24h|7d`

`GET /v1/health` without `window` stays the unauthenticated liveness probe `{ok, env, version}`. With `window` it is Platform health and needs a signed-in admin or steward (a 400 `invalid_window` for any other value).

Admins see the tenant; a brain steward (`manage` on one or more brains) sees the same cards limited to those brains; anyone else is 403. `scope` says which.

`{window, generatedAt, scope: "tenant"|"stewards", synthetic, partial, slo, success: {attempts, delivered, failed, rate}, outcomes: {firstTry, recovered, failing}, failures: [{reason, count, share}], heatmap: {columnMs, columns: ISO[], rows: [{id, kind: "brain"|"source", label, total, failed, cells: [{attempts, delivered, failed, failing, topReason, ruleRef}]}]}, totals: {attempts, delivered, failed}}`. An attempt is one operation (a receipt, an ingest job, a sync run), not each try: `attempts = firstTry + recovered + failing`, `delivered = firstTry + recovered`, `rate = delivered / attempts` (1 when none). `slo` is 0.99. A cell is a failing hour when at least 10 percent of its attempts failed. Columns: 12 of 5 minutes (1h), 24 of an hour (24h), 28 of 6 hours (7d). Heatmap rows are the brains and sources the caller may see; counts only, never content.

### Connector recording (workers/connector, internal)

The connector now records each Graph call (`ms`, outcome `ok|timeout|429|error`) and each sync attempt (`outcome`, `reason`, try number, latency) per source, keeps the last 320 calls and 7 days of attempts, and serves `GET /internal/sources/:id/stats` and `GET /internal/ops/summary` (signed like the other routes). A source carries `settings` (chips, schedule, retry policy, timeout, ACL max age) and `paused`; pause keeps the synced items (unlike disabling a source). The api reads these through the `CONNECTOR` binding; with `OPS_SYNTHETIC=on` (dev) and no connector it answers deterministic synthetic data instead and says so.

Events come from three places: audit receipts (scoped to the brain by scope id or node id), the brain's wiki log (`ingest.triage`, `ingest.skipped` as `classifier.ask`, `*.failed`; a failed ingest log row now carries its `sourceId`) and connector sync attempts. A streak of failed syncs that ends in a success is one event (recovered on retry); a streak still going is `retrying` until the policy's tries are used up, then `failed`. The rotation of a credential approves the change and records `rotatedAt`; the new secret value is set out of band (`wrangler secret`), the API never sees it.

Receipts: `activity.retry`, `source.config`, `source.run`, `source.rotate_request`, `source.rotate`, ids and key names only.

## v7 Brain rules (docs/DESIGN-V7-GOVERN-OPERATE.md section 1), normative shapes

Pure model, validator, evaluator and simulator: `packages/policy/src/rules.ts` (`@secondary/policy`: `validateRule`, `evaluateRules`, `simulateRules`, `diffRules`, `floorMin`, `FIELD_SPEC`). Storage in `TenantPolicy` (tables `rules`, `rule_versions`, `rule_drafts`, `rule_holds`, `incident`; all in the tenant snapshot). API: `workers/api/src/rules/`.

### Rule model

`RuleDraft = {name (3-80), scope, when: Condition[] (1-8, AND), then, except: {incident: boolean}, status: "draft"|"monitor"|"enforced"}`.

- `scope`: `{kind: "tenant"}` | `{kind: "brain_types", types: ("team"|"account"|"global")[]}` | `{kind: "brains", ids: string[]}`. A rule never reaches a Personal Brain (floor).
- `Condition = {field, op, values: string[]}`. Fields and what they take (`FIELD_SPEC`): `actor` (`human`, `agent` = any MCP host, `claude`, `chatgpt`, `dust`, `codex`, `copilot`, `connector`), `actor_role` (brain roles and policy role ids), `action` (`propose_page`, `propose_change`, `publish`, `export`, `promote_to_global`, `import`, `write_session_report`, `share_view`), `brain` (brain ids), `brain_type` (`team`, `account`, `global`; `personal` is refused), `content_flag` (`personal_data`, `client_name`, `confidential_field`, `unsupported_claim`), `size_pages` (op `greater_than`, one whole number), `ai_contract` (`allowed`, `unknown`, `not_allowed`), `time` (`weekdays`, `weekend`, `outside_business_hours`; tenant time zone, business hours Mon-Fri 08:00-18:00). Ops: `is_any_of`, `is_none_of` (all fields but `size_pages`), `greater_than` (`size_pages` only).
- `then`: `{effect, approvers?, expiresAfterMin?, message?}`. Effects: `review` (one approver), `two_approvers`, `group` (needs `approvers`: `stewards` and/or `privacy`), `block` (needs `message`, up to 200 characters, shown to the refused person or agent), `notify` (allow and notify: a notification to the brain's stewards plus the audit receipt), `expire` (needs `expiresAfterMin` 1-1440: an agent write grant lasts that long).
- `except.incident`: while incident mode is on the effect becomes `notify` (never below a floor).

### Hard floors

A rule can only tighten. Seven floors (`FLOOR_IDS`): `personal_privacy`, `nda_named_grants`, `global_two_person`, `every_change_seen`, `everyone_ban`, `ai_gate`, `mcp_review`. A rule that would loosen one is refused at save with 422 `rule_refused` and `issues: [{code: "floor", path, message, floor}]`; a rule that is simply wrong gets the same envelope with other codes (`invalid_name`, `invalid_scope`, `invalid_when`, `invalid_condition`, `invalid_operator`, `invalid_values`, `invalid_effect`, `invalid_approvers`, `invalid_expiry`, `invalid_message`, `invalid_except`, `invalid_status`, `loosens_policy`). A rule whose every reachable situation sits under a floor and whose effect (or incident exception) is weaker than the floor asks is refused; a broad rule that only reaches into a floor is accepted and the evaluator holds the floor at run time. Effect kinds that name a loosening (`allow`, `auto_approve`, `skip_seen`, `grant_access`, `open_to_everyone`, `bypass_ai_gate`, `bypass_review`) are refused with the floor they break.

### Evaluation and enforcement

Composed after the base policy: a base deny always wins, rules only add. The tightest enforced match wins (`block` > `two_approvers` > `group` > `review` > `notify` > `expire`), ties go to the lower rule id. A `monitor` rule that matches changes nothing: it writes a receipt `rule.would_match` (`ruleMode: "monitor"`). Enforced matches write `ruleId@version` on the receipt of the action (`rule` field) and `meta` (actor kind, host, brain type, content flags, pages, contract).

Where it runs (server side, in the API, so MCP calls through the internal binding are covered): `POST /v1/wiki/:ws/propose`, `POST /v1/brains/:id/push/{page,change,session-report}` (`propose_page`, `propose_change`, `write_session_report`), `POST /v1/wiki/:ws/proposals/:id/decide` (approve = `publish`), `POST /v1/wiki/:ws/pages/:pid/promote` (`promote_to_global`), `POST /v1/brains/:id/import` (`import`), `GET /v1/brain/export` (`export`), `POST /v1/views/:id/share` (`share_view`), `POST /internal/connector/upsert` (`import`, actor `connector`).

- `block`: 403 `{error: "blocked_by_rule", rule: "id@v", message}`; nothing is written.
- `review`, `two_approvers`, `group` on a path that creates a proposal (propose, push, import, promote): the proposal is created as usual and stamped; its `required` approvals rise to 1 or 2 and a `group` rule limits who may approve (decide answers 403 `approver_group_required`). `review` also turns a direct publish into a candidate. On `decide`, the same evaluation can raise the approvals needed (`publish`).
- `review`, `two_approvers`, `group` on a path with no proposal (export, share_view): 202 `{status: "needs_approval", holdId, rule, required}`. An approver (a steward of that brain or an admin, never the requester) decides at `POST /v1/rules/holds/:id/decide`; the requester repeats the call with `X-Rule-Hold: <holdId>` once approved (single use, 24 h). Connector sync cannot wait: an approval effect holds the batch back (`{ok: true, changed: 0, held: "id@v"}`).
- `notify`: the action proceeds, a notification goes to the brain's stewards (Waiting for you) and the receipt carries the rule.
- `expire`: an agent's write grant lasts `expiresAfterMin` minutes from its first call. After that its writes (propose, push, import, promote) are 403 `grant_expired` `{rule, minutes}` until the person connects again (a new grant). Humans and reads are not limited. The accepted proposals carry `meta.expiresAfterMin` on their receipt.
- Approver groups: `stewards` is whoever holds `approve_release` in the brain; `privacy` is the people an admin listed at `PUT /v1/rules/groups`. A stamped group answers an approval from anyone else with 403 `approver_group_required` `{groups}`. A rule published after a proposal still applies when the proposal is decided (`publish` is evaluated again at approve time: block, more approvals, group).
- Receipts written by the gate: `rule.block` (deny, the refusal), `rule.hold` (deny, held for approval), `rule.would_match` (allow, `ruleMode: "monitor"`), and the action's own receipt with `rule`, `ruleMode: "enforced"` and `meta` (always `meta`, even with no rule, so a simulation can replay it). The receipt contract (`packages/contracts/src/audit-receipt.ts`) gained the optional `rule`, `ruleMode` and `meta` (ids and enumerated labels only; an unknown label makes the receipt invalid).

### Endpoints (`/v1/rules`, admins tenant-wide, stewards for their brains)

An admin is a person with `configure`. A steward is a person who may decide in the brain. A person who is neither gets 404 (the surface does not exist for them). A steward sees and edits only rules whose scope is `brains` and every id is a brain they may decide in; rules that reach their brain from elsewhere are listed read-only (`editable: false`).

- `GET /v1/rules[?brain=<id>]` -> `{canEdit, brain: {id, label} | null, rules: RuleRow[], counts: {total, enforced, monitor, draft, new: number, since: ISO date}, incident: IncidentState, holds: HoldRow[]}`. `RuleRow = {id, name, scope, scopeLabel, status, version (published, 0 when never published), effect, updatedAt, updatedBy, hasDraft, editable, readOnly?: true, floor?: FloorId}`. The read-only floor row (`id: "floor:mcp_review"`, status `enforced`, `readOnly: true`) is listed first. `counts.new` is the number of rules created in the last 30 days (`since` is that date, "+N since").
- `GET /v1/rules/:id` -> `RuleDetail = RuleRow & {draft: RuleDraft, published: RuleDraft | null, nextVersion, editedBy, editedAt, needsSecond: boolean, pending: {by: "you"|"other", at: ISO, kind: "publish"|"rollback", version} | null, history: VersionRow[]}`. `draft` is the unsaved-to-publish body (the published one when there is no draft). `VersionRow = {version, status, by, at, rolledBackFrom?: number, changes: RuleChange[]}`; `RuleChange = {part, from, to}`.
- `POST /v1/rules` (`RuleDraft`) -> 201 `RuleDetail` (saved as a draft, version 0). `PUT /v1/rules/:id` (`RuleDraft`) -> 200 `RuleDetail` (the draft; the published version keeps running). `DELETE /v1/rules/:id` -> 204, only a rule never published. A steward may only save scope `brains` with brains they decide in (403 `scope_not_allowed`).
- `POST /v1/rules/validate` (`RuleDraft`) -> 200 `{ok: true, needsSecond}` or 422 `rule_refused`.
- `POST /v1/rules/simulate` `{rule: RuleDraft, days: 7|30}` -> `{days, total, matches, split: {approval, blocked, allowed}, samples: [{at, actor: {kind, host}, action, brain: {id, label}, effect}] (up to 5, newest first), addedWaitMin, approvalsPerDay, estimate: true}`. Replays the audit receipts of the window (ids and metadata only) against the draft; a steward replays only receipts of brains they decide in; a brain the viewer cannot see is `{id: "restricted", label: ""}`. No content, no person.
- `POST /v1/rules/:id/publish` `{expectedHash: string (the detail's `draftHash`; 400 `expected_hash_required` when missing, 409 `draft_changed` when the draft moved on), status?: "draft"|"monitor"|"enforced"}` (defaults to the draft's status; `draft` withdraws the rule: a published version nothing enforces; anything else is 400 `choose_status`) -> 200 `{status: "published", version, rule: RuleDetail}`, or 202 `{status: "pending", needs: "second_person", rule}` when the published scope or the new scope can touch restricted, account or Global brains, or the change loosens, narrows, disables or withdraws a live rule (`weakensRule`: lower status or effect, other conditions, another scope that is not the whole tenant, other approvers, incident exception turned on) (a `tenant` scope, a type scope with `account` or `global`, or a named brain that is restricted, an account or Global): a different admin or (for named brains) steward confirms by calling publish on the same draft (changing the draft starts again). Same person twice is 202 with `sameActor: true`.
- `POST /v1/rules/:id/rollback` `{toVersion}` -> 200 or 202, always two-person. The rollback is a new version (vN+1) copying the old body and status, with `rolledBackFrom`.
- `GET /v1/rules/incident` -> `IncidentState = {on, since, until, by?: "you"|"other", pending: boolean}`; `PUT /v1/rules/incident` `{on, reason?}` (admins): switching it on is two-person (202 until a different admin repeats it) and lapses after 24 hours; calling On while it is on is an extension, also two-person, 24 hours more and never past 72 hours after it began (409 `incident_max`); switching it off is one admin.
- `PUT /v1/rules/groups` `{privacy: string[]}` (admins, principal ids): who is in the `privacy` approver group. The `stewards` group is whoever holds `approve_release` in the brain.
- `GET /v1/rules/holds` -> `HoldRow[] = {id, rule, action, brain: {id, label}, requestedAt, required, approvals, group: string[], mine: boolean, canDecide: boolean}`; `POST /v1/rules/holds/:id/decide` `{decision: "approve"|"reject"}` -> `{status: "pending"|"approved"|"rejected", approvals, required}`.

Receipts (ids only): `rules.save`, `rules.publish`, `rules.rollback`, `rules.incident`, `rules.hold_decide`, `rule.would_match`, and `rule` on every enforced decision. Seed (dev only, synthetic): the five rules of the design, published as v1 by the system (`rules_seed_version`).

## v8 lens (docs/DESIGN-V8-AMAZING.md sections 3 to 6), normative shapes

Page lens, Who knows, faceted search and pulse. Code: `workers/api/src/lens/`, `people/`, `search2/`, `pulse/` (one mount, `lensMount` in `routes.ts`), `LensBase` in `lens/store.ts` between `BrainBase` and `Workspace`. One rule runs through all of it: **an answer is built only from brains the caller reads, and only from pages and lines the caller may read** (a page is visible when it cites nothing or at least one readable source; a line when every source it cites is readable). Unreadable targets are omitted, never shown as locked: an unreadable page or brain is 404 on a direct call, and absent from every list, graph, count and facet. A person who opted out of expert listing is named nowhere in these answers. All answers are `Cache-Control: no-store`.

### `GET /v1/brains/:id/pages/:pid/lens`

Needs the `brains_v3` pilot flag. 404 for a brain or page the caller cannot read. Answer:

```
{page: {id, title, type, collection, brainId, brainName, status: "published", revision, updatedAt,
        lastChange: {at, revision, by: {id, name} | null}},
 freshness: {state: "fresh" | "aging" | "stale", days, score, freshnessDays},
 verified: {by: {id, name} | null, at} | null,
 graph: {nodes: [{key: "<brainId>:<pageId>", brainId, brainName, id, title, type, collection, hop: 0 | 1 | 2}],
         edges: [{from, to}]},
 facts: [{id, subject, predicate, object, validAt, invalidAt, unverified, contradiction, replacedBy}],
 contributors: [{id, name, role, changes, lastAt}], unnamed,
 backlinks: [{brainId, brainName, id, title, type, collection}],
 who: PersonRow[]}
```

- **Graph.** The page (`hop` 0), the pages one link away in either direction (`hop` 1, at most 12), then the pages one more link from those (`hop` 2), at most 24 nodes. A link counts only on a line the caller may read. Neighbours are visible hand-written pages of the same brain, or of Company Global through `[[global:<id>]]` when the caller reads Company Global. Toward a Company Global page, backlinks also come from other brains the caller reads (never Personal). Generated hubs (overview, logs) and journals are not neighbours. `edges` join known nodes only.
- **Facts** are the facts whose sources the page cites, all of whose sources the caller may read (newest first, at most 24). `contradiction` is true when another fact for the same subject and predicate says something else for an overlapping time; `replacedBy` is the fact that took over when this one ended.
- **Freshness.** `state` is `fresh` up to half of `freshnessDays`, `aging` up to `freshnessDays`, then `stale`; `score` is the v5 freshness score.
- **Verified** is the latest confirmation of a fact the page stands on (service actors excluded). `by` is null when that person opted out: the stamp stays, the name goes.
- **Contributors** come from approved revisions of this page (the author of the approved proposal, else the revision actor; hidden versions and services excluded). `role` is the person's stored brain role there, else `contributor`. `unnamed` counts people left out by their choice.
- `who` is Who knows for the page and its neighbours (below), top 5.

### Who knows

- `GET /v1/brains/:id/who-knows?page=<id> | collection=<type> | q=<text>&limit=1..20` (default 5, 400 `invalid_limit`): one brain the caller reads (404 otherwise; `brains_v3`). With none of the three, the whole brain. `page` weighs the page 3 and the visible pages it links to or that link to it 1. A `q` hit counts only when a word stands in text the caller can read.
- `GET /v1/who-knows?q=<text>&brain=<id or name part>&limit=` across the brains the caller reads, Personal Brains never included. 400 `invalid_query` without words. Rate limited (60 a minute a person).

Answer `{scope: {kind: "page" | "collection" | "query" | "brain", label} | null, people: PersonRow[]}`, `PersonRow = {id, name, role, brainId, brainName, contributions, pages, lastAt, score}`: one row per person and brain. Ranked by approved changes in scope with a 180 day half life (`people/rank.ts`); work activity only, no HR data, no Personal Brain. `name` is the directory name, else a name made from the id.

### Expert listing

`GET /v1/me/expert-listing` answers `{listed: boolean}` (default true). `PUT` with `{listed: boolean}` (400 `invalid_listed`) answers the same and writes the receipt `personal.expert_listing` (ids only). The choice lives in the person's own Personal Brain object. Any principal id of the same human that opted out counts for all of them. Opted-out people are left out of Who knows, the page contributors and the verified name, whole, not just from the top.

### `GET /v1/search/pages`

`?q=<words and operators>` and optional `brain`, `type`, `status`, `role`, `age` (comma lists), `fresh` (`<30d`), `limit` (default and cap 50), `facets=0`. Needs a word or at least one filter, else `{results: []}`. 400 `invalid_query` over 300 characters. Rate limited (120 a minute a person).

**Operators** (`search2/query.ts`, pure and total): `brain:<id or name>`, `type:<page type or collection name>`, `fresh:<30d` / `fresh:>2w` / `fresh:30d` (units d w m y, 1 day to 10 years; `<` younger than, `>` older than), `status:verified|unverified`, `role:owner|steward|editor|contributor|reader|system`. At most 8 operators per query; values are 1 to 64 letters, digits and `_ . : -`; quotes keep a space together in the word list. Anything else, including an unknown operator or a malformed value, stays a free word and is listed in `parsed.ignored`. Operators only narrow: an unknown or unreadable `brain:` matches nothing.

Answer:

```
{q, parsed: {text, brain, type, status, role, fresh, ignored}, total,
 results: [{brainId, brainName, id, title, type, collection, summary, updatedAt, ageDays,
            fresh: "lt30" | "lt90" | "lt180" | "older", status: "verified" | "unverified",
            role, lines: [{text, citations: [{id, title}]}], restricted}],
 facets: {brain, type, fresh, status, role: [{id, label, n, on}]}}
```

Each result carries its preview (`summary`, up to 4 readable claim lines with the titles of readable sources; a hit on the title alone previews the first lines). `role` is the role of the person behind the last approved change (`system` for none). `status` is `verified` when a fact the page rests on was confirmed by a person. Facet counts are over the hits after every filter but the facet's own (picking a value never empties the others) and count only hits the caller may read, so a brain the caller cannot read is not there, not even at zero. `type` is the page type; the collection of a page is its type (labelled by the brain's schema).

### Saved searches

`GET /v1/search/saved` answers `{saved: [{id, name, q, at}]}`, newest first. `POST /v1/search/saved {name, q}` (name 1-60, q 1-300, else 400 `invalid_saved_search`) answers 201 with the list; the same `q` replaces the earlier entry; `id` is `s_` plus 12 hex digits of the hash of `q`; at most 25 (409 `too_many_saved`). `DELETE /v1/search/saved/:id` answers 200, or 404 for an id that is not the caller's. Stored in the person's own Personal Brain object; a saved search holds the query text only, and it is run again, as the caller, when opened.

### Pulse

Needs the `journal` pilot flag. Built from each brain's own journal pages (`journal-<date>`), which hold counts and `[[page]]` links only.

- `GET /v1/brains/:id/pulse?days=7..90` (default 60; 400 `invalid_days`; 404 for a brain the caller cannot read): `{brainId, name, from, to, categories, days: [{date, counts: {published, resolved, sources, gaps, rules}, total, pages: [{id, title}]}]}`, newest day first, only days that have a journal. `pages` names only pages the caller may read.
- `GET /v1/pulse?days=7..90` (default 30): `{categories, from, to, brains: [{brainId, name, type, days: [{date, d: number[5]}]}]}`, one row per brain the caller reads (Personal included), each built only from that brain; `d` is the five counts in category order.

Categories: `published` ("N changes published"), `resolved` ("N older facts ended"), `sources` ("N page proposals filed"), `gaps` ("N gaps closed"), `rules` ("N rules triggered"). The first three are read from the journal as it is written today; `gaps` and `rules` read the journal lines that the knowledge gaps and rules work add and are 0 until a journal carries them.

### My Agent: `PeopleList`

A leaf component of the v6 line language: `PeopleList(q, brain?, limit?)` (`q` 1-120 characters, `limit` 1-8, props are a query, never data). The client resolves it for the viewer with `GET /v1/who-knows?q=&brain=&limit=`, so it lists only people from brains the viewer reads, and not those who left the expert listing. The deterministic planner writes it for "who knows about X (in Y)" and its French forms. `lockTree` replaces it with a locked card when `brain` is not readable.
