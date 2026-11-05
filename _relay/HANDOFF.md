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

## B2 CONN (branch b2/conn)

- New `workers/connector`, `packages/contracts/src/source-record.ts`, api additions (`connector.ts`, Workspace `source_*` tables, `/v1/sources/:id`, search).
- Api binding inventory test updated for the `CONNECTOR` service binding. Merge may conflict with ID and GOV on `routes.ts` and `wrangler.jsonc`.
- Nothing deployed. Live Graph behaviour is unverified (see the runbook).

