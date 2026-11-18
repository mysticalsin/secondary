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
| `GET /v1/health` | 200 | `{"ok":true,"env":"dev","version":"0.1.0"}` |
| `GET /v1/ready` | 500 | `{"error":"internal_error","requestId":"<uuid>"}` |
| `GET /v1/me` | 401 | `{"error":"unauthorized"}` |
| `GET /auth/providers` | 200 | `{"entra":false,"access":true,"loginUrl":"/auth/login"}` |
| `GET /auth/login` | 404 | `{"error":"entra_disabled"}` |
| `GET /scim/v2/Users` | 401 | SCIM error, detail `Unauthorized` |
| `POST /internal/connector/upsert` | 401 | `{"error":"unauthorized"}` |
| `GET /v1/internal/ops/targets` | 401 | `{"error":"unauthorized"}` |
| `GET /` | 200 | HTML containing `Synthetic` |
| `GET /synthetic-shell.css` | 200 | `text/css` |

`/v1/ready` is 500 because this boot has no Durable Object namespace and no R2 binding. The client body is `internal_error` plus a request id. The server log names `TypeError` and does not name a secret. A boot that attaches those two bindings should return 200 `{"ready":true,"checks":{"do":"ok","r2":"ok"}}` or 503 with `ready:false` when either check fails. This recipe does not attach them.

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
| Access JWT | bad signature, expiry, audience, or issuer | null email, then 401 if nothing else identifies the caller | `recovered-source/worker/src/auth.ts` `verifyAccessJwt`. Needs a live team JWKS to exercise the success path. Blocked without that. Do not call a real team. |
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
| `GET /v1/health` | 200 `{ok:true,env,version}` | `local-boot.test.ts` |
| `GET /v1/ready` | 500 `internal_error` on this boot; 200 or 503 when DO and R2 exist | `local-boot.test.ts` |
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
| No Durable Object and no R2 | `GET /v1/ready` is 500 `internal_error` on this boot |
| No session | `/v1/*` except health and ready is 401 |
| Entra values absent | `GET /auth/login` is 404 `entra_disabled` |
| SCIM token unset | every `/scim/v2` route is 401 |
| Connector HMAC absent | `/internal/connector/*` is 401 |
| Ops HMAC absent | `/v1/internal/ops/*` is 401 |
| Pseudonym key unusable | erase is `erase_disabled` and deletes nothing |
| AI key or contract absent | `GET /v1/ai/status` is not `ready` |
| `RESTORE_ENABLED` not `yes` | restore is 403 `restore_disabled` once the HMAC is valid |

## Writer gates

Measured on the tree that contains this plan, before the verifier's pass. These are the writer's numbers, not a grade of the independent pass.

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

## What this plan cannot execute here

- A real Cloudflare Access login. The success path needs the team's JWKS. Do not call it.
- The static Home and graph UI. They are not in this tree. PR #1 is closed and was not merged. PR #3's SPA bytes are `deploy/assets/UNREPRODUCED` on another branch.
- A signed-in click-through of every `/v1` route in a browser. The harness is the local stack for those cases. The boot proves the HTTP shell, the refusals, and the degraded ready check.
