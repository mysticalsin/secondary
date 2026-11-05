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
- Client allowlist (B-05): redirect URI hosts on an allowlist (claude.ai, claude.com, chatgpt.com, chat.openai.com, dust.tt, eu.dust.tt, localhost for Claude Code and MCP Inspector). Anything else is rejected and audited.
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

Headers (all three required):

| Header | Value |
|---|---|
| `X-Secondary-Principal` | base64url(JSON), `{v:1, iss:"secondary-mcp", aud:"secondary-api", sub, email, persona?, client_id, scope:[...], tool}` |
| `X-Secondary-Timestamp` | unix seconds, integer |
| `X-Secondary-Signature` | `v1=` + lowercase hex HMAC-SHA256 |

`signature = HMAC-SHA256(INTERNAL_HMAC_KEY, ["v1", timestamp, METHOD, pathname+search, sha256hex(body), principalHeaderValue].join("\n"))`. The key is the secret `INTERNAL_HMAC_KEY` (at least 32 characters), set on both workers. Skew is 60 seconds either way. Method, path, query, body and principal are all signed. There is no nonce, so an identical request can be replayed inside the 60 second window by something that can already reach the binding.

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
- Roles of a request are the stored role assignments plus the roles mapped from the principal's Entra groups (`TenantPolicy.groupMapSet/List/Delete`, keyed by group object id). A SCIM-provisioned principal takes groups from SCIM only, others from the groups claim of their last login.
- SCIM 2.0 at `/scim/v2` with `Authorization: Bearer <SCIM_TOKEN>`: `Users` and `Groups` (GET list with `filter=attr eq "value"` on `userName`, `externalId`, `id` / `displayName`, `externalId`; `startIndex`, `count`; GET/POST; PATCH add, remove, replace; DELETE), `ServiceProviderConfig`, `ResourceTypes`. A group is matched to the role table by its `externalId` (the Entra object id). PUT, Bulk, sort and complex filters are not supported.

## B2 GOV: governance console (`/v1/admin/*`, `workers/api/src/admin`)

Roles are data in TenantPolicy (seeded from `packages/policy` roles, versioned with history). MCP can never reach these routes. Refusals are `{error, reason}` and the console shows `reason`. Every mutation writes a content-free receipt (`gov.<kind>.<propose|approve|reject|withdraw|apply>`, `gov.elev.*`, `gov.access.*`, `gov.audit.read`); free text stays in the Durable Object.

- Roles: `GET /roles`, `GET /roles/:id/history`, `POST /roles`, `PUT /roles/:id` (configure holders only). An edit to a role that grants account or restricted scopes, or `configure`, is a pending change that a different configure holder approves. Others apply at once. A change that would leave nobody able to configure the tenant is refused.
- Changes: `GET /changes`, `POST /changes/:id/approve|reject|withdraw`. The proposer can never decide. Pending changes lapse after 72 h.
- Memberships: `GET /scopes`, `GET /principals`, `GET /memberships`, `POST /memberships {op, principalId, scope_type, scope_id, subspace?}`. A steward manages only scopes where a role of theirs holds `manage_members` (Head of Bid: the Bid circle). Restricted circles, accounts and Contacts need a second approver.
- NDA: `GET /nda`, `POST /nda {principalId, accountId, reason, expiresAt}` (always two-person, at most one year), `POST /nda/revoke` (one person).
- Elevation: `GET /elevation`, `GET /elevations`, `POST /elevations {hours, reason}`, `POST /elevations/:id/approve|deny|end`. Hours are capped by the role (`elevation.hours`); `elevation.approval` requires a different configure holder. Expiry is automatic.
- Access requests: `POST /access-requests {nodeId, reason}`, `GET /access-requests?view=mine|queue`, `POST /access-requests/:id/approve|deny`. Approval adds the membership, through the two-person path for restricted scopes.
- Inbox: `GET /notifications`, `POST /notifications/read`. Audit viewer: `GET /audit?principal&action&from&to&limit` (auditor or configure holder).
- `GET /v1/admin/audit` rows gain `reason` and `revision`.
## Connector (B2 CONN)

- `workers/connector` syncs SharePoint/OneDrive into Workspaces and confirms read access. Runbook: `docs/runbooks/GRAPH-SITES-SELECTED.md`.
- `POST /internal/connector/{upsert,delete,purge}` on the api: signed with `CONNECTOR_HMAC_KEY`, principal `secondary-connector` only. Not under `/v1`.
- The api calls `POST /internal/acl/check` on the connector (signed with the user's id and email). Only an explicit `allowed: true` shows an item.
- `GET /v1/search` may return `kind: "source"` results. `GET /v1/sources/:id` returns the file record, or 403 `source permission could not be confirmed`. A caller without content access to the item's gate node gets 404. The web app does not render `source` results yet.

