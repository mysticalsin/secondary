# Implementation Plan: Worker typecheck zero

**Branch**: `cursor/state-machines-c94c` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/worker-typecheck-zero/spec.md`

**Note**: Spec phase only. This plan does not add code or type files.

## Summary

T018 lands first. It adds `reconstructed-manifest.json` beside `candidate-manifest.json`, with an empty `files` array, and updates `harness/tests/intake.test.ts`. `candidate-manifest.json` stays the recovered list. Then write `recovered-source/worker/src/env.d.ts` from blob `841f0dbc97ac`, then place four reconstructed modules at the import paths the Worker already uses. T011 and T004 through T007 are one promoted file plus exactly one manifest entry per commit. The worker typecheck count stays 119 on T018, falls on every promotion commit, and ends at 0. No `reconstruction/` tsconfig entry, no merge, no second copy. The types.ts trial at `a4a721a7` removed 37 lines from the 119 baseline, which is about 82 once the added `Env` diagnostic is absent. `ux/notify.ts:45` is TS7006 at `a4a721a7`, not TS7053. T004's parent is the T011 head (48 `error TS` lines expected from the T011 dry run at `f21513b9`). T004 lowers that count and adds no new `error TS` line versus that head.

## Technical Context

**Language/Version**: TypeScript as already configured in `tsconfig.json` and `tsconfig.worker.json`. No new compiler package.

**Primary Dependencies**: None added. Spec Kit v1.4.0 was used to write this plan. The Worker already depends on the toolchain in `package.json`.

**Storage**: N/A. No schema and no stored data change.

**Testing**: `npm test` (node test runner). Root gate `npm run typecheck`. Worker gate `npm run typecheck:worker`.

**Target Platform**: The existing Worker typecheck project. No deploy.

**Project Type**: Recovered API Worker plus the contracts package it imports.

**Performance Goals**: Not a runtime change. The worker typecheck error count decreases on each implementation commit and ends at 0.

**Constraints**: Isolated branch. No force, no hook bypass, not `main`, no deploy, no spend. No merge until CI enforces `npm run typecheck:worker` on the exact head. No `any`, no `@ts-ignore`, no new packages, no stubs, no shims. No `tsconfig` path or `preserveSymlinks` into `reconstruction/`. The line 111 rule applies only when `harness/runtime/whole-api-causes.test.ts` is in the tree. `npm test` is 403/0 on this spec head and 404/0 from T018 onward. Root typecheck stays 0.

**Scale/Scope**: One manifest-test commit, five file promotions, one Env name check, one CI-attachment stop. Baseline worker errors: 119 (TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1). `npm test` is 403/0 until T018, then 404/0.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. One module per commit. No new package. |
| II. No helper text | Pass. II applies as written. Each promotion removes the leading provenance comment. Provenance is the commit message. No exception. |
| III. Separation | Pass. One path per type is the contract table: one git path and one blob. Barrel re-exports are not a second path. The five siblings stay where they are. No reconstruction tsconfig entry. |
| IV. No bolt-ons | Pass. A count that does not fall stops the commit. No `any` or `@ts-ignore`. |
| V. Tests first | Pass. The standing red is the worker typecheck. A real mismatch is a diagnostic the parent does not report, and it gets its own red test first. A name finding does not. Line 111 is not edited. T018 adds one passing test and drops no assertion. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. `cursor/state-machines-c94c` only. No merge of `db3e8548`. |
| VIII. QA separate | Pass. Writer reports counts. QA is a non-writer session on the exact head. |
| IX. Exact-head CI | Pass as a stop. Main `190cd048` has no CI. Nothing is added. Until a separate reviewed commit extends that system, QA runs `npm run typecheck:worker` on each T004+ head and records the SHA and exit code. |
| X. Merge and deploy | Pass. No merge until CI enforces the check on the exact head. No deploy. |

Post-design re-check: the same ten rows. Research did not add a package, a merge, or a workflow file.

The repo rule that the worker count goes down on every implementation commit still binds T011 and T004 through T007. T018 adds no promoted module. Its worker count equals its parent, 119, and does not rise. Devin's ruling C places that commit before any promotion.

## Security & data

No runtime behavior change. No database schema change. No stored data change. No deploy and no spend.

Env work reads binding and variable names. The source blob states that secret fields are optional strings and contains no secret values. The finding log records names and mismatches only. It does not record key material, tokens, or `.dev.vars` contents. The spec and this plan do not copy those names into a values file. `reconstructed-manifest.json` stores paths, the commit id `db3e8548`, blob ids, N, sha256 digests, and the two `env.d.ts` import lines. It stores no secret values.

Promoted files are type modules and one declaration file beside an existing generated validator. They are not executed as a new service. The declaration file does not change `view-plan.validator.js`.

## Devin's rulings

Recorded 2026-11-12. These replace the earlier "ask which CI file" and "ask which wrangler config" stops.

- CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. This replaces the earlier rule that CI is attached only when Tony names the file. If main has no CI, stop and report before adding anything. Main `190cd04877812c1d238c4468e98a8714086b457f` has no `.github/workflows` directory and no other CI config. This feature adds none.
- Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded.
- No merge until CI enforces the check on the exact head.
- The line 111 rule is a conditional check. It applies only to a tree that contains `harness/runtime/whole-api-causes.test.ts`.
- `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is a separate change and is out of scope here.
- Option B replaces the earlier ruling that a promoted file keeps the named blob's bytes, including its leading `NEW RECONSTRUCTION` comment. Remove only that leading comment and any blank lines directly after it. Every other byte stays identical.
- Per-commit no regression means no new `error TS` line versus the parent. Devin rejected a waiver for that rule. If `env.d.ts` references an undeclared name, the writer stops and reports. The lane's exit criterion is absolute: `npm run typecheck:worker` reports 0 errors at the final head. A one-sided Env name finding is still resolved or explicitly waived in the closeout. That waiver is not a waiver of an `error TS` line.
- T011 runs before T004. The dependency check is below.
- Ruling C: `candidate-manifest.json` stays the recovered intake list and is not edited. Promoted files are listed only in `reconstructed-manifest.json` at the repository root. T018 writes the empty `files` array and the intake test update before T011. T011 and T004 through T007 each add one entry with the file.

## Task order check

T018 was added ahead of T011. T011 stays ahead of T004. Each later task was checked against that order.

- T018 depends on the head of this spec amendment. It does not depend on T001–T017.
- T011 depends on T018.
- T004 depends on T011. T005 depends on T004. T006 depends on T005. T007 depends on T006.
- T008 applies to T004–T007. T011 stops on its own gate. T018 stops when the suite is not 404/0.
- T009 depends on T004–T007, so it is after T011 and T018.
- T010 depends on T009. T012 depends on T010. T013 depends on T012.
- T014 and T015 depend on T013. T016 and T017 depend on T013–T015.

No task requires a file that a later task creates. T018 creates the manifest file that T011 and T004 through T007 then edit.

## How analyze was run

QA #54 found no `specify analyze` binary. That matches this install.

- Command: `uvx --from git+https://github.com/github/spec-kit.git@v1.4.0 specify version`
- Output summary: CLI Version 1.4.0, Python 3.12.3, Linux x86_64.
- Command: `uvx --from git+https://github.com/github/spec-kit.git@v1.4.0 specify --help`
- Output summary: commands are `init`, `check`, `version`, `mcp`, `self`, `extension`, `integration`, `event`, `preset`, `artifact`, `bundle`, and `workflow`. There is no `analyze` command. The project integration is `none`, so no agent command copy was installed.
- The v1.4.0 analyze step is the template `templates/commands/analyze.md` in the package checkout of tag `v1.4.0` (git `0019fa14d12f45edabc2cc3176c9168a68bd0f97`). It is read-only. It does not write a file.
- Its script, run from the repo root: `SPECIFY_FEATURE_DIRECTORY=specs/worker-typecheck-zero .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`
- The review then reads `spec.md`, `plan.md`, `tasks.md`, and `.specify/memory/constitution.md` under the rules in that template. Rerun after ruling C added T018 and `reconstructed-manifest.json`: 0 CRITICAL, 0 HIGH, 0 MEDIUM. Constitution II is not in conflict. A new `error TS` line is not waived.

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
recovered-source/shared/packages/contracts/src/agent-ui/index.ts
recovered-source/shared/packages/contracts/src/view-plan.ts
recovered-source/worker/src/generated/view-plan.validator.d.ts
recovered-source/worker/src/env.d.ts
reconstructed-manifest.json
harness/tests/intake.test.ts
tsconfig.worker.json
package.json
```

**Structure Decision**: The four git paths are the contract table. `packages` stays a symlink to `recovered-source/shared/packages`, so the worker import strings and the git paths are one file each. The five agent-ui siblings stay in that directory and are not copied. `tsconfig.worker.json` already includes `recovered-source/worker/src/**/*.ts` and `recovered-source/shared/packages/**/*.ts`. Root `tsconfig.json` does not gain a `reconstruction/` include. No new project directory.

## Complexity Tracking

None. Constitution II is applied as written. No exception is recorded.
