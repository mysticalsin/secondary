# Full QA plan

Independent verifier. The writer does not grade this pass. Synthetic data only. No private notes, no vault export, no live Cloudflare account, no tunnel, no deploy.

Parent of the fix batch: `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. Branch: `cursor/sb-full-fix-b165`.

This repository is the recovered Secondary API Worker plus policy and contracts. It is not the static UI. PR #1 (closed, not merged) held a Home screen. PR #3 (`cursor/recover-v24-deploy-1c66`, open) holds `deploy/assets/UNREPRODUCED`. Do not check out that branch and do not edit `deploy/assets`.

## Do not

- `wrangler deploy`, `versions upload`, or `publish`
- push or merge to `main`, force-push, or bypass hooks
- put a secret value in a file, a log, or a screenshot
- use a person's real mailbox, notes, or vault

## Local boot

Node 22.18 or newer. From the repo root, after `npm install --ignore-scripts --no-audit --no-fund`:

```bash
node --experimental-strip-types qa/boot-local.mjs
```

Listens on `127.0.0.1:8787` only. `PORT` may override the port. The process sets `ENVIRONMENT=dev`, `DEFAULT_TENANT_ID=synthetic`, `AUTH_MODE=access`. It sets no token, no HMAC key, and no bypass email. `GET /` and `GET /synthetic-shell.css` are served from `qa/synthetic-shell.html` and `qa/synthetic-shell.css`. The page is labeled Synthetic.

Stop the process with Ctrl-C when finished. Nothing in this recipe needs a public URL.

### Measured on the writer boot, 2026-11-18

| Request | Status | Body |
|---|---|---|
| `GET /v1/health` | 200 | `{"ok":true}` |
| `GET /v1/ready` | 503 | `{"ready":false,"checks":{"do":"fail","r2":"fail"}}` |
| `GET /v1/me` | 401 | `{"error":"unauthorized"}` |
| `GET /auth/providers` | 200 | `{"entra":false,"access":true,"loginUrl":"/auth/login"}` |
| `GET /auth/login` | 404 | `{"error":"entra_disabled"}` |
| `GET /scim/v2/Users` | 401 | SCIM error, detail `Unauthorized` |
| `POST /internal/connector/upsert` | 401 | `{"error":"unauthorized"}` |
| `GET /v1/internal/ops/targets` | 401 | `{"error":"unauthorized"}` |
| `GET /` | 200 | HTML containing `Synthetic` |
| `GET /synthetic-shell.css` | 200 | `text/css` |

`/v1/ready` is 503 because this boot has no Durable Object namespace and no R2 binding. The body is `{ ready: false, checks: { do: "fail", r2: "fail" } }`. A boot that attaches those two bindings should return 200 `{"ready":true,"checks":{"do":"ok","r2":"ok"}}` when both checks pass. This recipe does not attach them.

Health response headers include `cache-control: no-store`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, and a content-security-policy that allows style from `'self'` and `https://fonts.googleapis.com`. The shell stylesheet is same-origin so the policy allows it. An inline `<style>` is refused by that policy. That is why the shell CSS is a separate file.

The same responses are locked by `harness/tests/local-boot.test.ts` for health, providers, `/v1/me`, the shell, and ready.

### Viewports

Screenshots taken from this boot, synthetic page only:

| File | Viewport |
|---|---|
| `qa/screenshots/desktop-shell.png` | 1280×800 |
| `qa/screenshots/desktop-health.png` | 1280×800 |
| `qa/screenshots/desktop-me-unauthorized.png` | 1280×800 |
| `qa/screenshots/desktop-providers.png` | 1280×800 |
| `qa/screenshots/desktop-ready-degraded.png` | 1280×800 |
| `qa/screenshots/mobile-shell.png` | 390×844 |
| `qa/screenshots/mobile-me-unauthorized.png` | 390×844 |

Repeat: resize the browser to 1280×800 and to 390×844, open `/`, `/v1/health`, and `/v1/me`. At 390px the shell text stays inside the column. The JSON pages are the browser's view of the Worker response.

## How a signed-in use case runs

`/v1/health` and `/v1/ready` do not require a session. Every other `/v1` route sits behind `authenticate`. With no cookie and no Access JWT the expected result is 401 `{"error":"unauthorized"}`. Confirm three of them on the boot (`/v1/me`, `/v1/map`, `/v1/brains`) and treat that as the shared unsigned result for the catalog below.

A signed-in call needs a loopback dev bypass (`ENVIRONMENT=dev`, `DEV_AUTH_BYPASS_EMAIL` on a localhost host) or an Entra session, plus `TENANT_POLICY` and `WORKSPACE` Durable Objects. This boot does not start those objects, and this plan does not tell you to point them at a live account. The harness tests open real `node:sqlite` files and call the recovered modules. That is the faithful local stack for signed-in behavior. Run one file with:

```bash
node --experimental-strip-types --test harness/tests/<file>.test.ts
```

`npm test` runs every file under `harness/tests` and `harness/runtime`.

Addresses in those tests are synthetic (`example` names, fictional org `tenant_mantu_synthetic` in the seed). Do not replace them with a real mailbox.

## Auth and Access

| Case | Steps | Expected | Where |
|---|---|---|---|
| Providers | `GET /auth/providers` on the boot | 200, Entra false, Access true, `loginUrl` `/auth/login` | boot, `local-boot.test.ts` |
| Login while Entra is off | `GET /auth/login` | 404 `entra_disabled` | boot |
| Callback, mismatch | two login rows, cookie state ≠ query state | 400, cookie row gone, query row nonce unchanged, no session cookie | `oidc-login.test.ts` |
| Callback, IdP error with a foreign query state | cookie row and a different query row, `error=access_denied` | 400, query row unchanged | `oidc-login.test.ts` |
| Callback, no cookie | query state only | 400, that row unchanged | `oidc-login.test.ts` |
| Callback, matching state, code exchange succeeds | synthetic RS256 token, `ada@example.invalid` | 303, session cookie, replay of that state is 400 | `oidc-login.test.ts` |
| Callback, IdP disabled | `AUTH_MODE=access` | 404, cookie row consumed, query row kept | `oidc-login.test.ts` |
| Access JWT | bad signature, expiry, audience, or issuer | null email, then 401 if nothing else identifies the caller | `src/worker/auth.ts` `verifyAccessJwt`. Needs a live team JWKS to exercise the success path. Blocked without that. Do not call a real team. |
| Dev bypass | loopback, `ENVIRONMENT=dev`, bypass email set | email is accepted only for localhost / 127.0.0.1 / `[::1]` | `devBypassEmail` in `auth.ts`. Not enabled on this boot. |
| Logout | `POST /auth/logout` with a session cookie | ends that session. Unsigned boot: the route still runs its cookie clear. Confirm status on a harness session, not against production. | `auth/routes.ts` |
| SCIM without a token | `GET /scim/v2/Users` | 401 SCIM error | boot |
| SCIM with a short token | token shorter than 32 characters | same 401 | `scim/routes.ts` |
| Connector without HMAC | `POST /internal/connector/upsert` | 401 | boot |
| Ops without HMAC | `GET /v1/internal/ops/targets` | 401 | boot |
| MCP switches without HMAC | `GET /v1/internal/mcp/switches` | 401 | `ops-internal.ts` |

## Route catalog

Unsigned expected result is 401 unless the row says otherwise. Signed-in behavior is the harness file when one is named.

### Public and machine routes

| Method and path | Expected unsigned or unauthenticated | Harness |
|---|---|---|
| `GET /v1/health` | 200 `{ok:true}` | `local-boot.test.ts` |
| `GET /v1/ready` | 503 `{ready:false,checks:{do:"fail",r2:"fail"}}` on this boot; 200 when both checks pass | `local-boot.test.ts` on the fix branch |
| `GET /auth/providers` | 200 provider flags | `local-boot.test.ts` |
| `GET /auth/login` | 404 `entra_disabled` on this boot | `oidc-login.test.ts` for the callback |
| `GET /auth/callback` | see Auth table | `oidc-login.test.ts` |
| `POST /auth/logout` | clears a login cookie when present | `auth/routes.ts` |
| `GET/POST/PATCH/DELETE /scim/v2/ServiceProviderConfig` | 401 without a bearer of at least 32 characters | `email-identity.test.ts`, `identity-lookup.test.ts` for the store |
| `GET /scim/v2/ResourceTypes` | 401 | same |
| `GET/POST /scim/v2/Users` | 401 | same |
| `GET/PATCH/DELETE /scim/v2/Users/:id` | 401 | same |
| `GET/POST /scim/v2/Groups` | 401 | `scim/routes.ts` |
| `GET/PATCH/DELETE /scim/v2/Groups/:id` | 401 | `scim/routes.ts` |
| `POST /internal/connector/upsert` | 401 | `connector.ts` |
| `POST /internal/connector/delete` | 401 | `source-forget.test.ts` for the derived forget |
| `POST /internal/connector/purge` | 401 | `purge-cutoff.test.ts`, `purge-tags.test.ts` |
| `GET /v1/internal/ops/targets` | 401 | `ops-internal.ts` |
| `GET /v1/internal/ops/export` | 401 | `ops-snapshot.ts` readers are covered by snapshot tests |
| `POST /v1/internal/ops/restore` | 401; with a signature, `restore_disabled` unless `RESTORE_ENABLED=yes` | `brain-member-snapshot.test.ts`, `erasure-request.test.ts` for re-apply |
| `POST /v1/internal/ops/retention` | 401 | `purge-cutoff.test.ts` |
| `GET /v1/internal/mcp/switches` | 401 | `kill-switch.test.ts` |
| `GET /` and `HEAD /` | 200 synthetic HTML | `local-boot.test.ts` |
| other methods on `/` | 405 `method_not_allowed` | `index.ts` |

### Profile, map, search, accounts

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/me` | profile for the session principal | `local-boot.test.ts` covers the 401 |
| `GET /v1/map` | admitted org map | policy tests under `harness/tests/policy-admission.test.ts` |
| `GET /v1/nodes/:id` | one node the caller may read, else not found | `policy-admission.test.ts` |
| `GET /v1/search` | hits inside the admitted view | `routes.ts` |
| `GET /v1/sources/:id` | one source row the caller may read | `source-forget.test.ts` |
| `GET /v1/accounts` | account cards in the admitted view | `routes.ts` |
| `GET /v1/accounts/:id` | one account | `routes.ts` |
| `GET /v1/governances` | stage counts | `governance.test.ts` |
| `GET /v1/governances/:id` | one governance | `governance.test.ts` |
| `GET /v1/review` | queue the caller may decide | `proposal-review.test.ts` |
| `GET /v1/activity` | recent events in view | `routes.ts` |
| `GET /v1/admin/roles` | role catalog | `governance.test.ts` |
| `GET /v1/admin/audit` | audit page the caller may read | `contracts-security.test.ts` |
| `POST /v1/actions` | one admitted action | `routes.ts` |
| `POST /v1/genui/plan` | a view plan, or the AI gate's refusal | `genui-plan.test.ts` |
| `GET /v1/audit/receipts` | receipt page for the caller. This is the receipts inbox. There is no `inbox/agent-receipts/` directory in this repo. | `contracts-security.test.ts` |

### Personal brain and UX

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/personal/items` | caller's items | `ux/personal.ts` |
| `GET /v1/personal/targets` | scopes the caller may contribute to | `routes.ts` |
| `POST /v1/personal/items` | create a draft | `import-outcome.test.ts` for publish mode |
| `POST /v1/personal/items/:id/contribute` | propose into a company scope | `proposal-review.test.ts` |
| `PUT /v1/personal/items/:id` | edit | `ux/personal.ts` |
| `DELETE /v1/personal/items/:id` | delete | `item-remove.test.ts` |
| `GET /v1/personal/items/:id/history` | revisions | `page-visibility.test.ts` is the wiki analogue |
| `POST /v1/personal/items/:id/restore` | restore a revision | `ux/personal.ts` |
| `GET /v1/personal/items/:id/contributions` | contribution list | `ux/personal.ts` |
| `GET /v1/ux/drafts` | drafts | `ux/personal.ts` |
| `PUT /v1/ux/drafts/:key` | save a draft | `ux/personal.ts` |
| `DELETE /v1/ux/drafts/:key` | delete a draft | `ux/personal.ts` |
| `GET /v1/ux/prefs` | UI prefs | `ux/personal.ts` |
| `PUT /v1/ux/prefs` | save prefs | `ux/personal.ts` |
| `GET /v1/ux/accounts/:id/records` | records | `ux/records.ts` |
| `POST /v1/ux/accounts/:id/records` | create a record | `ux/records.ts` |
| `PUT /v1/ux/accounts/:id/records/:rid` | update | `ux/records.ts` |
| `POST /v1/ux/accounts/:id/records/:rid/permission` | permission change | `ux/records.ts` |
| `GET /v1/ux/accounts/:id/records/:rid/history` | history | `ux/records.ts` |
| `GET /v1/ux/attention` | attention list | `ux/records.ts` |
| `GET /v1/ux/review/:id` | one review | `proposal-review.test.ts` |
| `POST /v1/ux/review/:id/comments` | comment | `ux/review.ts` |
| `POST /v1/ux/review/:id/decision` | approve or reject | `proposal-decide.test.ts` |

### Ask, tree, questions, routines, usage

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `POST /v1/ask` | one question, budget gated | `usage-body.test.ts`, `budget-spend.test.ts` |
| `GET /v1/ask/suggestions` | suggestions from what the caller may read | `uxv2/ask.ts` |
| `GET /v1/brain/tree` | tree of readable pages | `uxv2/tree.ts` |
| `GET /v1/brain/export` | export the caller may take | `uxv2/export.ts` |
| `GET /v1/questions` | open questions | `uxv2/questions.ts` |
| `POST /v1/questions/batch` | answer a batch | `uxv2/questions.ts` |
| `POST /v1/questions/:id` | answer one | `uxv2/questions.ts` |
| `GET /v1/routines` | list | `uxv2/routines.ts` |
| `POST /v1/routines` | create | `uxv2/routines.ts` |
| `GET /v1/routines/:id` | one | `uxv2/routines.ts` |
| `PUT /v1/routines/:id` | update | `uxv2/routines.ts` |
| `DELETE /v1/routines/:id` | delete | `uxv2/routines.ts` |
| `GET /v1/routines/:id/runs` | runs | `uxv2/routines.ts` |
| `POST /v1/routines/:id/run` | run once, budget gated | `budget-hold-machine.test.ts` |
| `GET /v1/usage` | token usage the caller may see | `usage-body.test.ts` |

### Wiki

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/wiki/health` | wiki process health | `wiki-seed-machine.test.ts` |
| `GET /v1/wiki/:ws/index` | page index | `page-visibility.test.ts` |
| `GET /v1/wiki/:ws/pages/:pid` | one page | `page-visibility-save.test.ts` |
| `GET /v1/wiki/:ws/pages/:pid/history` | revisions | `page-revision-scrub.test.ts` |
| `GET /v1/wiki/:ws/facts` | facts | `wiki/routes.ts` |
| `GET /v1/wiki/:ws/log` | log | `wiki/routes.ts` |
| `GET /v1/wiki/:ws/search` | search | `wiki/routes.ts` |
| `GET /v1/wiki/:ws/ask` | ask over the wiki | `wiki/routes.ts` |
| `GET /v1/wiki/:ws/proposals` | proposals | `proposal-review.test.ts` |
| `GET /v1/wiki/:ws/proposals/:id` | one proposal | `proposal-review.test.ts` |
| `POST /v1/wiki/:ws/proposals/:id/decide` | decide | `proposal-decide.test.ts` |
| `POST /v1/wiki/:ws/proposals/:id/edit` | edit a candidate | `proposal-review.test.ts` |
| `POST /v1/wiki/:ws/propose` | propose | `proposal-count.test.ts` |
| `POST /v1/wiki/:ws/meetings` | meeting ingest | `wiki/routes.ts` |
| `POST /v1/wiki/:ws/run` | run due jobs | `wiki/store.ts` `wikiJobsDue` |
| `POST /v1/wiki/:ws/facts/:fid/verify` | verify a fact | `wiki/routes.ts` |
| `PUT /v1/wiki/:ws/settings` | settings | `wiki/routes.ts` |
| `POST /v1/wiki/:ws/pages/:pid/promote` | promote | `page-visibility.test.ts` |

### Brains, import, agents, pilot

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/brains` | brains the caller may read | `brain-member.test.ts` |
| `GET /v1/brains/overview` | overview tiles | `brains/insights-routes.ts` |
| `GET /v1/brains/nav` | nav | `brains/nav.ts` |
| `GET /v1/brains/:id` | one brain | `brain-member.test.ts` |
| `GET /v1/brains/:id/insights` | insights | `brains/insights.ts` |
| `POST /v1/brains/:id/template` | apply a template | `brains/routes.ts` |
| `GET /v1/brains/:id/access` | members | `brain-member-grant.test.ts` |
| `PUT /v1/brains/:id/access` | access change | `brain-member.test.ts` |
| `PUT /v1/brains/:id/access/members/:pid` | set a member | `brain-member-machine.test.ts` |
| `DELETE /v1/brains/:id/access/members/:pid` | remove a member | `brain-member-drop.test.ts` |
| `GET /v1/brains/:id/guide` | guide, structure only | `brains/routes.ts` |
| `GET /v1/brains/:id/coach` | coach | `brains/routes.ts` |
| `POST /v1/brains/:id/coach/propose` | proposal, nothing applied | `brains/routes.ts` |
| `POST /v1/brains/:id/coach/apply` | apply | `brains/routes.ts` |
| `GET/PUT /v1/brains/:id/fields` | field config | `field-sweep.test.ts` |
| `GET/PUT /v1/brains/:id/pages/:pid/fields` | page fields | `brains/data.ts` |
| `GET /v1/brains/:id/pages/:pid/versions` | versions | `brains/data.ts` |
| `POST /v1/brains/:id/import` | import. Dry run and real import stay draft unless publish is explicit. Personal auto-accept stays draft. | `import-publish.test.ts`, `import-outcome.test.ts` |
| `GET /v1/brains/:id/journal` | journal | `brain-journal-run.test.ts` |
| `POST /v1/brains/:id/journal/run` | run the journal | `brain-daily.test.ts` |
| `POST /v1/brains/:id/push/page` | push a page | `brains/push.ts` |
| `POST /v1/brains/:id/push/change` | push a change | `brains/push.ts` |
| `POST /v1/brains/:id/push/session-report` | push a report | `brains/push.ts` |
| `GET /v1/agents` | grants | `brains/agents.ts` |
| `GET /v1/agents/config` | config | `brains/agents.ts` |
| `POST /v1/agents/connections/:id/revoke` | revoke one | `brains/agents.ts` |
| `POST /v1/agents/revoke-all` | revoke all | `brains/agents.ts` |
| `POST /v1/agents/hosts/:host/revoke` | revoke a host | `brains/agents.ts` |
| `GET /v1/me/flags` | flags | `brains/agents.ts` |
| `GET/POST /v1/admin/pilot` | pilot cohorts | `brains/agents.ts` |
| `PUT/DELETE /v1/admin/pilot/:id` | edit or delete a cohort | `brains/agents.ts` |

### Agent turns and saved views

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `POST /v1/agent/turn` | one turn. Unknown tool names are refused before the tool runs (`loop.ts`, `isToolName`). | `agent-turn-machine.test.ts`, `agent-plan.test.ts` |
| `GET/POST /v1/views` | list and create | `agent/index.ts` |
| `GET /v1/views/shared/:shareId` | open a share | `agent/index.ts` |
| `GET/PUT/DELETE /v1/views/:id` | one view | `agent/index.ts` |
| `POST /v1/views/:id/share` | share | `agent/index.ts` |
| `DELETE /v1/views/:id/share` | unshare | `agent/index.ts` |

### AI

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/ai/status` | `disabled`, `contract_missing`, `not_configured`, or `ready` | `ai/config.ts` `aiState` |
| `POST /v1/briefs` | draft a brief, budget gated | `budget-spend.test.ts` |
| `POST /v1/briefs/save` | save a brief | `ai/routes.ts` |

### Governance console (`/v1/admin`, behind the session)

| Method and path | Signed-in behavior | Harness |
|---|---|---|
| `GET /v1/admin/caps` | capabilities | `admin/routes.ts` |
| `GET /v1/admin/roles` | roles | `governance.test.ts` |
| `POST /v1/admin/roles` | propose a role | `governance.test.ts` |
| `PUT /v1/admin/roles/:id` | propose an edit | `governance.test.ts` |
| `GET /v1/admin/roles/:id/history` | history | `admin/routes.ts` |
| `GET /v1/admin/changes` | pending changes | `governance.test.ts` |
| `POST /v1/admin/changes/:id/approve` | approve. A lost race is 409. The proposer cannot self-approve when a second person is required. | `governance-machine.test.ts` |
| `POST /v1/admin/changes/:id/reject` | reject | `governance.test.ts` |
| `POST /v1/admin/changes/:id/withdraw` | withdraw | `governance.test.ts` |
| `GET /v1/admin/principals` | people | `actor-identity.test.ts` |
| `GET /v1/admin/scopes` | scopes | `admin/routes.ts` |
| `GET/POST /v1/admin/memberships` | list and propose | `admin/routes.ts` |
| `GET/POST /v1/admin/nda` | grants | `admin/routes.ts` |
| `POST /v1/admin/nda/revoke` | revoke | `admin/routes.ts` |
| `GET /v1/admin/elevation` | caller's window | `elevation.test.ts` |
| `GET/POST /v1/admin/elevations` | list and start. A start is legal only from pending. | `elevation-machine.test.ts` |
| `POST /v1/admin/elevations/:id/approve` | approve. Loser is 409. | `elevation.test.ts` |
| `POST /v1/admin/elevations/:id/deny` | deny | `elevation.test.ts` |
| `POST /v1/admin/elevations/:id/end` | end early | `elevation.test.ts` |
| `GET/POST /v1/admin/access-requests` | list and open | `access-request.test.ts` |
| `POST /v1/admin/access-requests/:id/approve` | approve. Reopen is only from approved. | `access-request-machine.test.ts` |
| `POST /v1/admin/access-requests/:id/deny` | deny | `access-request.test.ts` |
| `GET /v1/admin/notifications` | inbox for this principal. Not a filesystem inbox. | `admin/routes.ts` |
| `POST /v1/admin/notifications/read` | mark read | `admin/routes.ts` |
| `GET /v1/admin/audit` | audit rows | `contracts-security.test.ts` |
| `GET /v1/admin/switches` | four switches | `kill-switch.test.ts` |
| `POST /v1/admin/switches` | off is immediate. On in prod waits for a second person. Unknown name is refused and not logged with the name. | `kill-switch.test.ts`, `quorum.test.ts` |
| `GET /v1/admin/rights/export` | 405, `Allow: POST` | `ops-admin.ts` |
| `POST /v1/admin/rights/export` | export for a subject the caller may erase | `ops-admin.ts` |
| `POST /v1/admin/rights/erase` | erasure. See the next section. | `erasure-request.test.ts` |
| `POST /v1/admin/seed` | dev only, needs `SEED_TOKEN` and a session. Wrong token is refused. Production environment is 404. | `seed.ts` |

## Erasure and state

`POST /v1/admin/rights/erase` with no usable pseudonym key (missing, empty, or shorter than 32 characters) returns `erase_disabled` and writes nothing. A keyed erase stores the canonical plan: receipts, tombstone, company scopes, personal, connector, directory. A step that returns false ends `partial_failed`. Done steps stay done and are not run. A not-done step the new plan omits stays and is retried. An erase of tenant A does not change tenant B's store.

Run `harness/tests/erasure-request.test.ts`, `erasure-save.test.ts`, `workspace-erasure.test.ts`, `directory-forget.test.ts`, `derived-erasure.test.ts`, `journal-forget.test.ts`, and `source-forget.test.ts`.

The four machine-12 residuals in `docs/state-machines.md` (stale-at finish, null claim lease, zero-row release, different-role null-key retry) are accepted behavior. Do not treat them as failures.

## Imports

`POST /v1/brains/:id/import` with a dry run reports draft. A personal auto-accept stays draft. Publishing compares the previous status and updates only a candidate. Bad journal dates are rejected (`isCalendarDay`). Run `import-publish.test.ts` and `import-outcome.test.ts`.

## Offline and portable

After `npm install`, `npm test` and both typechecks use no network. The boot binds loopback and loads no remote script. The shell does not call a third party. `npm run verify:provenance` needs the git objects named in `reconstructed-manifest.json`. A shallow or single-branch clone that lacks those commits exits 1. That is the recorded closeout result, not a new failure, when the objects are absent.

## Degraded dependencies

| Missing piece | What the caller sees |
|---|---|
| No Durable Object and no R2 | `GET /v1/ready` is 503 `{ready:false,checks:{do:"fail",r2:"fail"}}` on this boot |
| No session | `/v1/*` except health and ready is 401 |
| Entra values absent | `GET /auth/login` is 404 `entra_disabled` |
| SCIM token unset | every `/scim/v2` route is 401 |
| Connector HMAC absent | `/internal/connector/*` is 401 |
| Ops HMAC absent | `/v1/internal/ops/*` is 401 |
| Pseudonym key unusable | erase is `erase_disabled` and deletes nothing |
| AI key or contract absent | `GET /v1/ai/status` is not `ready` |
| `RESTORE_ENABLED` not `yes` | restore is 403 `restore_disabled` once the HMAC is valid |

## Writer gates

The table below is the run on `6f7aaeae`, before the residual fixes. The fix head after those fixes passed 427 and failed 0. These are the writer's numbers, not a grade of the independent pass.

| Command | Exit | Result |
|---|---|---|
| `npm test` | 0 | 421 passed, 0 failed, 0 skipped, 0 todo. Runner `duration_ms` 4782.987446. Wall clock 4896 ms. |
| `npm run typecheck` | 0 | 0 `error TS` lines. Wall clock 2485 ms. |
| `npm run typecheck:worker` | 0 | 0 `error TS` lines. Wall clock 3866 ms. |
| `npm run verify:provenance` | 0 | five `ok` lines. Wall clock 161 ms. |
| `npm run lint` | 1 | missing script. No eslint config is in the repo. |
| `npm run format` | 1 | missing script. No prettier config is in the repo. |
| `npm run build` | 1 | missing script. The compile gate is the two typechecks. There is no bundle step. |

Parent `c9417c8` was 416 passed, 0 failed, both typechecks exit 0. This branch adds 5 tests.

Node prints `ExperimentalWarning: SQLite is an experimental feature` from `node:sqlite`. That warning is not a test failure.

## Acceptance criteria

Ids in this section are the checks for governance, brains, and import. Status codes and state changes are the ones in the recovered handlers. A row that the code does not decide is not given a code here.

Unsigned calls to `/v1/*` other than `/v1/health` and `/v1/ready` are 401 `{ error: "unauthorized" }` (`authenticate` in `auth.ts`). That applies to every id below before the role is considered.

The policy roles are `ceo`, `head_bid`, `acme_lead`, `consultant`, `reviewer`, `platform_admin`, and `auditor` (`packages/policy/src/roles.ts`). Brain membership roles are `reader`, `contributor`, `editor`, `steward`, and `owner` (`packages/policy/src/brains.ts`). A stored brain role only narrows. No stored role means the policy alone decides (`roleAllows`).

`platform_admin` is the only role whose grants include `configure`. `requireConfigure` is that check. Anyone else gets 403 `{ error: "forbidden" }` on the switch and rights routes.

### What each brain role may do

From `ACTIONS_OF` in `packages/policy/src/brains.ts`. `needBrain` returns 403 `{ error: "forbidden" }` when `can[need]` is false, and 404 `not_found` when the brain is not in the view.

| Id | Role | May | May not | Status when refused |
|---|---|---|---|---|
| QA-BR-01 | reader | `view_structure`, `view_content` | comment, contribute, edit, review, approve_release, manage_members | 403 on contribute, edit, or manage |
| QA-BR-02 | contributor | reader's actions, plus comment and contribute | edit, review, approve_release, manage_members | 403 on edit or manage |
| QA-BR-03 | editor | contributor's actions, plus edit | review, approve_release, manage_members | 403 on manage |
| QA-BR-04 | steward | editor's actions, plus review and approve_release | manage_members | 403 on manage |
| QA-BR-05 | owner | steward's actions, plus manage_members | change their own role | 422 `{ error: "own_role" }` on `PUT` or `DELETE` of their own member row |
| QA-BR-06 | no stored role | whatever the policy role already allows | a stored role cannot add an action the policy refused | the policy refusal stands |

Personal brain `me`: the owner of that brain gets contribute, edit, decide, and manage without a stored role (`brainOf` when `param` is `me`). No policy role grants a personal scope (`roles.ts`).

### Policy role limits that are not a brain role

| Id | Principal | May | May not |
|---|---|---|---|
| QA-PR-01 | `u_platform_admin` | `configure` on structure. Kill switches, role edits, rights export and erase | content, unless a break-glass grant exists. The role's `never` list says any content |
| QA-PR-02 | `u_ceo` | view, comment, contribute on company and department scopes. Elevation can add edit and review for 4 hours | approve_release and manage_members, including while elevated (`never`) |
| QA-PR-03 | `u_head_bid` | steward actions on circle `c_bid`, with `self_approval: false` | approve their own contribution |
| QA-PR-04 | `u_acme_lead` | edit, review, and manage_members on account `a_acme` | a global release with no distinct reviewer |
| QA-PR-05 | `u_consultant` | contribute and edit own drafts on `c_delivery` and `c_eng` | review their own work |
| QA-PR-06 | `u_reviewer` | review and approve_release on the assigned queues, not as the contributor | approve an item they contributed |
| QA-PR-07 | `u_auditor` | view and comment where `metadata_only` is set | item content, and any content change |

### Governance actions and audit

`mutate` writes an allow receipt before the store call. If `appendReceipt` returns false the status is 503 `audit_unavailable` and the store call does not run. A store failure then writes a `rejected` receipt. `deny` writes a deny receipt and returns 403. It does not read the boolean from that receipt.

| Id | Call | Who | Success | State change | Audit action |
|---|---|---|---|---|---|
| QA-GOV-01 | `POST /v1/admin/roles` and `PUT /v1/admin/roles/:id` | configure | 200 with the propose result | a `gov_changes` row, kind `role_upsert`, only when the receipt succeeded | `gov.role_upsert.propose` decision `allow` |
| QA-GOV-02 | same, caller is not configure | anyone else | 403 | no row | deny receipt `gov.role_upsert.propose` |
| QA-GOV-03 | `POST /v1/admin/changes/:id/approve` | a different person, row still pending | 200 | status becomes the value `decide` writes for approve | `gov.<kind>.approve` |
| QA-GOV-04 | `POST /v1/admin/changes/:id/reject` | a different person, row still pending | 200 | rejected | `gov.<kind>.reject` |
| QA-GOV-05 | `POST /v1/admin/changes/:id/withdraw` | the proposer, row still pending | 200 | withdrawn | `gov.<kind>.withdraw` |
| QA-GOV-06 | approve or reject by the proposer when a second person is required | proposer | the store refusal, not a second applied row | no second transition | `rejected` receipt after the allow receipt |
| QA-GOV-07 | `POST /v1/admin/memberships` | steward of that scope, or configure | 200 | `member_add` or `member_remove` proposal | `gov.member_add.propose` or `gov.member_remove.propose` |
| QA-GOV-08 | `POST /v1/admin/nda` | configure or steward as `manageAuthority` decides | 200 | `nda_grant` proposal | `gov.nda_grant.propose` |
| QA-GOV-09 | `POST /v1/admin/nda/revoke` | same | 200 | `nda_revoke` proposal | `gov.nda_revoke.apply` |
| QA-GOV-10 | `POST /v1/admin/elevations` | a role that has an elevation block | 200 | elevation row | `gov.elev.request` |
| QA-GOV-11 | `POST /v1/admin/elevations/:id/approve` and `.../deny` | a different configure holder while pending | 200 | approved or denied | `gov.elev.approve` or `gov.elev.deny` |
| QA-GOV-12 | `POST /v1/admin/elevations/:id/end` | the requester or a configure holder | 200 | ended | `gov.elev.end` |
| QA-GOV-13 | `POST /v1/admin/access-requests` | a principal the view allows to request | 200 | request row | `gov.access.request` |
| QA-GOV-14 | `POST /v1/admin/access-requests/:id/approve` | the decider | 200 | approved, and a membership proposal when the person is not already a member | `gov.access.approve` |
| QA-GOV-15 | `POST /v1/admin/access-requests/:id/deny` | the decider | 200 | denied | `gov.access.deny` |
| QA-GOV-16 | `GET /v1/admin/audit` | a caller who can open the viewer | 200 | no governance row | `gov.audit.read` decision `allow` |

Lost races on approve, reject, withdraw, and elevation decide stay a single transition. The second caller gets the store refusal and a `rejected` receipt. That is the predicate in `src/state/governance.ts` and `src/state/elevation.ts`, not a second applied row.

### Kill switches

Names are `mcp`, `connector`, `ai`, and `contribute`. No row means on. A stored value other than 0 or 1 reads as off. `POST /v1/admin/switches` is configure only.

| Id | Body | Environment | Status | State | Audit |
|---|---|---|---|---|---|
| QA-SW-01 | `{ "switch": "mcp", "enabled": false }` | dev or prod | 200 `{ ok: true, status: "applied", enabled: false }` | row `enabled` 0 | `switch_disable` after the write. A failed receipt does not undo the write |
| QA-SW-02 | `{ "switch": "mcp", "enabled": true }` from off | `ENVIRONMENT` other than prod | 200 `applied` | row `enabled` 1 | `switch_enable` before the write. False receipt is 503 and the switch is not turned on |
| QA-SW-03 | enable, first configure holder | prod | 202 `{ status: "pending", needs: "second_person" }` | still off, a pending ask | `switch_enable` |
| QA-SW-04 | enable, same person again | prod, ask still pending | 409 `switch_refused` | unchanged | the enable receipt was already required |
| QA-SW-05 | enable, a different configure holder | prod, ask still inside 24 hours | 200 `applied` | on | `switch_enable` |
| QA-SW-06 | `{ "switch": "not-a-switch", "enabled": false }` | any | 400 `invalid_switch` | no row | none |
| QA-SW-07 | `GET /v1/admin/switches` | configure | 200 with `switches`, `pending`, `twoPersonReenable`, `names` | no write | none |
| QA-SW-08 | `GET` or `POST` | not configure | 403 `forbidden` | no write | none |

`contribute` off makes the contribute gate return 503 for the paths in `GATES` (`ops-admin.ts` `switchGate`). Import uses `needBrain(..., "contribute")`, so a caller who fails that check is 403 before the body is read.

### Brains and import

Fixture: `qa/fixtures/tenant.json`. Samples and the four cases for each format: `qa/fixtures/imports.md`.

| Id | Call | Who | Status | State |
|---|---|---|---|---|
| QA-IMP-01 | `POST /v1/brains/a_acme/import?format=okf` with the valid sample | a principal who may contribute, imports flag on | 200 | one draft `wiki_ingest` proposal. No published page. Receipt `brain.import` before the proposals. False receipt is 503 and `runImport` is not called |
| QA-IMP-02 | same with `dryRun=1` | same | 200 `{ dryRun: true, pages, skipped, asked }` | no proposal and no `brain.import` receipt |
| QA-IMP-03 | valid obsidian sample | same | 200 `format: "obsidian"` | one draft proposal |
| QA-IMP-04 | valid outline JSON, `Content-Type: application/json` | same | 200 `format: "outline"` | one draft proposal |
| QA-IMP-05 | `format` not one of the three | same | 400 `invalid_format` | no write |
| QA-IMP-06 | empty body | same | 422 `invalid_archive` | no write |
| QA-IMP-07 | okf or obsidian bytes that are not a zip | same | 422 `invalid_archive` | no write |
| QA-IMP-08 | outline JSON `{` | same | 200 | `imported: []`, `skipped[0].reason` is `invalid_json`. No proposal |
| QA-IMP-09 | body longer than 5_242_880 bytes | same | 413 `too_large` | no write |
| QA-IMP-10 | a second file in the same archive whose title slugs to the same id | same | 200 | two proposals. The second `pageId` ends with `-2` |
| QA-IMP-11 | a page id that already exists | same | 200 | an edit proposal with `baseRevision`. The page body is not replaced. Dry run `replaces: true` and `state: "draft"` |
| QA-IMP-12 | reader, or any role `roleAllows` refuses for contribute | that role | 403 `forbidden` | no proposal and no import receipt |
| QA-IMP-13 | imports flag off for that email | a contributor | 403 `{ error: "not_in_pilot", flag: "imports" }` | no write. A flag key no cohort mentions stays on |
| QA-IMP-14 | brain id not in the view | any signed-in caller | 404 `not_found` | no write |
| QA-IMP-15 | `PUT /v1/brains/:id/access/members/:pid` with `role: "owner"` on restricted `a_acme`, caller is not that pid | owner or configure, and the target is already a member | 202 `pending` until a different person confirms, then the member row | `brain.role_request` while pending. The confirming call writes `brain.member_set` or returns 503 `audit_unavailable` and does not change the member |
| QA-IMP-16 | `DELETE /v1/brains/:id/access/members/:pid` | a caller who may manage, pid is someone else | 200 | member removed when the delete matches. Receipt `brain.member_remove` |
| QA-IMP-17 | member change of the caller's own id | any | 422 `own_role` | no write |

`GET /v1/brains` and `GET /v1/brains/:id` for a reader in the view are 200 and write nothing. A steward's `can.decide` follows `mayDecide` and `roleAllows(..., "review")`. An owner is the first role that includes `manage_members`.

### Local boot mocks

`qa/boot-local.mjs` sets `ENVIRONMENT=dev`, `DEFAULT_TENANT_ID=synthetic`, `AUTH_MODE=access`, and `ASSETS`. It sets no other binding. There is no query flag and no environment variable in that file that turns a mock on.

| Dependency | What the worker reads | Boot today | Effect when absent | How a later boot would turn it on |
|---|---|---|---|---|
| Durable Object | `env.TENANT_POLICY`, `env.WORKSPACE` (`stubs.ts`) | not set | `GET /v1/ready` is 503 `{ ready: false, checks: { do: "fail", r2 } }` because the throw is caught in `readiness` | assign a namespace whose `get().epoch()` resolves. This file does not do that |
| R2 | `env.BLOBS.head` (`observe.ts`) | not set | `checks.r2` is `fail` on that same 503 | assign an object whose `head("__ready__")` resolves |
| AI | `AI_ENABLED`, then `AI_PROCESSOR_CONTRACT`, then `ANTHROPIC_API_KEY` (`aiState` in `ai/config.ts`) | not set | `aiState` is `disabled`. A key alone does not leave `disabled` | `AI_ENABLED` one of `1`, `true`, `on`, `yes`; `AI_PROCESSOR_CONTRACT` exactly `approved` after trim and lowercase; `ANTHROPIC_API_KEY` a non-empty string. The kill switch `ai` is a separate gate and defaults on when no row exists |

Signed-in governance, brain, and import calls need the Durable Object. This boot cannot run QA-GOV, QA-BR, QA-SW, or QA-IMP past the 401. Those ids are for the harness, which opens `node:sqlite` and does not use this process.

### In-brain lead decisions

Head `41d72354f92787c876533272168a821c4fa493e7`. A standing `review`, `edit`, or `approve_release` grant on a node allows list, open, review, and approve for that node. An allow that exists only while elevated does not. The proposal author is denied.

| Id | Caller | Node | Result |
|---|---|---|---|
| QA-LEAD-01 | `acme_lead` | `a_acme` | allowed |
| QA-LEAD-02 | `acme_lead` | `c_sales` | allowed. That role holds the circle edit grant, so it is the c_sales lead |
| QA-LEAD-03 | `acme_lead` | `core` | denied. That is not a brain they lead |
| QA-LEAD-04 | the proposal author | the same node | denied, including a reviewer who holds `approve_release` |
| QA-LEAD-05 | elevated `ceo` | a department topic | denied. Elevation does not include `approve_release` |

### Findings

- The names owner, admin, member, and viewer are not a role set in this repo. Brain roles are reader, contributor, editor, steward, and owner. Policy roles are the seven ids in `ROLE_ORDER`. There is no role id `admin`, `member`, or `viewer`. `platform_admin` is the configure role. `reader` is the view-only brain role.
- A duplicate import is not an error status. One archive suffixes the page id. A page that already exists becomes an edit proposal. The page row stays.
- An outline collection that is not JSON is 200 with `skipped.reason` `invalid_json`. A zip that is not a zip is 422. The two malformed cases do not share a status.
- A page over 20_000 characters is 200 with `skipped.reason` `too_long`. Only the whole body over 5_242_880 bytes is 413.
- `deny` still returns 403 when the receipt fails. On product head `762f076` it also logs `{ at: "audit_unavailable", action, decision: "deny" }` with no address and no reason text.
- `switch_disable` is still written after the switch is already off. A failed receipt does not turn it back on. On product head `762f076` that audit call waits at most one second, and a refused or hung receipt logs `{ at: "audit_unavailable", action: "switch_disable", decision: "allow" }` with no address. Moving the receipt before the write would make an outage block the off, so that order was left as it is.
- `sessionCreate` on product head `762f076` no longer Unicode-lowercases the address. `normalEmail` owns the fold, so U+212A does not become `k` and U+0130 does not become `i`. This QA checkout is still based on `48e2d584` plus the QA commits. It was not rebased onto `762f076`, because rebasing the pushed QA branch would be a force push.
- The boot has no toggle. The three dependencies are off because the env object omits them, not because a flag is false.
- This file on `cursor/sb-followup-b165` also covers the residuals below. The N-A-only copy is `cursor/sb-full-fix-qa-r4-b165`.

### Follow-up residuals

| Id | Check | Expected |
|---|---|---|
| QA-R1 | A denied `POST /actions` whose audit returns 500 | 403, and a warning `{ at: "audit_unavailable", decision: "deny" }` with no address |
| QA-R2 | `personaId("consultant", "@bad.example")` | null, not a hash of an empty string |
| QA-R3 | Switch off when the switch call is refused and the receipt is 202 | warning `audit` `succeeded` and `switch` `refused`. A hung receipt is `timed_out` and the off still returns |
| QA-R4 | 257 unknown switch names | one `{ reason: "cap" }` warning. The set is not stored |
| QA-R5 | Seed email `@folded.example` | no principal row |
| QA-Q1 | Refund `add` returns null once, then succeeds | the delta is written twice in total, not three times |
| QA-KELVIN | `GET /me` for U+212A | `email` keeps the character and `emailLabel` contains `\u212a` |

Wiki job claim and a null brain role were reviewed and not changed. `contribute` still gates only the personal contribute route.

## What this plan cannot execute here

- A real Cloudflare Access login. The success path needs the team's JWKS. Do not call it.
- The static Home and graph UI. They are not in this tree. PR #1 is closed and was not merged. PR #3's SPA bytes are `deploy/assets/UNREPRODUCED` on another branch.
- A signed-in click-through of every `/v1` route in a browser. The harness is the local stack for those cases. The boot proves the HTTP shell, the refusals, and the degraded ready check.
