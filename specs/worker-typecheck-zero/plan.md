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

**Constraints**: Isolated branch. No force, no hook bypass, not `main`, no deploy, no spend. No merge until CI enforces `npm run typecheck:worker` on the exact head. No `any`, no `@ts-ignore`, no new packages, no stubs, no shims. No `tsconfig` path or `preserveSymlinks` into `reconstruction/`. The line 111 rule applies only when `harness/runtime/whole-api-causes.test.ts` is in the tree. `npm test` stays 403/0 and root typecheck stays 0.

**Scale/Scope**: Four file promotions, one Env name check, one CI-attachment stop. Baseline worker errors: 119 (TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. One module per commit. No new package. |
| II. No helper text | Pass. II applies as written. Each promotion removes the leading provenance comment. Provenance is the commit message. No exception. |
| III. Separation | Pass. One path per type is the contract table: one git path and one blob. Barrel re-exports are not a second path. The five siblings stay where they are. No reconstruction tsconfig entry. |
| IV. No bolt-ons | Pass. A count that does not fall stops the commit. No `any` or `@ts-ignore`. |
| V. Tests first | Pass. The standing red is the worker typecheck. A real mismatch is a diagnostic the parent does not report, and it gets its own red test first. A name finding does not. Line 111 is not edited. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. `cursor/state-machines-c94c` only. No merge of `db3e8548`. |
| VIII. QA separate | Pass. Writer reports counts. QA is a non-writer session on the exact head. |
| IX. Exact-head CI | Pass as a stop. Main `190cd048` has no CI. Nothing is added. Until a separate reviewed commit extends that system, QA runs `npm run typecheck:worker` on each T004+ head and records the SHA and exit code. |
| X. Merge and deploy | Pass. No merge until CI enforces the check on the exact head. No deploy. |

Post-design re-check: the same ten rows. Research did not add a package, a merge, or a workflow file.

## Security & data

No runtime behavior change. No database schema change. No stored data change. No deploy and no spend.

Env work reads binding and variable names. The source blob states that secret fields are optional strings and contains no secret values. The finding log records names and mismatches only. It does not record key material, tokens, or `.dev.vars` contents. The spec and this plan do not copy those names into a values file.

Promoted files are type modules and one declaration file beside an existing generated validator. They are not executed as a new service. The declaration file does not change `view-plan.validator.js`.

## Devin's rulings

Recorded 2026-11-12. These replace the earlier "ask which CI file" and "ask which wrangler config" stops.

- CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. This replaces the earlier rule that CI is attached only when Tony names the file. If main has no CI, stop and report before adding anything. Main `190cd04877812c1d238c4468e98a8714086b457f` has no `.github/workflows` directory and no other CI config. This feature adds none.
- Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded.
- No merge until CI enforces the check on the exact head.
- The line 111 rule is a conditional check. It applies only to a tree that contains `harness/runtime/whole-api-causes.test.ts`.
- `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is a separate change and is out of scope here.
- Option B replaces the earlier ruling that a promoted file keeps the named blob's bytes, including its leading `NEW RECONSTRUCTION` comment. Remove only that leading comment and any blank lines directly after it. Every other byte stays identical.
- Per-commit no regression means no new `error TS` line versus the parent. The lane's exit criterion is absolute: `npm run typecheck:worker` reports 0 errors at the final head. Every one-sided Env finding is resolved or explicitly waived in the closeout before that head is called done.

## How analyze was run

QA #54 found no `specify analyze` binary. That matches this install.

- Command: `uvx --from git+https://github.com/github/spec-kit.git@v1.4.0 specify version`
- Output summary: CLI Version 1.4.0, Python 3.12.3, Linux x86_64.
- Command: `uvx --from git+https://github.com/github/spec-kit.git@v1.4.0 specify --help`
- Output summary: commands are `init`, `check`, `version`, `mcp`, `self`, `extension`, `integration`, `event`, `preset`, `artifact`, `bundle`, and `workflow`. There is no `analyze` command. The project integration is `none`, so no agent command copy was installed.
- The v1.4.0 analyze step is the template `templates/commands/analyze.md` in the package checkout of tag `v1.4.0` (git `0019fa14d12f45edabc2cc3176c9168a68bd0f97`). It is read-only. It does not write a file.
- Its script, run from the repo root: `SPECIFY_FEATURE_DIRECTORY=specs/worker-typecheck-zero .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`
- The review then reads `spec.md`, `plan.md`, `tasks.md`, and `.specify/memory/constitution.md` under the rules in that template. Rerun after the barrel wording fix: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (`spec.md` status Draft). Constitution II is not in conflict. The barrel follows the same N=7 comment removal as the other promotions.

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
tsconfig.worker.json
package.json
```

**Structure Decision**: The four git paths are the contract table. `packages` stays a symlink to `recovered-source/shared/packages`, so the worker import strings and the git paths are one file each. The five agent-ui siblings stay in that directory and are not copied. `tsconfig.worker.json` already includes `recovered-source/worker/src/**/*.ts` and `recovered-source/shared/packages/**/*.ts`. Root `tsconfig.json` does not gain a `reconstruction/` include. No new project directory.

## Complexity Tracking

None. Constitution II is applied as written. No exception is recorded.
