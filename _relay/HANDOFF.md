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
