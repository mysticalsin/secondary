# Implementation Plan: Erasure partial-failed append

**Branch**: `cursor/erasure-partial-failed-append-7e21` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/erasure-partial-failed-append/spec.md`

**Note**: The behavior commits are on this branch. The request decision is `src/state/erasure-request.ts:370-380`.

## Summary

A no-key erase returns before the ledger runner and leaves a stored request unchanged. A later keyed erase on a non-completed row, before the green commit, appends the canonical plan, so directory runs before receipts. That breaks M-03. Devin's ruling is Replace with the done-step guard, in the single `transitionErasure` request decision at `src/state/erasure-request.ts:358` and `:370`. When no step is done and every pending stored step is already in the plan, the stored order becomes the canonical plan from `erasurePlan` (`erasure-request.ts:260-268`): receipts first, directory last. A pending stored step the current plan omits stays, a `scope:*` step among the scope steps. A done step stays done, keeps its place relative to other done steps, stays ahead of the not-done steps, and is not run. Not-done steps are placed after the done steps, in canonical order. A false step ends `partial_failed`. Every performed step returning true ends `completed`. `addSteps` still only appends. Accept and Resume are rejected.

## Technical Context

**Language/Version**: TypeScript already configured in `tsconfig.json` and `tsconfig.worker.json`. Node `>=22.18`. No new compiler package.

**Primary Dependencies**: None added. The erasure reducer is `src/state/erasure-request.ts`. The route and runner are the recovered Worker files named in the spec.

**Storage**: The existing `erasure_requests` row. This plan adds no table, no column, and no migration.

**Testing**: `npm test` through the node test runner. The new tests belong in `harness/tests/erasure-request.test.ts`. Root gate `npm run typecheck`. Worker gate `npm run typecheck:worker`.

**Target Platform**: The existing recovered API Worker harness. No deploy.

**Project Type**: One request decision in the existing erasure reducer, plus tests.

**Performance Goals**: No latency budget. The outcome is one request's terminal status and order.

**Constraints**: Isolated branch `cursor/erasure-partial-failed-append-7e21`. No force, no hook bypass, not `main`, no merge, no deploy, no CI file, no new package. No `any` and no `@ts-ignore`. Constitution V: the behavior change starts with failing tests T1, T1b, T2, and T3b, each in its own commit. T3, T4, and T5 are locks. T4's log assertions pass before and after the green commit. The receipts-first assertion in T4 is the check T1b owns, and the test stays as written. The green commit edits only the `:358`/`:370` decision.

**Scale/Scope**: The refused-then-keyed sequence, the done-step guard, a pending step the current plan omits, the absent-subject pin, and the log constraint. The missing-email result and the connector-false result stay as they are. The completed-row path and `addSteps` stay as they are.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. No new package. One decision, one test file, one concern per commit. |
| II. No helper text | Pass. No new label on a layout or a type. The decision lives in the spec. |
| III. Separation | Pass. The request stays the one erasure reducer. No second ledger. |
| IV. No bolt-ons | Pass. No `any`, no `@ts-ignore`, no shim. `addSteps` is not given a second ordering pass. |
| V. Tests first | Pass. T1, T1b, T2, and T3b fail before the green commit. T3 and T4 are locks. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. This branch only. No push to `main`. |
| VIII. QA separate | Pass. Independent QA confirmed the Observed path and the user said to start. The writer does not grade that confirmation. |
| IX. Exact-head CI | Pass as a stop. This feature adds no CI config. |
| X. Merge and deploy | Pass. No merge and no deploy in this phase. |

Post-design re-check: the same ten rows. Research records Replace. It adds no package and no workflow file.

## Security & data

The no-key path reads the pseudonym key only to refuse. This plan does not copy a key, a token, or a connector secret. The spec names the key as missing, empty, short, or usable.

A keyed erase can delete a person, rewrite receipts, write a tombstone, and call the connector. That already happens on `565bff6a2ba3153f11347482cdee3555b257f87f`. This feature does not add a new delete. Replace changes the stored order and which not-done steps run. It does not add a step implementation.

A log line emitted by the re-plan contains a principal id, step names, and states only. It does not contain the pseudonym key, an email address, or erased content. No such line is required. The existing route audit that names the pseudonym stays as it is.

The harness tests use the fixture key already in `harness/tests/erasure-request.test.ts`. The spec does not repeat it.

No migration reads or rewrites stored ledgers. If a directory-before-receipts row is already stored, the same request decision re-plans it.

## Project Structure

### Documentation (this feature)

```text
specs/erasure-partial-failed-append/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── erasure-sequence.md
└── tasks.md
```

### Source Code (repository root)

```text
src/state/erasure-request.ts
recovered-source/worker/src/ops-admin.ts
recovered-source/worker/src/ops-rights.ts
recovered-source/worker/src/tenant-policy.ts
recovered-source/worker/src/connector.ts
harness/tests/erasure-request.test.ts
```

**Structure Decision**: The reproduction cites those files. The green commit edits the request decision in `src/state/erasure-request.ts` only. The tests edit `harness/tests/erasure-request.test.ts` only. The no-key refusal, the connector-false rule, and the missing-email return stay unedited.

## Complexity Tracking

No constitution violation needs a justification.
