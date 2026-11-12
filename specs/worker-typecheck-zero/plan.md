# Implementation Plan: Worker typecheck zero

**Branch**: `cursor/state-machines-c94c` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/worker-typecheck-zero/spec.md`

**Note**: Spec phase only. This plan does not add code or type files.

## Summary

Place four reconstructed modules at the import paths the Worker already uses, one blob per commit, then check Env names against blob `841f0dbc97ac` without copying secrets. The worker typecheck count falls on every commit and ends at 0. No `reconstruction/` tsconfig entry, no merge, no second copy.

## Technical Context

**Language/Version**: TypeScript as already configured in `tsconfig.json` and `tsconfig.worker.json`. No new compiler package.

**Primary Dependencies**: None added. Spec Kit v1.4.0 was used to write this plan. The Worker already depends on the toolchain in `package.json`.

**Storage**: N/A. No schema and no stored data change.

**Testing**: `npm test` (node test runner). Root gate `npm run typecheck`. Worker gate `npm run typecheck:worker`.

**Target Platform**: The existing Worker typecheck project. No deploy.

**Project Type**: Recovered API Worker plus the contracts package it imports.

**Performance Goals**: Not a runtime change. The worker typecheck error count decreases on each implementation commit and ends at 0.

**Constraints**: Isolated branch. No force, no hook bypass, not `main`, no merge, no deploy, no spend. No `any`, no `@ts-ignore`, no new packages, no stubs, no shims. No `tsconfig` path or `preserveSymlinks` into `reconstruction/`. `harness/runtime/whole-api-causes.test.ts` line 111 stays unchanged. `npm test` stays 403/0 and root typecheck stays 0.

**Scale/Scope**: Four file promotions, one Env name check, one CI-attachment stop. Baseline worker errors: 119 (TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. One module per commit. No new package. |
| II. No helper text | Pass. Provenance is the commit message. |
| III. Separation | Pass. One path per type. No reconstruction tsconfig entry. |
| IV. No bolt-ons | Pass. A count that does not fall stops the commit. No `any` or `@ts-ignore`. |
| V. Tests first | Pass. The standing red is the worker typecheck. A new mismatch gets its own red test first. Line 111 is not edited. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. `cursor/state-machines-c94c` only. No merge of `db3e8548`. |
| VIII. QA separate | Pass. Writer reports counts. QA is a non-writer session on the exact head. |
| IX. Exact-head CI | Pass as a stop. No CI file exists, so none is invented. Tony names the file before a gate is attached. |
| X. Merge and deploy | Pass. Not in this work. |

Post-design re-check: the same ten rows. Research did not add a package, a merge, or a workflow file.

## Security & data

No runtime behavior change. No database schema change. No stored data change. No deploy and no spend.

Env work reads binding and variable names. The source blob states that secret fields are optional strings and contains no secret values. The finding log records names and mismatches only. It does not record key material, tokens, or `.dev.vars` contents. The spec and this plan do not copy those names into a values file.

Promoted files are type modules and one declaration file beside an existing generated validator. They are not executed as a new service. The declaration file does not change `view-plan.validator.js`.

## Project Structure

### Documentation (this feature)

```text
specs/worker-typecheck-zero/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/promoted-modules.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
recovered-source/worker/src/types.ts
packages/contracts/src/agent-ui/index.ts
packages/contracts/src/view-plan.ts
recovered-source/worker/src/generated/view-plan.validator.d.ts
tsconfig.worker.json
package.json
```

**Structure Decision**: The four destinations are the paths the Worker already imports. `tsconfig.worker.json` already includes `recovered-source/worker/src/**/*.ts`. Root `tsconfig.json` does not gain a `reconstruction/` include. No new project directory.

## Complexity Tracking

None. The constitution check has no violation that needs a simpler alternative rejected.
