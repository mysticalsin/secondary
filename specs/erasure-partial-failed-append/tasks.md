# Tasks: Erasure partial-failed append

**Input**: Design documents from `/specs/erasure-partial-failed-append/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/erasure-sequence.md, quickstart.md

**Tests**: The sequence test is required by FR-005. It is the first behavior commit after an option is named.

**Organization**: The gate blocks both stories. Story 1 locks the named outcome. Story 2 checks that nothing else moved.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

## Phase 1: Setup

**Purpose**: Keep this lane on the existing toolchain.

- [ ] T001 Confirm the parent is `565bff6a2ba3153f11347482cdee3555b257f87f` and add no package, no CI config, and no deploy file. Leave the Observed path in `spec.md` as the SC-001 record. Covers FR-006, SC-001.

## Phase 2: Foundational

**Purpose**: Stop until the product option is named.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Read `specs/erasure-partial-failed-append/spec.md` Clarifications. If it does not name exactly one of Accept, Replace, or Resume, stop. Do not edit `src/`, `recovered-source/`, or `harness/`. Covers FR-002, SC-002.

## Phase 3: User Story 1 - Lock the refused-then-keyed outcome (Priority: P1)

**Goal**: One test asserts the named option for the false-step end and the all-success end.

**Independent Test**: The new test in `harness/tests/erasure-request.test.ts` drives the contract sequence and compares the stored status and order with the named option.

- [ ] T003 [US1] After T002, add one test in `harness/tests/erasure-request.test.ts` for the contract in `specs/erasure-partial-failed-append/contracts/erasure-sequence.md`. Assert the named option's false-step pair and its success pair. If that option is not today's outcome, the test fails on `565bff6a2ba3153f11347482cdee3555b257f87f` before T004. If the option is Accept, the test passes on that commit. Covers FR-003, FR-005, SC-003.
- [ ] T004 [US1] Only when the named option is not today's outcome: change the request-append path so T003 passes. Leave the no-key refusal at `recovered-source/worker/src/ops-admin.ts:180` and `recovered-source/worker/src/ops-rights.ts:153` in place. If the named option is Accept, mark this task dropped and write that reason here. Covers FR-002, FR-005.

**Checkpoint**: The stored status and order match the named option, or the task stopped because no option is named.

## Phase 4: User Story 2 - Leave every other erasure transition (Priority: P2)

**Goal**: Existing erasure tests stay green. No other transition is edited.

**Independent Test**: `npm test` still passes the erasure tests that exist on the parent, plus the one new test.

- [ ] T005 [P] [US2] Re-run the no-key tests in `harness/tests/erasure-request.test.ts` that lock an unchanged ledger (`erasure request` cases at the unusable-key test and the `erase_disabled` route test). Both still pass. Covers FR-001.
- [ ] T006 [US2] Diff the behavior change, when T004 ran, against the transitions listed as unchanged in `specs/erasure-partial-failed-append/data-model.md`. No other erasure transition is in that diff. Covers FR-004.

**Checkpoint**: The suite's previous erasure tests pass.

## Phase 5: Polish

- [ ] T007 Run `npm test`, `npm run typecheck`, and `npm run typecheck:worker` on the behavior head. `npm test` passes, including the new test. Both typechecks report 0 errors. No CI file is added. Covers FR-006, SC-003.

## Dependencies

- T002 depends on T001. T003 depends on T002. T004 depends on T003 being red.
- T005 depends on T002 and can run beside T003.
- T006 depends on T004 when a production edit exists, and on T003 when T004 was dropped.
- T007 depends on T003, T005, and T006.

## Parallel example: after the option is named

```text
T003 Add the sequence test
T005 Re-run the existing no-key tests
```

## Implementation strategy

T002 is the stop. T003 is the first behavior commit. T004 happens only when the named option is not today's outcome. Accept drops T004 with that reason written in this file. T001–T007 stay unchecked in the spec commits. The behavior lane checks a task when that lane finishes it.
