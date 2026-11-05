# HANDOFF

## v4 UI on `main` (2026-11-05, Claude Opus, nothing pushed, nothing deployed)

Design: `docs/DESIGN-V4-BRAINS-UI.md` (normative). Shapes: `docs/API-CONTRACT.md` "v4".

- Web (`apps/web`): new light-default shell (Mantu logo from `public/brand/`, search bar, sidebar with Home, Waiting for you badge, Private, governance brains with Accounts expanding to account brains, Company Global, All brains, user menu with Settings, language, dev persona). Dark mode in Settings > Appearance (`lib/theme.ts`, tokens in `styles/tokens.css`, shell in `styles/v4.css`). Views: Home, brain page (`lib/contents.ts` builds collections, Sources > Session reports > person folders and loose pages from the wiki index), page reading, Members and access (`views/brains/Access.tsx`, `Choice.tsx`), Waiting for you (`views/waiting/`), proposal view with inline diff and change markers, Settings (`views/settings/`: Profile, Your brains, Agents with tabs, Sign-in and security, Privacy, Appearance, Usage, Members and Pilot access for admins, Journal), search, All brains with request access. FR and EN in `i18n/v4.ts`.
- Removed: Map, Today, Accounts, Governances, Review, Routines, Usage as top-level, the node drawer, palette, tour, generated views (`genui`), brief views, `Personal.tsx`. Unused CSS pruned.
- Seen changes: Approve needs `seenChanges {revisionHash, indexes}` on every path (API 409 `changes_not_seen`). The proposal view marks a change seen after it has been on screen, or from its "Mark as seen" button (keyboard and screen readers). Approve stays disabled until all are seen.
- API (earlier commits): `GET /v1/brains/nav`, `GET /v1/brains?scope=all`, MCP `list_brains`, `propose_page`, `propose_change`, `write_session_report`, cross-brain isolation tests (3 leaks fixed, see `workers/api/test/v4-isolation.test.ts`). Waiting items now carry `detail.authorId`.
- Tests: web 54, api 746, mcp 101, policy 74, contracts 91, fixtures 23, connector 53, audit 10, ops 16. Mock e2e `e2e/v4.e2e.ts` 22 tests (`pnpm --filter @secondary/web e2e:mock`). Real stack `e2e/v4-real.spec.ts` 9 tests plus `mcp.spec.ts` (`pnpm e2e`, needs `pnpm dev:all`): sidebar per persona, MCP proposal lands in the right brain's waiting list, seen-changes rule, request access loop, axe at 1280 and 400, French and dark. Screenshots in `e2e/screens/v4-*.png` (mock) and `v4-real-*.png`.
- Gaps: Trash lists nothing (the API does not expose archived pages). "Publish them" opens the waiting list for that brain (a bulk publish would skip the seen rule). Profile shows Entra claims only when `/v1/me` carries `profile` (the API does not yet, the mock does). Adding a member by e-mail resolves through `/v1/admin/principals` (stewards and admins), otherwise the typed value is sent as a principal id. The real schema lists many empty collection types, the page hides them unless the brain's template expects them. Dev mock keeps state in memory, so e2e moves inside the app after a write.
- Not done: no deploy, no push. The v3 note below still lists the dev `LandingPages` class deletion migration (applies on the next api deploy).

Updated: 2026-11-05. By: Claude (Opus, v4 UI).

## v3 brains integrated on `main`; Studio, LP and Digest removed (2026-11-05, Claude Opus, nothing pushed, nothing deployed)

Studio, LP and Digest removed by sponsor decision 2026-11-05.

- Merged `v3/api` then `v3/web` (68dac10) `--no-ff` on top of UX v2. Then removed by decision: the Studio view and rail item, Landing Page Studio (`workers/api/src/lp`, `/v1/lp/*`, MCP `lp_*` tools, `packages/lp-template`, `workers/pages`, web LP views and mocks, LP e2e specs) and the Weekly Digest (`uxv2/digest*`, the Monday ops cron, the web digest UI). Contract sections, deploy-script steps, binding inventory, backup (`kind=lp`) and rights erase entries are gone too. Also dropped the LP-only `channels` and `metric` fields of the story permission route. Web information architecture otherwise unchanged (a redesign follows, `docs/DESIGN-V4-BRAINS-UI.md`).
- Cloudflare: nothing deleted. The dev api worker still has the `LandingPages` object class and its `secondary-pages-dev` bucket and `secondary-pages-dev` worker exist. `workers/api/wrangler.jsonc` adds migration `v3` (`deleted_classes: ["LandingPages"]`) for dev; deploying the api applies it (data of that class is destroyed then). Remove the pages worker and bucket by hand after confirming.
- Gap 1, Everyone at Mantu: `Ctx.openBrains` (tenant table `open_brains`, in the tenant snapshot, set by `PUT /v1/brains/:id/access`) lifts a team or Company Global brain to content for any recognised person, `AdmittedView.lifted`, `canDoInView` allows only `view_structure` and `view_content` there. Never account, NDA, restricted, contacts, Personal, nor a node under a restricted or NDA ancestor (the engine re-checks, whatever the table says). Only `reader` is offered. Opening takes two people (M-8, `brainopen:` key); closing one. Tests: `packages/policy/test/everyone.test.ts`, `workers/api/test/brains-everyone.test.ts`.
- Gap 2, import dry run: `POST /v1/brains/:id/import?dryRun=1` returns the classifier verdicts and writes nothing; the wizard's check step shows them before the import button (`views/brains/Import.tsx`). Gap 3: `GET /v1/agents/config` returns `{mcpUrl}` from the api var `MCP_PUBLIC_URL` (dev: `https://secondary-mcp-dev.tony-walteur.workers.dev`; staging and prod empty, set per environment; `scripts/dev-all.mjs` points it at localhost); Agents uses it and guesses only on null. Gaps 4 and 5 dropped (LP only).
- Security review `V3-LP-SECURITY-REVIEW.md`, fixed with tests that failed before: H-2 stored brain role checked on Questions list, single decide and batch (`review`, `approve_release`) and on the hidden-version read (`edit`); M-3 an MCP call must carry `grant_id` (api 400 `grant_required`, mcp 403 `grant_unknown`), a bad connection id is 400, `POST /v1/agents/revoke-all {confirm:true}`; M-4 raising a field's visibility or dropping a sensitive field needs a second person bound to the exact schema; M-5 an MCP proposal never publishes directly; M-7 the zip total is counted on real bytes, overlapping entries and local-name mismatch are refused (`test/zip-craft.ts`); M-8 as above. Skipped with LP: H-1, M-1, M-2, M-6. Not done (low): L-5 journal counts for non-deciders, L-6 co-owner demotion needs no second person, L-7, L-8 (dry run `replaces` can confirm a page id).
- Tests: `workers/api/test/v3-security.test.ts` (H-2, M-4, M-5, M-7), `brains-everyone.test.ts`, `brains-agents.test.ts`, `workers/mcp/test/grant.test.ts`, `apps/web/src/test/import-wizard.test.tsx`.

Updated: 2026-11-05. By: Claude (Opus, v3 integration).

## Landing Page Studio integrated on `main` (2026-11-05, Claude Opus, nothing pushed, dev redeployed)

Merged `lp/api` (earlier) and `lp/web` (d92ecd6) `--no-ff`. Worktree `.worktrees/v3-api` untouched.

- Renderer: the premium template is now the shared package `packages/lp-template` (`@secondary/lp-template`, pure, no imports). Web preview and API both use it. `workers/api/src/lp/render.ts` keeps `LandingRenderData` and maps to it (`preview` = template mode `public`, `published` adds the consent banner and the one beacon script). Images: `/p/<slug>/i/<n>` only when published, inline `data:` otherwise; no `https:`. No inline style attribute. The pages worker CSP stays hash based (`style-src` and `script-src` by sha256, `img-src 'self'`); the template also takes a `nonce` for the style. The web frames (editor, review, list thumbs) apply the CSS as a constructed stylesheet because the app CSP has no inline style. Footer claims are real now (closing date from `expiresAt`, "reviewed by a second person"); with no references the work section is left out.
- Web and API aligned: list rows carry `stats` (`byDay` objects), drafts carry `url`, `expiresAt`, `updatedAt`, contact `title`; check `fix` is `{label, text?, removeReference?}` with slot `reference:<pageId>`; release question title "Landing page: role at company", options "Approve page"/"Ask for changes", `detail.landing = {id, draft, previous}`; `references` returns an array; reference `metric` only when the story permission carries `metric` (permission route accepts `metric:{value,label}`). Contract test `workers/api/test/lp-mock-contract.test.ts`.
- Language: one language per page. Deterministic composer and mock use theme words in the page language (the typed angle is never pasted); `clientPhrase` has sector names per language (unknown sector is left out); "the client" and contact placeholders handled; AI slots in the other language are refused (`lp/lang.ts`). Tests in `lp-integrated.test.ts`.
- Ops: `POST /v1/admin/switches {switch:"lp", enabled:false, takeOffline:true}` takes published pages offline (audited per page). Person erasure removes their pages and redacts them as contact (incl. snapshots). LP store is backup target `kind=lp`; restore re-expires and re-applies erasures. Dev reseed empties the LP store.
- Bugs found by running for real: pages worker called `crypto.getRandomValues` in global scope (workerd refuses; the worker would not start), now lazy. App CSP blocked data-URI fonts; vite no longer inlines fonts. `scripts/dev-all.mjs` now also runs the pages worker (8790) on the same local bucket; `e2e/lp-real.spec.ts` drives compose, review, publish and the public page in a browser.
- Gaps: brain pages carry no images, so the visual picker is empty on the real stack. Page copy from the brain stays in the language of its page.
- Gates: build, typecheck, biome clean. Tests: lp-template 9, fixtures 23, contracts 91, policy 57, connector 53, ops 17, audit 10, pages 14, web 72, mcp 89, api 665. Playwright real stack 54 passed, mock suite 53 passed.

Updated: 2026-11-05. By: Claude (LP integration).

## v3 brains backend, WS-A (2026-11-05, Claude Opus, branch `v3/api`, not merged, nothing deployed)

Design: `docs/DESIGN-BRAINS-V3.md`; shapes: `docs/API-CONTRACT.md` "v3 brains" (first commit 4a1eb8f, amended with what the build settled).

- policy: `packages/policy/src/brains.ts` (pure): brain type of a node, role ladder (reader to owner) mapped to policy actions, `roleAllows` (a stored role only narrows), bounds for publication mode and Everyone at Mantu. Engine untouched.
- api `workers/api/src/brains/*` (one mount line in `routes.ts`): `routes.ts` directory, home, template, access, guide, coach; `data.ts` fields, hidden versions, import, journal; `agents.ts` connections and pilot cohorts; `store.ts` `BrainBase` (between `WikiBase` and `Workspace`, tables in `WIKI_TABLES`); `importers.ts`, `unzip.ts`, `sanitize.ts`, `fields.ts`, `model.ts` (templates, health, field schema).
- Touched elsewhere, small: `wiki/routes.ts` (stored-role cap in `open()`, `publishDirect` on propose, hidden-version rules on history and `?rev=`, `fields` on the page read), `wiki/store.ts` (`publishDirect`, hidden columns in history, journal left out of lint), `wiki/engine.ts` (dreaming skips journals), `uxv2/questions.ts` (filters, `POST /questions/batch`, one `resolveQuestion` for both), `uxv2/export.ts` (`properties`, none fields only), `uxv2/digest.ts` (Journal section), `security.ts` (the import route takes zip or JSON up to 5 MB, everything else keeps 32 KB JSON), `tenant-policy.ts` (`agent_grants`, `pilot_cohorts`), `auth.ts` (records and enforces agent grants, MCP allowlist gets guide and coach propose), `internal-auth.ts` (optional `grant_id`, `host`; the two copies stay identical).
- mcp: `get_brain_guide`, `coach_propose_structure` (no tool applies a structure); every call carries the grant id and host; on `connection_revoked` the worker deletes the OAuth grant, so a revoked token is dead at both ends. `packages/contracts/src/agent-host.ts` labels the host.
- Rules worth knowing: Personal Brain publication default stays `review` (direct only when set); a stored brain role never widens; restricted brains: membership adds use the governance change (two-person), role changes use `requestSecond`; personal-sensitivity fields hold values only in a Personal Brain; confidential fields show to editors and never to an agent session; export and AI see `none` fields only; a stored `direct` is ignored the moment a brain stops allowing it; imports never publish in a shared brain.
- Open: Everyone at Mantu is stored and bounded but does not widen the admitted view (needs an engine change); a pending membership on a restricted brain keeps its stored role until the change applies (role caps nothing while not admitted); pilot invitations are matched by address, so erasure removes them only for people the directory knows; agent grants of a person with no directory row cannot be erased by address; no web yet (WS-B).
- Gates: build, typecheck, `biome check .` clean (29 old CSS warnings). Tests: fixtures 23, contracts 91, policy 63, web 62, audit 10, connector 53, ops 17, pages 13, mcp 95, api 728 (1155 in all). Not run: Playwright (no web changes here).

Updated: 2026-11-05. By: Claude (Opus, v3 WS-A).

## Landing Page Studio backend (2026-11-05, Claude, branch `lp/api`, not merged, nothing deployed)

Design: `docs/DESIGN-LP-STUDIO.md`; contract: `docs/API-CONTRACT.md` "Landing Page Studio" (including `LandingRenderData`).

- api: `workers/api/src/lp/*` (store = new Durable Object `LandingPages` `LP`, migration v2; refs, compose, checks, render, review, stats, retention, questions, routes). One mount line in `routes.ts`, export in `index.ts`, `lp` kill switch (`switches.ts`, gate in `ops-admin.ts`), MCP routes in `auth.ts`, a release question in `uxv2/questions.ts`, a digest section in `uxv2/digest.ts`, expiry in the ops retention job, optional `channels` on the story permission route (`ux/records.ts`). New bucket binding `PAGES`, var `PAGES_BASE_URL`.
- pages: new `workers/pages` (`secondary-pages-<env>`): bucket plus per-page counter only. `deploy.sh` creates the bucket and deploys it; `assert-eu.mjs` checks it.
- mcp: `lp_compose`, `lp_compose_batch`, `lp_list`.
- Open: a switch-off does not take published pages down (unpublish stays open); erasure of a person does not yet drop their landing pages (they expire at 90 days); the LP store is not in the ops backup.

Updated: 2026-11-05. By: Claude (LP backend).

## Dev wiki seed, role-aware suggestions, index-first answers (2026-11-05, Claude Opus, `main`, nothing pushed)

Problem was live: the deployed dev brain had 0 wiki pages and Ask said "unknown" to its own suggestions.

- Seed: `workers/api/src/wiki/seed-content.ts` (pure data per workspace: Company Global methods, department and circle pages, per account client, projects, opportunity, bids, internal success stories, interactions, decisions, commitments, risks, restricted contacts; three notes per persona's Personal Brain), `wiki/seed.ts` (`ensureWikiSeed`, `wikiSeedEnabled`), `Workspace.wikiSeedRun`. It goes through the ordinary ingest with `JobContext.seed` (deterministic extractor plus `seedPageDrafts` in `wiki/text.ts`), accepted at once as `origin: seed` (`verified_by seed:synthetic`; refused unless ENVIRONMENT is dev). Pages have an `origin` column (`seed` or `human`; a human edit makes it `human`), the page read returns it, export frontmatter has `origin` and `synthetic`, the reading pane shows "Synthetic seed". About 620 records and 730 pages in 69 workspaces, 2 s locally.
- Versioning: `TenantPolicy` `seed_version` plus a claim with a 2 minute lease (`seedClaim`, `seedDone`); `WIKI_SEED_VERSION` in seed-content.ts. Dev only, run from the auth middleware and from `/v1/admin/seed`; a reseed resets it. A rerun creates only missing records, never redrafts a page a person owns. `WIKI_SEED=off` disables it (vitest sets it, so other suites still start empty).
- Contacts: an item tagged `contacts` gates on `<account>:con` (`gateOfItem` in `wiki/store.ts`), so head of bid reads Acme but not its contact page.
- Ask: `GET /v1/ask/suggestions` (questions only from pages the caller can read, each worded from the page title); the web Ask uses it and falls back to the fixed list only when the request fails (mock). Deterministic answer is index first: question words minus stop words, title weighted, a list of up to 4 pages with one line and citation, then key points; unknown only when nothing readable matches.
- Tests: `workers/api/test/wiki-seed.test.ts` (18: pages per workspace, NDA, contacts and Personal Brain isolation, every persona's suggestions answer with citations, idempotent rerun, human pages kept, versioning, staging and prod never seed). e2e wiki spec no longer assumes an empty c_bid wiki and has a seeded-Ask test.
- Gates: build, typecheck, `biome check .` clean. Tests fixtures 23, contracts 91, policy 57, web 62, audit 10, connector 53, ops 17, mcp 87, api 609. Playwright real stack 51 passed, mock suite 26 passed.
- Not verified: the deployed dev tenant (behind Access, 302 from outside). Its first request after deploy runs the seed once (wait for it; if it is cut short the claim expires after 2 minutes and the next request resumes, since the run is idempotent).

Updated: 2026-11-05. By: Claude (Opus).

## UX v2 integrated on `main` (2026-11-05, Claude, nothing pushed, dev redeployed)

Merged `--no-ff`: `uxv2/api` (28e95e2), then `uxv2/web`. Worktrees `.worktrees/uxv2-*` removed (both clean). Design: `docs/DESIGN-UX-V2.md`; shapes: `docs/API-CONTRACT.md` "UX v2 endpoints".

- Client aligned to the API: `savedPct` is a fraction (0..1), shown as a percentage (`Ask.tsx`, `Usage.tsx`); contradiction `sources` are `{id,title}`; mock option actions are the API's (`prefer_incoming`, `keep_current`, lint `approve`/`reject`, release `approve`/`request_changes`); the client sends `revisionHash` from the question detail. `workers/api/test/uxv2-mock-contract.test.ts` runs the same call against the real API and the web mock (`apps/web/src/mock/uxv2.ts`) and fails when the mock has a field or JSON type the API lacks, or a `savedPct` outside 0..1.
- Bell root cause (`e2e/access-flow.spec.ts` now opens `/` again): the directory and every delivery know the seeded principal (`u_reviewer`), but since 07b1fda a dev persona signs in under its own address and so has another principal id; the bell read an inbox nobody wrote to. The old test only passed on Today because Today prints "waiting for review" itself. Fix: `admin/routes.ts` `inboxIds`, `admin/store.ts` `inbox` and `markRead` read and mark the session id plus, for a dev persona, the seeded person it stands for. Test `review-notify.test.ts` (failed on the old code).
- Weekly digest job: ops cron `23 5 * * 1` (all three environments) calls `POST /v1/internal/ops/digest` (ops-signed); `workers/api/src/uxv2/digest-job.ts` composes each directory person's digest under their own rights and stores a draft in their Personal Brain through the same `saveDraft` the manual route uses. Drafts only, no send path. The id is a hash of person and week, so a second run or a doubled cron adds nothing; a week with nothing to report makes no draft; a receipt `digest.scheduled` comes first. Tests `uxv2-digest-job.test.ts`, `ops.test.ts`; `environments.test.ts` lists the three crons.
- Gates: build, typecheck and `biome check .` clean (25 CSS `noDescendingSpecificity` warnings in `styles/uxv2.css`, left as they are). Tests fixtures 23, contracts 91, policy 57, web 62, audit 10, connector 53, ops 17, mcp 87, api 591 (991 in all). Playwright real stack 50 passed; mock suite (`e2e/playwright.uxv2.config.ts`) 26 passed. `bash scripts/deploy.sh dev` exited 0 (host behind Access, curl answers 302).
- Deploy note: the ops worker now has a third cron; deploy ops and api together.

Updated: 2026-11-05. By: Claude (UX v2 integration).

## Staging re-check items closed (2026-11-05, Claude Opus, `main`, nothing pushed, dev redeployed)

Source: `docs/security/STAGING-GO-NOGO.md` (OneDrive project). Each fix has a regression test that failed on the old code first and passes now. Nothing is left in `docs/security/ACCEPTED-RISKS.md` for these items (only the M-08 wording changed).

- N-02 `security-journal.ts`, `tenant-policy.ts` `importAll`: an append-only journal (`security_journal`, outside `SNAPSHOT_TABLES`, 90 days) records deprovisioning (`principal_status`), kill switches, NDA grants and revocations (with the console's reason and expiry), memberships and role changes. A tenant restore replays it, oldest first, and the revocation epoch never goes below the live value. Erasure drops a person's entries; a reseed clears it. Test `restore-security.test.ts`.
- N-01 `human.ts`, `TenantPolicy.humanIds` and `requestSecond(key, actor, now, email)`: one human is the Entra subject (tenant plus oid) or the normalised address. Content release and review, wiki decide, prod switch re-enable, rights export and erase, and "cannot erase self" compare it; Workspace `review`, `approve` and `wikiDecide` take the actor's other ids. Test `b2-sameperson.test.ts`.
- B2 M-02 `ops-internal.ts` `/restore`, `workers/ops/src/backup.ts`: outside dev the first request records (`ops_restore_request`, 202 `pending`), a different Access handle confirms the same snapshot within 24 h (`ops_restore`, `ops_restore_done`), the same person gets 409 `same_person`, no handle is 403 `actor_required`. Off by default (`RESTORE_ENABLED`). Tests `ops-restore-twoperson.test.ts`, `ops.test.ts`.
- N-03 `ops-admin.ts`: rights export is `POST /v1/admin/rights/export {principal}` behind the mutation guard; GET is 405. Test in `ops-rights.test.ts`.
- N-04 `ai/proof.ts`: `BRIEF_PROOF_KEY`, a secret the api alone holds (`deploy.sh` generates it with `single_secret api`, `dev-all.mjs` for local). No key, no proof. Test in `ai-routes.test.ts`, `environments.test.ts`.
- B2 M-06 `ai/routes.ts`, `ai/budget.ts` `withUserCap`: the planner writes an `ai.plan` receipt before the model call (audit down means deterministic plan), runs `contractGate` on the node's account and on any account the prompt names (unknown or not allowed means deterministic plan and a deny receipt), and briefs and planner share a per-person daily token cap (`AI_USER_DAILY_TOKEN_BUDGET`, default 40000).
- B1 M3 `packages/policy/src/engine.ts` `canDoInView(..., live?)`: `/v1/actions`, the review queue and the review decision pass the live record (author, status, revision). `own_drafts` needs author == caller and a draft or candidate status. Tests `prototype-checks.test.ts` 19b, `actions.test.ts`.
- B1 L3 `workers/mcp/src/config.ts`: `ALLOWED_REDIRECT_URIS` (exact URLs or `*` path prefixes) replaces the host list; port only on loopback, no credentials or fragment; `chat.openai.com` dropped; `/authorize` refuses a request without an S256 challenge. L4 `workers/mcp/src/rate-limit.ts`: per-address KV counters on `/register` (plus a per-address and a global daily cap), `/token`, `/authorize`; the edge rule is in `docs/runbooks/MCP-EDGE-LIMITS.md`. L5 `routes.ts` `visibleHits`: search reads pages of 50 until it has 25 visible hits (500 rows scanned at most). L6 `stubs.ts`: `DO_JURISDICTION=off` needs the local sign-in address too, and `scripts/assert-eu.mjs` stops `deploy.sh` unless the config says `eu`.
- Deploy: new secret `BRIEF_PROOF_KEY` (api only, set by `deploy.sh`, never printed). The mcp var `ALLOWED_REDIRECT_HOSTS` is now `ALLOWED_REDIRECT_URIS`. Pilot checklist item: add the Cloudflare rate limiting rule on the MCP host. Deploy all five workers together.
- Gates at the last run: build, typecheck and `biome check .` clean. Tests fixtures 23, contracts 91, policy 57, web 49, audit 10, connector 53, ops 15, mcp 87, api 515 (900 in all). Playwright 50 passed. `bash scripts/deploy.sh dev` exited 0; the api host answers 302 (Access), so `/v1/health` cannot be read back from outside.
- Not changed: N-05 and N-06 (info). The dev persona header stays dev only.

Updated: 2026-11-05. By: Claude (Opus, staging re-check items).

## B2 review, remaining findings closed (2026-11-05, Claude Opus, `main`, commits acac616 to 5f8887c, nothing pushed)

Source: `docs/security/B2-SECURITY-REVIEW.md` (OneDrive project) plus the wiki review L-07. Every finding was open in the code before this pass (checked one by one). Each fix has a regression test that failed on the old source and passes now. Accepted decisions: `docs/security/ACCEPTED-RISKS.md` (owner Tony Walteur).

- M-07 `admin/validate.ts`: manage_members, approve_release or review on `*` or a restricted scope, and any new or looser elevation, need a second approver. M-08 `admin/store.ts`: `gov_identity` remembers which address each principal id acted with; proposer, beneficiary, requester and elevation subject count as the same person under any id with that address. L-06: last-admin guard counts only holders who are not deprovisioned. I-05: inbox titles say "a restricted account" for NDA accounts. Tests `b2-governance.test.ts`. Commit acac616.
- I-01: docs and runbooks now say revocation is per request (roles and `active` are read every time); the epoch is a counter. I-03: MCP edge pre-check logs `mcp_switch_check_failed`. Commit ba2607b.
- L-03 `security.ts`: browser mutations are refused when `Sec-Fetch-Site` is not same-origin/none or `Origin` is foreign (same-site siblings included). Commit 370e089.
- M-04: the `connector` switch now stops `/v1/sources/:id`, source hits in search and wiki source reads. Commit 030536e. M-05: AI evidence checks `AI use with client` per owning account (`ai/evidence.ts` `ownerAllowsAi`). Commit 645d6b2. L-04: `/v1/briefs` returns a `proof` (HMAC, per tenant and person, 24 h) and `/v1/briefs/save` refuses a brief without it (`ai/proof.ts`). Commit e19807c.
- M-12: customer permission stores the exact external text (`permission.text`); a rewrite locks it until recorded again; `POST .../permission` takes `text`; the story form in the web app records text and permission together (e2e updated). Old permissions without `text` read as locked. Commit 07129fa.
- L-07: pending sign-ins are capped per address (10, `login_state.ip_hash`) and evicted busiest-first; a re-login deletes the session the browser held. Commits 4c9b583, 8d8ffbf. L-08: retag, prefs, first draft save and draft delete write receipts; a draft key must be `new` or an existing note. Commit 68a7af1.
- M-03, commit 68b3764: audit `/pseudonymise` lists only `<date>/<tenant>/` folders and pages by budget; the API runs the audit pass first, so a failure leaves nothing half done; each erase leaves a tombstone in `erasure_tombstones` (TenantPolicy, not in `SNAPSHOT_TABLES`, 90 days) and a tenant or workspace restore applies it again (`reapplyErasures`, `erasuresReapplied` in the restore answer); connector `userKey` is an HMAC under `CONNECTOR_HMAC_KEY` (signature `userKey(secret, email)`), `/internal/acl/forget` drops it on erase (`connectorCacheForgotten` in the summary).
- M-02 receipt, commit 2c4a707: `/v1/internal/ops/restore` writes `ops_restore` before and `ops_restore_done` after, under `ops:<handle>` (handle = SHA-256 prefix of the Access email or service token name, or `key` in dev), and returns 503 when the audit worker is down. The ops worker passes `actor=` (signed in the query).
- Wiki L-07, commit 5f8887c: each proposed fact carries `excerpt` (the source line, JSON element or record; the closest line for AI drafts), shown in the review only when the reader may read the source.
- I-02 and I-04 are accepted, not built (see ACCEPTED-RISKS). Dev reseeds clear tombstones.
- Deploy notes: no new secrets. api, audit, connector, ops and mcp must deploy together (the `userKey` change empties the ACL cache once; the erase walk and restore route changed on both sides).

Updated: 2026-11-05. By: Claude (Opus, remaining B2 review findings; earlier B3 wiki security fixes; Sonnet built B3). Earlier: tasks G0.7 and G0.8 of the roadmap.

## B3 wiki security review fixes (2026-11-05, Claude Opus, `main`, commits ac56af8 and d4f9508, dev redeployed, nothing pushed)

Source: `docs/security/B3-WIKI-SECURITY-REVIEW.md` in the OneDrive project. Regression tests: `workers/api/test/wiki-hardening.test.ts` (28 of 29 failed on the old code, all pass now). Existing wiki tests now decide as a second person and send `revisionHash`.

- H-01: `wikiDecide` refuses author, editors (`edits` table) and the author of a source (L-03). Approve needs `revisionHash` (`GET .../proposals/:id` returns `revision`, `revisionHash`, `approvals`, `required`). An edit bumps the item revision, so older approvals stop counting. Company Global proposals need 2 distinct approvers (`status: "pending"` after the first). Generated pages cannot be edited.
- H-02, M-01: every proposal carries `titleSources`; routes mask title, rationale, detail, fact text and queue rows as "restricted source" unless all are readable. Lines need every citation readable. A page with citations but none readable is hidden (index, read, history, search). The log stores ids only (`*.proposed {id, sourceIds}`); `GET .../log` looks titles up per viewer. `readableMany` in `wiki/routes.ts` batches the connector check once per request.
- M-02: `wikiForgetSources` runs from `sourceDelete`, `remove`, `purgeExpired`. `pseudonymise(from, to, aliases)` also rewrites text (email from `TenantPolicy.emailOfPrincipal`). Subject export carries the personal wiki.
- M-03: history `?limit&before` with `X-Next-Before`, 1000 line pages, coarse diff above 1000 lines, 500 pages per load. M-04: `generalise` and `residualIdentifiers` in `wiki/text.ts`, promote returns 422 when anything survives. M-05: `WIKI_SEARCH_PER_MIN`, `WIKI_WRITE_PER_MIN` (default 30), 20 hit pages per query, 10 minute ingest debounce, wiki gets 40% of the daily AI budget (own counter `wiki:<day>`).
- L-01 to L-06 done. L-07 (source excerpt beside each fact in review) not done. `wiki_jobs` gained an `attempts` column, added by a migration in the constructor.
- Dev limit: only `acme_lead` can both write and decide on `a_acme`, so the e2e wiki tests now run on circle `c_bid` (head_bid writes, reviewer decides).
- Deploy: `bash scripts/deploy.sh dev` exited 0 (audit, api, connector, mcp, ops uploaded). `https://secondary-api-dev.tony-walteur.workers.dev/v1/health` and `/v1/me` both answer 302 to the Cloudflare Access login, because an Access application now covers the whole host. `/v1/health` could therefore not be read back as 200 from outside. Check it with an Access token or from inside.
- Totals: biome clean, build and typecheck clean, tests fixtures 23, contracts 91, policy 56, web 49, audit 8, connector 50, ops 13, api 466, mcp 79, Playwright 50 passed.

## B3 Living Wiki (2026-11-05, Claude, branch `b3/wiki`, not merged, nothing deployed)

Design: `docs/DESIGN-LIVING-WIKI.md`. Contract: `docs/API-CONTRACT.md`, "Living Wiki". Code: `workers/api/src/wiki/*` (types, text, store, engine, routes, review, hooks), `apps/web/src/views/wiki/*`, MCP tools `wiki_search`, `wiki_read`, `wiki_propose`. Tests: `workers/api/test/wiki.test.ts` and `wiki-units.test.ts` (every acceptance test of the design doc), `workers/mcp/test/tools.test.ts`, `apps/web/src/test/wiki.test.tsx`, `e2e/wiki.spec.ts`.

Totals at the last full run: build, typecheck and `biome check .` clean. Tests: fixtures 23, contracts 91, policy 55, web 49, audit 8, connector 49, ops 6, api 386, mcp 79. Playwright 50 passed (axe on the wiki views, FR, 400 px).

How it is built:

- `Workspace` now extends `WikiBase` (`wiki/store.ts`): wiki tables live in the workspace's own object and are in snapshots, erasure and reseed. Review items are ordinary items of kind `wiki_ingest|wiki_lint|wiki_dream`, so `GET /v1/review` lists them (with `kind`). They are decided only through `/v1/wiki/:ws/proposals/:id/decide`, which applies the diff. `Workspace.load` refuses them for `/v1/actions`.
- Hooks (one line each): record create/update (`ux/records.ts`), Personal Brain note create/edit, connector upsert, and the new meeting record endpoint call `wikiNotify`, which queues an ingest job. A DO alarm runs jobs, lint daily and dreaming at 02:00 UTC. `WIKI_ALARMS=off` (set in the api vitest config) disables scheduling; `POST /v1/wiki/:ws/run` runs everything due. Jobs are claimed atomically, so an alarm and a manual run never take the same job.
- Ingest: triage by content hash, then the deterministic extractor (structured records, meeting records, `Decision:`/`Commitment:`/`Risk:` lines) or, when `ANTHROPIC_API_KEY` is set and the account contract says `allowed`, the model (single-source prompt, citation per claim, output validated, R-110 on input and output). Personal Brain never goes to a model.
- Promote to Global registers the released candidate in the global wiki (`wiki_promotions`), which publishes the page lazily on the next read. `submitCandidate` and `parseUserValidated` in `routes.ts` are now exported and passed into `wikiRoutes`.
- Citations are re-checked per caller on every read, search, ask and promote: the gate node must be at content level for the caller, and connector files need the connector's explicit yes (fail closed). Claims that lose all their sources are dropped.
- `workers/api/test/ops-rights.test.ts` erases the seeded `u_ceo` and reads receipts from a stub shared by all test files, so any other file that writes receipts as `u_ceo` can make it fail under parallel load (seen before B3 too). The wiki tests use their own CEO address for that reason. It passes alone.
- Do not run `biome check --write` and then `git checkout _relay/HANDOFF.md`: biome reformats this file, and the checkout throws the notes away.

Not done or not verified:

- No live model call (tests stub fetch). The AI path is exercised with a hostile fixture and a stub only.
- Briefs do not show wiki facts yet (the "unverified" badge exists in the wiki UI and API only).
- The dev mock (`pnpm --filter @secondary/web dev:mock`) has no wiki: the tab says it needs the live stack.
- Lint caps at 20 findings per kind per run. Schema editing has an object method (`wikiSetSchema`) but no route or UI.
- The Opus security review of the wiki surface is still to do (cross-workspace isolation is covered by tests, not reviewed).

## Current state

- Repo initialised on `main`, no remote, nothing pushed. pnpm workspace, TypeScript strict, Vitest, Biome, Node pinned in `.nvmrc`.
- `azure-pipelines.yml` runs install, lint, typecheck, test. It has not run on Azure DevOps yet.
- `packages/fixtures`: deterministic synthetic generator (2 tenants, 4 accounts with Calypso NDA-hidden, 12 people, 500 docs, 50 meetings, 10 transcripts with labelled personal segments in `personal-segments.json`, 16 canary tokens, 3 hostile docs). Output in `packages/fixtures/out/` (gitignored), small committed copy in `packages/fixtures/sample/`.
- Tests cover determinism, counts, canary isolation, email domain and a source guard.

## Next steps

1. Sprint 1 (identity and policy, EP-02 and EP-03): principal/tenant/membership tuples, Tenant Policy as single decision point, binding inventory test. Consume `canaries.json` for the two-tenant canary suite.
2. Contracts v1.2 landed in the OneDrive project at `spec/Secondary-PRD-v1.2-errata/` (20 schemas, 54 examples, ajv PASS re-verified 2026-11-04 by Claude Opus). Next: copy them into a `packages/contracts` package with the ajv validator as a committed test (the current validator script lives only in a temporary scratchpad), then validate fixtures against them.
3. New sponsor request: role-scoped Company Map (department radial view, CEO sees all Company Brain, department heads see their department). Design: `docs/design/COMPANY-MAP-DESIGN.md` in the OneDrive project, requirements R-112 to R-114, decisions D13 to D15. Slice 1 needs department scope in the membership/policy model only.
4. Keep domain code behind a storage interface until hosting is decided.

## Blockers

- Waiting on sponsor decisions D1 to D15 (D4 hosting blocks Sprint 1 scope; D10 fixture policy is already followed).
- Azure DevOps project and repo for the pipeline are not created; nothing is pushed.

## Notes

- Under the Claude Code sandbox, `pnpm install` fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (file locking blocked). Run it in a normal shell. Later pnpm commands may need `--config.verify-deps-before-run=false` inside the sandbox.
- Regenerate the sample with `pnpm --filter @secondary/fixtures generate:sample`. It rewrites `provenance.json` with a new timestamp.

## Phase 1 scaffold (B1), 2026-11-04

- Monorepo now has `apps/web` (React 18 + Vite), `workers/api` (Hono, DOs `TenantPolicy` and `Workspace`, R2, AUDIT service binding), `workers/audit`, `packages/policy`, `packages/contracts`. Root scripts: `build`, `test`, `typecheck`, `lint`, `dev`.
- pnpm is not on PATH: use `corepack pnpm` (run install unsandboxed). Worker tests use `@cloudflare/vitest-plugin` (successor of vitest-pool-workers, whose bundled workerd rejects the current compat date); the AUDIT service binding is stubbed in `workers/api/vitest.config.ts`.
- Worker typecheck runs `wrangler types` first (generated `worker-configuration.d.ts` is gitignored). `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are empty until Access is configured.
- Nothing deployed, no Cloudflare resources created.

## B1 integration, 2026-11-05 (Claude, integrator)

State: `main` holds policy, api, mcp and web merged, security review fixes applied, web wired to the real API, local multi-worker stack and Playwright e2e working. Nothing pushed, nothing deployed, no Cloudflare resources.

Exact commands (use `corepack pnpm`; install unsandboxed; scripts call `pnpm`, so put a `pnpm` shim that runs `corepack pnpm` on PATH):

```sh
corepack pnpm install
corepack pnpm build && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test
corepack pnpm dev:all -- --seed        # api :8787 (web + /v1), mcp :8788, audit via binding; secrets in .dev/secrets.json
corepack pnpm e2e                      # Playwright (chromium: pnpm exec playwright install chromium); starts the stack if :8787 is down
corepack pnpm e2e:mcp [persona]        # scripted MCP host against :8788
corepack pnpm --filter @secondary/web dev:mock   # web with mock data
```

What changed beyond the three merges:

- Web: plane names are the policy names, lists are bare arrays, revisions are integers (shown as r3), `/v1/personal/targets`, contribute sends `user_validated` and acknowledges the server's flags (the browser scan is gone), review verdict is `changes_requested`, drawer has comment, edit and contribute forms, GenUI follows `view-plan.schema.json` (Callout uses `template`). Saved personal notes are read-only (the API has no update). Mock mode mirrors the same shapes.
- Map ring: labels at least 12 px rendered (hubs 14 px bold), the ring is fitted to the panel and refits on resize.
- Security review: C1, H1, H2, M1 to M4 fixed with regression tests (see `docs/API-CONTRACT.md`, "Integration notes"). Reviewer holds approve_release on Company Global (two distinct approvers).
- MCP and API wiring verified live: binding `API` (secondary-api-dev) and signed internal calls work, `INTERNAL_HMAC_KEY` is shared, audit keys are per caller.
- `workers/mcp/package.json` declares `@modelcontextprotocol/sdk` (optional peer of `agents`, tests failed without it).

Open items and notes:

- L1 to L6 of the review are not done (key id for HMAC rotation, redirect allowlist by path, rate limits on /register /token, search over-fetch, `DO_JURISDICTION=off` only on loopback).
- M3 second half (pass the live Workspace record into item-level decisions) is not done; `own_drafts` now needs author == caller.
- With the seeded personas only the Knowledge reviewer holds approve on Company Global, so a global release needs a second approver from another scope or a new persona.
- The Personal Brain workspaces are not wiped by a reseed (they are not part of the seed scopes).
- Deploy: routes are optional placeholders in the three wrangler configs. At deploy set secrets (`INTERNAL_HMAC_KEY`, `SEED_TOKEN`, `AUDIT_KEY_API`, `AUDIT_KEY_MCP`, `AUDIT_KEY_READ`), Access team domain and aud on api and mcp, `MCP_PUBLIC_URL`, the KV id for `OAUTH_KV`, and keep `DO_JURISDICTION=eu`.

## B3 integration, 2026-11-05 (Claude, integrator). Read this first

State: `main` holds `b3/wiki` (`--no-ff`, no textual conflicts) on top of the B2 security fixes, plus the follow-up commit below. Nothing pushed, nothing deployed. The `.worktrees/*` checkouts (b1, b2, b3) are removed; the branches are kept.

Commands are the same as in the B2 section (`corepack pnpm`, `pnpm` shim, install unsandboxed). Totals at the last run: build, typecheck and `biome check .` clean. Tests: fixtures 23, contracts 91, policy 56, web 49, audit 8, connector 50, ops 13, api 437 (three clean full runs), mcp 79. Playwright 50 passed.

Security review applied to the wiki:

- AI gate: the only wiki path that calls a model is ingest drafting (`wiki/engine.ts` `aiDraft`). It now calls `gate(env, switchOn)` with the tenant `ai` kill switch (`aiSwitchOn`, read from TenantPolicy because the job has no session; unreadable counts as off), `AI_ENABLED` and `AI_PROCESSOR_CONTRACT=approved`. When the gate refuses, the deterministic extractor runs only if `ENVIRONMENT=dev` (the synthetic org). In staging and prod the job is skipped (`ingest.skipped`, "AI not available: ...") and the source stays un-ingested. Dreaming and ask are deterministic (no model call); a test pins that.
- Wiki MCP tools use the same signed internal call as every tool (HMAC v2, key id, nonce). Tests: the wiki routes serve a v2 call once, refuse replay, v1, a missing nonce, a wrong key and a path swap.
- Promote to Global goes through the workspace two-approver release; the requester (author) is refused by `Workspace.approve` (`self_approval`), one approver cannot count twice.
- Restricted circle wikis open only with an explicit circle membership (policy H-03): a department membership gives 404, a two-person approved circle membership gives 200. The CEO still reads it through the CEO role grant.
- New tests: `workers/api/test/wiki-security.test.ts` (the AI gate tests fail on the pre-fix engine).
- Test fix: `ops-rights.test.ts` asserted that no receipt contains the substring `u_ceo`, which also matched `u_ceo_<hash>` (other CEO-like test addresses), so it failed depending on file order. It now checks the whole quoted id. `biome.json` ignores the gitignored `.dev` folder (Playwright wrote a file there that failed the formatter).

Open: the wiki ingest alarm retries nothing when AI is off in staging or prod; sources are picked up again when they change or on a forced re-ingest. The wiki screens are English and French but the brief and PrepareBrief screens stay English only.

## B2 integration, 2026-11-05 (Claude, integrator). Read this first

State: `main` holds b2/ops, id, gov, conn, ai and ux (six `--no-ff` merges, in that order) plus the gap fixes below. Nothing pushed, nothing deployed, no Cloudflare resources. The per-workstream notes after this section are history: those branches are merged.

Exact commands (`corepack pnpm`; put a `pnpm` shim on PATH that runs `corepack pnpm`; install unsandboxed):

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm -r --no-bail test
corepack pnpm e2e          # Playwright incl. axe, starts the stack via scripts/dev-all.mjs --no-build (needs apps/web built); global-setup reseeds and warms the service bindings
corepack pnpm e2e:mcp ceo  # scripted MCP host against :8788
```

Totals at the last run: build, typecheck and `biome check .` clean (0 errors, 0 warnings). Tests: fixtures 23, contracts 91, policy 55, web 41, audit 8, connector 49, ops 6, api 340, mcp 76. Playwright 44 passed, axe on every view with no rule skipped.

What the integration changed:

- Conflict resolution: unions in `routes.ts`, `wrangler.jsonc`, `env.d.ts`, `types.ts`, `API-CONTRACT.md`; `AccountWorkspace.tsx` took the UX layout and re-added the AI "Prepare brief" buttons; TenantPolicy snapshots now also cover the identity (`principal_status`, `group_role_map`, `scim_*`) and `gov_*` tables, and erasure also clears the identity rows of the principal.
- Policy consumes memberships: grant condition `membership: true` (see `docs/API-CONTRACT.md`, "Memberships reach the policy"). `head_bid`, `acme_lead`, `consultant` carry three such grants. Tenants seeded earlier keep their stored role bodies until reseeded (dev) or edited in the console. Approving an access request now changes what the requester sees (tested end to end, including the two-person path). A requester whose id is not in the directory (a dev persona under a non-seeded address) can be admitted through their own request only.
- The drawer's "Request access" opens `RequestAccessForm` (governance API). Review events (contribute, request changes, approve, release, second approval needed) post content-free notices to the inbox (`workers/api/src/ux/notify.ts`, best effort). The web renders connector `source` search results (`/sources/:id`, text only).
- Admin screens are translated FR/EN (`adm.*` keys, a test keeps both dictionaries equal). Tables scroll in a focusable labelled region (`TableWrap`), so the axe skip is gone.
- The `workers/audit` typecheck passes with and without `.dev.vars` (the secrets are typed in `src/env.d.ts`).
- Dev mock: covers prefs, drafts, attention, AI status (always not configured) and one synced file ("handbook"); everything else B2 answers 501 "Not part of the dev mock" (admin console, briefs, personal edit/history, records, review detail). Documented at the top of `apps/web/src/mock/index.ts`.
- Deploy: `scripts/deploy.sh <env>` now creates the sync queue, deploys audit, then (first time only) a 503 placeholder worker under the connector's name, then api, connector, mcp, ops. That bridges the api/connector service-binding cycle. `CONNECTOR_HMAC_KEY` is shared by api and connector. The script never generates `GRAPH_CLIENT_SECRET`, `ENTRA_CLIENT_SECRET`, `SCIM_TOKEN` or `ANTHROPIC_API_KEY`. The connector has staging and prod env blocks, and the api binds the connector in every environment. Not run against a live account: the placeholder step and `wrangler deployments list --name` are unverified.
- Local stack: `dev-all.mjs` blanks the Access team and AUD (wrangler.jsonc carries the deployed dev values, which broke the loopback sign-in and the MCP e2e), writes `AUDIT_KEY_ERASE` and `PSEUDONYM_KEY`, and raises `RATE_LIMIT_PER_MIN` to 6000 (all personas share one address and one counter). The vitest configs of api and mcp do the same for Access. The connector and ops workers are not part of the local stack.

Open items and notes:

- `workers/api/test/ops-rights.test.ts` failed twice in one run under load (an erased principal id still found in a workspace export) and passed on every other run. Not reproduced; check if it recurs.
- Playwright right after a cold `wrangler dev` start can see the audit service binding not answering for a while; `e2e/global-setup.ts` now waits for the api and mcp bindings. It is a local registry artefact, not seen in unit tests.
- The brief and PrepareBrief screens are still English only (outside the admin scope asked for).
- Still not done: the Opus security review of B2, the updated threat model, SBOM wiring, the L1 to L6 items of the B1 review, the Entra, Graph and Anthropic values that need Tony or IT, and any live check of the connector, SCIM or AI against real services.

## B2 ID workstream (Entra OIDC, SCIM, sessions), 2026-11-05, branch `b2/id`

State: committed on `b2/id`, not merged, nothing deployed. New code is `workers/api/src/auth/*` and `workers/api/src/scim/*`; touched `auth.ts` (cookie-session branch, inactive check), `tenant-policy.ts` (identity store delegation, mapped roles, `active`), `index.ts` (two mount lines), `types.ts`, `env.d.ts`, wrangler comments. Tests: `test/entra.test.ts`, `test/scim.test.ts`, helpers in `test/entra-helpers.ts` (fake Entra IdP). Runbook: `docs/runbooks/ENTRA-SETUP.md` (portal steps marked to verify).

Open items: no admin route for the group to role table yet (GOV exposes `groupMapSet/List/Delete`); no UI for `/auth/providers` and sign-in/out (UX); the new vars are not in `wrangler.jsonc` `vars` (the pinned vars test stays as is; OPS adds them per environment); one tenant id only (single Entra tenant); groups overage is logged, not resolved through Graph; SCIM PUT is not implemented; manual grants stay dormant, not deleted, on deprovision.

## B2 CONN (branch b2/conn)

- New `workers/connector`, `packages/contracts/src/source-record.ts`, api additions (`connector.ts`, Workspace `source_*` tables, `/v1/sources/:id`, search).
- Api binding inventory test updated for the `CONNECTOR` service binding. Merge may conflict with ID and GOV on `routes.ts` and `wrangler.jsonc`.
- Nothing deployed. Live Graph behaviour is unverified (see the runbook).

## B2 AI workstream, 2026-11-05 (Claude, branch b2/ai)

Built `workers/api/src/ai/*` (processor, budget, evidence, R-110 segments, briefs, LLM planner, routes) mounted with one line in `routes.ts`, and `apps/web/src/views/brief/*` ("Prepare brief" on Today, account page and each meeting). Contract in `docs/API-CONTRACT.md`, "AI processor". No real key was used: tests stub fetch. Not done: a mock-mode handler for `/v1/briefs` (dev:mock shows "AI processor not configured"), live call against the Anthropic API (needs the key from Tony), Entra or Graph transcript sources (R-110 runs on any evidence body already).

## B2 security review fixes, 2026-11-05 (main, not pushed, not deployed)

Review: `docs/security/B2-SECURITY-REVIEW.md` in the vault copy. Fixed on `main` with a regression test each (new tests were run against the pre-fix code and failed there):

- H-03 `packages/policy/src/engine.ts` (department membership skips restricted nodes). H-04 `admin/store.ts` `decide` (`beneficiary_decision`). H-05/M-06 `ai/brief.ts` `gate(env, switchOn)`, `ops-admin.ts` ai gate, `ai/config.ts` (AI_ENABLED and AI_PROCESSOR_CONTRACT=approved). H-06 `ops-admin.ts` rights export is two-person.
- H-01/H-02/M-09/M-10/M-11 identity: `auth/identity-store.ts` (`principals.subject` = `tid:oid`, SCIM-managed fail closed), `auth/oidc.ts`, `auth/routes.ts`, `tenant-policy.ts`. New vars `ENTRA_ALLOW_GUESTS`, `ACCESS_LINKED_EMAILS`. Test helper: `entra-helpers.ts` gives each test user their own `oid`; SCIM_TOKEN is no longer on by default there.
- M-01/M-02/L-01/L-02/L-05: `OPS_HMAC_KEY` (api and ops only), MCP kill switch route `/v1/internal/mcp/switches`, ops behind Access (`workers/ops/src/access.ts`), staging `RESTORE_ENABLED=no`, key id and nonce on every signed call (`packages/contracts/src/signed-call.ts`, v2 wire format), replay cache in TenantPolicy and ConnectorState.
- Deploy notes: set `OPS_HMAC_KEY` on api and ops, delete `INTERNAL_HMAC_KEY` from ops, configure Access for ops before staging, set `AI_ENABLED` and `AI_PROCESSOR_CONTRACT` only when the processor contract is signed. All HMAC senders and verifiers must deploy together once (v1 to v2).
- `workers/api` tests run one file at a time (`fileParallelism: false`): the AUDIT stand-in is shared and made ops-rights flaky. e2e ports are configurable (`DEV_API_PORT`, `DEV_MCP_PORT`, `DEV_REGISTRY_PATH`) so a second stack can run beside another agent's.
- Not done: M-03, M-04, M-05, M-07, M-08, M-12, L-03, L-04, L-06 to L-08, I-01 to I-05 from the review; audit receipt for each ops restore (M-02, only a log event).
