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
| POST | /v1/admin/seed | dev only, needs header `X-Seed-Token` = secret `SEED_TOKEN`. Loads fixtures into the DOs |

```ts
MapView = { lens, viewerScopeHash, core:{id,label,topicCount}, hubs: Hub[], links: Link[] }
Hub = { id, label, kind:'department'|'region'|'theme'|'governance', group?, access:'full'|'partial'|'locked', counts:{items,topics,open,gaps,stars}|null, children: MapNode[] }
MapNode = { id, label, kind, plane, access, counts|null, freshnessDays|null, signals:{open:boolean,star:boolean,gap:boolean}, children?: MapNode[] }
NodeDetail = { node: MapNode & {facts:Record<string,string>, badges:string[]}, items:[{title,source,ownerRole,revision,evidence,plane,reviewedBy2}], backlinks:[{id,label,type}], actions:[{action,label,group:'Collaborate'|'Govern'|'Admin',allowed,reason}] }
```

Locked nodes have `counts:null` and no children. Hidden nodes are absent.

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
