# Implementation Plan: v24 deploy recovery

**Branch**: `cursor/recover-v24-deploy-1c66` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/v24-deploy-recovery/spec.md`

## Summary

Add a Wrangler config, a guarded deploy script, and the v24 `/graph` wrapper on this branch. Binding and secret material is names only. `keep_vars` preserves the live plain-text settings. The SPA directory stays a marker because the asset bytes are not in the repo or the source map. The pending-column verdict is no new migration. No deploy and no edit to recovered Worker source.

## Technical Context

**Language/Version**: TypeScript 5.9.3 and Node 22, as already pinned. Wrangler 4.158.0 is added as a dev dependency.

**Primary Dependencies**: Existing `hono`, `zod`, `jose`, `@openuidev/lang-core`, and `@cloudflare/workers-types` `5.20261107.1`. Wrangler 4.158.0 is the newest release whose optional peer accepts that types package. The types package is not upgraded.

**Storage**: No new table and no new Durable Object migration tag. Tag `v3` is recorded for the two existing SQLite classes.

**Testing**: Node's built-in test runner via `npm test`. Red tests land before the config and the wrapper.

**Target Platform**: Cloudflare Workers, Worker name `secondary-api-dev`, compatibility date `2026-10-01`, flag `nodejs_compat`.

**Project Type**: Recovered Worker plus a deploy entry.

**Performance Goals**: Not a runtime change. The dry run must compile the Worker bundle.

**Constraints**: Names only for secrets and plain-text settings. No `.dev.vars`. No deploy, merge, force-push, or `main` update. No Cloudflare API call. Worker typecheck stays at 0 errors. Parent `npm test` is 416 passed and 0 failed before the new tests.

**Scale/Scope**: One Wrangler config, one deploy script, one guard module, eight graph files, and the tests that pin them.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. One config, one wrapper, one guard. Wrangler is the deploy tool this repo did not have. No UI framework. |
| II. No helper text | Pass. Recovered `/graph` bytes stay as they are. Provenance is the commit message. |
| III. Separation | Pass. The wrapper lives under `deploy/`. No `tsconfig` path points at `reconstruction/`. |
| IV. No bolt-ons | Pass. `@secondary/policy` uses Wrangler's `alias` to the existing adapter. No `any` and no `@ts-ignore`. |
| V. Tests first | Pass. T001 and T002 are the failing tests. Implementation starts at T003. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. `cursor/recover-v24-deploy-1c66` only. The constitution's named lane is the typecheck feature, which this plan does not touch. |
| VIII. QA separate | Pass. The writer records counts. QA is a later session on the exact head. |
| IX. Exact-head CI | Pass as a record. This feature adds no CI file. Gates are the four commands in FR-012, run on the implementation head. |
| X. Merge and deploy | Pass. No merge and no deploy. `deploy.sh` refuses a real deploy while the SPA marker exists. |

Post-design re-check: the same ten rows. Research added Wrangler and no other package. It did not add a route, an account id, or a migration tag.

## Security & data

Read: v24 binding names and types, the source-map text of `src/brains/store.ts`, and the eight file bodies inside `graph-entry.js`. Those bodies were already scanned in the reference manifest with zero secret hits. This plan does not copy the scan's pattern list into a new secret store.

Write: `wrangler.jsonc` names, `deploy/` graph files, the guard, the deploy script, and tests. The eleven plain-text names appear as a comment. The nine secret names appear in `secrets.required`. No value is written for either list.

Forbidden: secret values, a `.dev.vars` file, `wrangler secret put`, `wrangler secret delete`, `--secrets-file`, a Cloudflare API call, a tunnel, a new R2 bucket or Durable Object namespace, a `deleted_classes` migration, an edit to `brains/store.ts`, and a real deploy while `deploy/assets/UNREPRODUCED` exists. `keep_vars: true` is what stops a later deploy from deleting the live plain-text settings. Wrangler's own rule is that secrets are not deleted by deploy.

The alias target `harness/adapters/policy-entry.ts` re-exports recovered policy source. It is not a new policy implementation.

## Project Structure

### Documentation (this feature)

```text
specs/v24-deploy-recovery/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/bindings.md
├── contracts/graph-entry.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
wrangler.jsonc
deploy.sh
deploy/guard.ts
deploy/graph-route.ts
deploy/graph-entry.ts
deploy/graph/
deploy/assets/UNREPRODUCED
harness/tests/v24-bindings.test.ts
harness/tests/graph-entry.test.ts
package.json
package-lock.json
```

**Structure Decision**: The deploy entry is `deploy/`, outside `recovered-source/`, so the recovered Worker bytes stay put. `deploy/graph-entry.ts` imports `recovered-source/worker/src/index.ts` and re-exports it. Wrangler bundles that graph. Root `tsconfig.json` already includes `harness/tests/**/*.ts`, so the new tests and the modules they import are typechecked. `deploy/graph-entry.ts` is bundled by Wrangler and is not added to `tsconfig.worker.json`, so the worker error count stays 0.

## Complexity Tracking

None. Wrangler is required because the repo had no deploy compiler. No constitution exception is recorded.

## How analyze was run

Spec Kit v1.4.0 was fetched as `git clone --branch v1.4.0` of `github/spec-kit`. The checkout is commit `0019fa14d12f45edabc2cc3176c9168a68bd0f97`. `pyproject.toml` version is `1.4.0`. `uvx` is not installed in this environment. The analyze step is `templates/commands/analyze.md` from that tag. `.specify/extensions.yml` is absent, so no hook ran.

Script, from the repo root:

```bash
SPECIFY_FEATURE_DIRECTORY=specs/v24-deploy-recovery .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks
```

The script exited 0. `FEATURE_DIR` is `specs/v24-deploy-recovery`. Available docs: `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `tasks.md`.

The review read `spec.md`, `plan.md`, `tasks.md`, and `.specify/memory/constitution.md` under that template. Result: 0 CRITICAL, 0 HIGH, 0 MEDIUM. Coverage is 14/14 functional requirements. No constitution MUST is unmet: the typecheck lane's branch name is a different feature, and this plan does not edit that branch.
