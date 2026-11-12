# Tasks: Erasure partial-failed append

**Input**: Design documents from `/specs/erasure-partial-failed-append/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/erasure-sequence.md, quickstart.md

**Tests**: FR-005. Red first, one concern per commit. T1, T1b, T2, and T3b fail before the green commit. T3 and T5 are locks and stay passing. T4 is a lock of the log constraint: those assertions pass before and after. The receipts-first assertion in T4 is the check T1b owns, and the test stays as written. The green commit is one edit of the `:358`/`:370` decision.

**Organization**: T000 is the start gate. Story 1 is the Replace behavior. T5 is the unchanged absent-subject pin and is listed before T6 because T6 depends on it. Story 2 also keeps the connector difference and forbids a migration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

## Phase 1: Setup

**Purpose**: Keep this lane on the existing toolchain and stop before code.

- [x] T000 Confirm the parent is `565bff6a2ba3153f11347482cdee3555b257f87f`. Add no package, no CI config, no deploy file, and no migration. Independent QA confirmed the Observed path file:lines in `spec.md` and the user said to start before the first `src/` or `harness/` edit. Covers FR-005, FR-006, SC-001.

## Phase 2: User Story 1 - Replace the appended order (Priority: P1)

**Goal**: The refused-then-keyed sequence stores the canonical plan, receipts first and directory last, with the done-step guard.

**Independent Test**: T1 drives the contract sequence with the connector absent, then retries with the connector present.

### Tests

- [x] T1 [US1] In its own commit, add one test in `harness/tests/erasure-request.test.ts`. Refuse a no-key erase on the contract's stored `requested` row. Then run a keyed erase with the connector absent. Assert the stored order equals the canonical plan, receipts first and directory last, and the status is `partial_failed`. Retry with the connector present. Assert status `completed`, the order still the canonical plan, and the run list `connector` then `directory`. `receipts`, `tombstone`, `scope:acme`, and `personal` stay `done` and are not run. Do not assert that a directory row is kept. This test fails on the parent. Covers FR-001, FR-003, SC-003.
- [x] T1b [US1] In its own commit, add one test that the first step that runs after Replace, on that same refused-then-keyed sequence, is `receipts`. This test fails on the parent. Covers FR-002, SC-003.
- [x] T2 [US1] In its own commit, add one test of the same flow with every performed step returning true. Assert the canonical plan and status `completed`. This test fails on the parent. Covers FR-003, SC-003.
- [x] T3 [US1] In its own commit, add one test of a `requested` row whose order is `directory` and whose mark for `directory` is `done`. The keyed erase of the canonical plan re-plans it. Assert `directory` is not run and stays `done`. Assert the run list is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`. Assert the stored order is `directory`, then those five steps. This test passes on the parent. It locks the directory-done prefix that `addSteps` already produced. Covers FR-002, SC-003.
- [x] T3b [US1] In its own commit, add one test of a `requested` row whose order is `receipts` then `directory`, with `receipts` done and `directory` pending. A keyed erase of the canonical plan keeps `receipts` done and does not run it. The stored order is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory`. The steps that run are those not-done steps in that order. This test fails on `eaa6bc525dbf53aa441d21ea876e767414d2f1d0` and passes on the head that contains the `:370` decision. Covers FR-002, SC-003.
- [x] T4 [US1] Lock. In its own commit, add one test over the T1 sequence. Any log line emitted by the re-plan contains a principal id, step names, and states only, and contains neither the pseudonym key, nor an email address, nor erased content. Leave the existing route audit that names the pseudonym unchanged and outside the assertion. Those log assertions pass before and after the green commit. The receipts-first assertion in this test is the check T1b owns. The test stays as written. Covers FR-009.
- [x] T5 [US2] In its own commit, add the absent-subject regression pin in `harness/tests/erasure-request.test.ts`. An absent subject gets the canonical plan, directory last, and no append. Mark the test as an unchanged invariant. It passes on the parent and stays passing. Covers FR-004, FR-007, SC-003.

### Implementation

- [x] T6 [US1] One commit edits only the `transitionErasure` request decision at `src/state/erasure-request.ts:358` and `:370`. Keep done steps ahead of the not-done steps, in their relative order, and do not run them. Place not-done steps after them, in canonical order. Do not edit `addSteps`. T1, T1b, T2, T4, and T5 pass on that commit. T3 already passed before it. T3b is the later test of this same decision. Covers FR-002, FR-003, FR-005.

**Checkpoint**: The stored status and order match the contract's Replace rows.

## Phase 3: User Story 2 - Keep the other erasure behavior (Priority: P2)

**Goal**: The absent-subject path stays the canonical plan. The missing-email and connector-false results stay as they are. No migration is added.

**Independent Test**: T5 passes on the parent and on the green head. Existing erasure tests still pass.

- [x] T008 [US2] Do not edit `recovered-source/worker/src/ops-rights.ts:188` or the `step_failed` result at `src/state/erasure-request.ts:412`, which returns `partial_failed` at line 413. The known difference stays the edge case in `spec.md` and needs its own backlog row. Do not add a migration. The persisted-row finding in `spec.md` stays the record: a stored directory-before-receipts row, if one exists outside tests, is re-planned by T6. Covers FR-004, FR-008, SC-004.
- [x] T009 [US2] Re-run the existing no-key tests in `harness/tests/erasure-request.test.ts` (the unusable-key ledger test and the `erase_disabled` route test). Both still pass. Diff the green commit against the unchanged transitions in `data-model.md`. No other erasure transition is in that diff. Covers FR-001, FR-004.

**Checkpoint**: The suite's previous erasure tests pass.

## Phase 4: Polish

- [x] T007 Run `npm test`, `npm run typecheck`, and `npm run typecheck:worker` on the behavior head. `npm test` passes, including T1, T1b, T2, T3, T3b, T4, and T5. Both typechecks report 0 errors. No CI file is added. Covers FR-006, SC-003.

## Phase 5: Keep an authorised pending step the current plan omits

**Goal**: A pending `scope:*` step that the second plan does not name stays in the order, runs, and directory stays last.

**Independent Test**: T010 stores the canonical plan for `acme` and `beta`, then runs a keyed erase whose plan names only `acme`.

- [x] T010 [US1] In its own commit, add one test in `harness/tests/erasure-request.test.ts`. The stored row is `requested`, its order is `erasurePlan(["acme", "beta"])`, every mark is `pending`, and the grant covers that order. The keyed erase uses the plan for `acme` only, and every performed step returns true. Assert `scope:beta` stays in the stored order among the scope steps, the run includes `scope:beta`, and `directory` is last. This test fails before T011 with an assertion. Covers FR-010.
- [x] T011 [US1] After T010 is red, one commit edits only the non-completed request decision at `src/state/erasure-request.ts:370-393`. Keep a pending stored step the current plan omits, placed with its kind. Do not edit `addSteps` or the completed-row path. T010 passes. Existing erasure tests still pass. Covers FR-010.

## Dependencies for N-1

- T011 depends on T010 being red. T010 depends on the head `6e9900e519ac4ed4725a6d2d2534cf01d4d4e882`.

## Dependencies

- T1, T1b, T2, T3, T3b, T4, and T5 depend on T000. Each test is its own commit. T3, T4, and T5 are locks. T4's log assertions pass on the parent. The receipts-first assertion in T4 is the check T1b owns.
- T6 depends on T1, T1b, T2, T3, T4, and T5. T3b is committed after T6 and fails on T6's parent. T1, T1b, and T2 are red before T6.
- T008 depends on T000 and records the out-of-scope difference. It does not wait on T6.
- T009 depends on T6.
- T007 depends on T6 and T009.

## Parallel example: locks on the parent

```text
T3 Directory-done lock, passes on the parent
T5 Absent-subject pin, passes on the parent
```

## Implementation strategy

T1, T1b, T2, and T3b each fail before the green commit. T3, T4, and T5 are locks. T4's log assertions pass before and after, and the receipts-first assertion in that test is the check T1b owns. The test stays as written. T6 is the one green commit. T3b is the later commit that locks a done step which was not already the prefix. These tasks are checked.
