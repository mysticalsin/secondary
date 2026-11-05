# HANDOFF

Updated: 2026-11-04. By: Claude (Sonnet). Tasks G0.7 and G0.8 of the roadmap.

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
