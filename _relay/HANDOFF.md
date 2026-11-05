# HANDOFF

Updated: 2026-11-04. By: Claude (Sonnet). Tasks G0.7 and G0.8 of the roadmap.

## Current state

- Repo initialised on `main`, no remote, nothing pushed. pnpm workspace, TypeScript strict, Vitest, Biome, Node pinned in `.nvmrc`.
- `azure-pipelines.yml` runs install, lint, typecheck, test. It has not run on Azure DevOps yet.
- `packages/fixtures`: deterministic synthetic generator (2 tenants, 4 accounts with Calypso NDA-hidden, 12 people, 500 docs, 50 meetings, 10 transcripts with labelled personal segments in `personal-segments.json`, 16 canary tokens, 3 hostile docs). Output in `packages/fixtures/out/` (gitignored), small committed copy in `packages/fixtures/sample/`.
- Tests cover determinism, counts, canary isolation, email domain and a source guard.

## Next steps

1. Sprint 1 (identity and policy, EP-02 and EP-03): principal/tenant/membership tuples, Tenant Policy as single decision point, binding inventory test. Consume `canaries.json` for the two-tenant canary suite.
2. Contracts v1.2 are being written in parallel. Schema validation (ajv) over the fixtures is not added yet; add it once the contracts land.
3. Keep domain code behind a storage interface until hosting is decided.

## Blockers

- Waiting on sponsor decisions D1 to D12 (D4 hosting blocks Sprint 1 scope; D10 fixture policy is already followed).
- Azure DevOps project and repo for the pipeline are not created; nothing is pushed.

## Notes

- Under the Claude Code sandbox, `pnpm install` fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (file locking blocked). Run it in a normal shell. Later pnpm commands may need `--config.verify-deps-before-run=false` inside the sandbox.
- Regenerate the sample with `pnpm --filter @secondary/fixtures generate:sample`. It rewrites `provenance.json` with a new timestamp.
