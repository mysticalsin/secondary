# Implementation Plan: Erasure partial-failed append

**Branch**: `cursor/erasure-partial-failed-append-7e21` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/erasure-partial-failed-append/spec.md`

**Note**: Spec phase only. No file under `src/`, `recovered-source/`, or `harness/` changes until Clarifications names one option.

## Summary

A no-key erase returns before the ledger runner and leaves a stored request unchanged. A later keyed erase widens the grant, appends the full plan onto that stored order, and can finish `partial_failed` when a step returns false. The same append finishes `completed` when every step returns true. Devin or Tony names Accept, Replace, or Resume before any edit under `src/`, `recovered-source/`, or `harness/`. The first behavior commit is one test of that sequence. No other erasure transition changes.

## Technical Context

**Language/Version**: TypeScript already configured in `tsconfig.json` and `tsconfig.worker.json`. Node `>=22.18`. No new compiler package.

**Primary Dependencies**: None added. The erasure reducer is `src/state/erasure-request.ts`. The route and runner are the recovered Worker files named in the spec.

**Storage**: The existing `erasure_requests` row. This plan does not add a table or a column.

**Testing**: `npm test` through the node test runner. The new test belongs in `harness/tests/erasure-request.test.ts`. Root gate `npm run typecheck`. Worker gate `npm run typecheck:worker`.

**Target Platform**: The existing recovered API Worker harness. No deploy.

**Project Type**: One reducer plus the erase route that already calls it.

**Performance Goals**: Not a throughput change. One request's terminal status and order are the outcome.

**Constraints**: Isolated branch `cursor/erasure-partial-failed-append-7e21`. No force, no hook bypass, not `main`, no merge, no deploy, no CI file, no new package. No `any` and no `@ts-ignore`. Constitution V: a behavior change starts with a failing test. Accept is not a behavior change, so its test locks today's outcome and `src/` and `recovered-source/` stay unchanged.

**Scale/Scope**: One sequence, one new test, and at most the request-append branch of `transitionErasure` plus the grant helper that leaves the stored order in place. Absent-subject erasures stay out of the behavior change until Clarifications says otherwise.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Simplicity | Pass. No new package. One test, and a production edit only if the named option is not today's outcome. |
| II. No helper text | Pass. No new label on a layout or a type. The decision lives in the spec. |
| III. Separation | Pass. The request stays the one erasure reducer. No second ledger. |
| IV. No bolt-ons | Pass. No `any`, no `@ts-ignore`, no shim. An unnamed option stops the edit. |
| V. Tests first | Pass. The test is the first behavior commit. It fails before a production edit when the named option differs from today. |
| VI. Security & data | Pass. Section below. |
| VII. Isolated branch | Pass. This branch only. No push to `main`. |
| VIII. QA separate | Pass. This phase records the path and the options. QA is a later non-writer session. |
| IX. Exact-head CI | Pass as a stop. This feature adds no CI config. |
| X. Merge and deploy | Pass. No merge and no deploy in this phase. |

Post-design re-check: the same ten rows. Research did not select an option, add a package, or add a workflow file.

## Security & data

The no-key path reads the pseudonym key only to refuse. This plan does not copy a key, a token, or a connector secret. The spec names the key as missing, empty, short, or usable.

A keyed erase can delete a person, rewrite receipts, write a tombstone, and call the connector. That already happens on `565bff6a2ba3153f11347482cdee3555b257f87f`. This feature does not add a new delete. Replace or Resume, once named, changes which steps run. Accept runs the steps that already run. None of the three options logs the key or the erased content.

The harness test uses the fixture key already in `harness/tests/erasure-request.test.ts`. The spec does not repeat it.

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

**Structure Decision**: The reproduction cites those files. A later behavior commit may edit `src/state/erasure-request.ts` and the one test. It does not edit the route's no-key refusal, which FR-001 keeps.

## Complexity Tracking

No constitution violation needs a justification.
