# Feature Specification: Erasure partial-failed append

**Feature Branch**: `cursor/erasure-partial-failed-append-7e21`

**Created**: 2026-11-12

**Status**: Implemented

**Input**: Backlog SB-ERASURE-PARTIAL-FAILED-APPEND. After a no-key erasure is refused and a later keyed erase runs, the erasure request can end as `partial_failed` with the canonical plan appended. Devin's ruling is Replace with a done-step guard. It rests on M-03.

## Clarifications

### Session 2026-11-12

- Q: Which terminal state and order are required when a no-key refusal leaves a stored non-completed order and a later keyed erase runs the canonical plan? → A: Replace, with the done-step guard. Devin, 2026-11-12, after withdrawing the resume-lookup reason. The reason is M-03. In the parent of `e9d50e61fd40887e9195ac62e71c98a327cf17dd`, commit `e268e6e2f0145579e50c89bc8dda0bab4e71b617`, `recovered-source/worker/src/ops-rights.ts:124-125` says the audit pass goes first, so a failed erase changes nothing else and can be asked for again, and every later step is idempotent. The canonical order is `erasurePlan` at `src/state/erasure-request.ts:260-268`: receipts, the tombstone, each company scope, the personal brain, the connector, then the directory. The defect is the appended order, which runs directory before receipts and breaks M-03. Accept is rejected because it breaks M-03 by running directory before receipts. Resume is rejected because it can end `completed` while data remains, which is a false erasure receipt.
- Q: Is an absent subject in this item? → A: In scope as a regression pin only. The invariant is unchanged. An absent subject gets the canonical plan, directory last, and no append. That path and the Replace path end in the same order when no step is already done.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Replace the appended order (Priority: P1)

A configure holder asks to erase a person while the pseudonym key is missing, empty, or shorter than 32 characters. That ask is refused and the stored erasure request is unchanged. A later erase of the same person, with a usable key, rewrites a non-completed order. When no step is done, the stored order is the canonical plan, receipts run first, and directory is last. A step that returns false ends `partial_failed`. Every performed step returning true ends `completed`. A step already marked done stays done and is not run again.

**Why this priority**: The appended order runs directory before receipts. M-03 says the audit pass goes first so a failed erase changes nothing else.

**Independent Test**: Refuse a no-key erase on a stored `requested` row whose only step is `directory` and whose grant covers that step. Then run a keyed erase. With the connector absent, the order equals the canonical plan and the status is `partial_failed`. A retry with the connector present ends `completed`. The first step that runs is `receipts`.

**Acceptance Scenarios**:

1. **Given** a stored `requested` row whose order is `directory` and whose grant covers that step, **When** a no-key erase is refused, **Then** the stored status, order, marks, and grant are unchanged and nothing is deleted.
2. **Given** that same row, **When** a keyed erase runs and the connector step returns false, **Then** the stored order is the canonical plan, `receipts` is the first step that runs, directory is last, and the status is `partial_failed`.
3. **Given** that `partial_failed` row, **When** the same erase is retried and the connector step returns true, **Then** the status is `completed`, the order is still the canonical plan, the steps that run are `connector` then `directory`, and `receipts`, `tombstone`, `scope:acme`, and `personal` stay done.
4. **Given** that same starting row, **When** every performed step returns true, **Then** the order is the canonical plan and the status is `completed`.
5. **Given** a `requested` row whose only step is `directory` and that step is marked done, **When** a keyed erase of the canonical plan runs, **Then** `directory` is not run and stays done, the steps that run are `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, and the stored order is `directory` followed by those five steps. This case already held before the green commit.
6. **Given** a `requested` row whose order is `receipts` then `directory`, with `receipts` done and `directory` pending, **When** a keyed erase of the canonical plan runs and every performed step returns true, **Then** `receipts` stays done and is not run, the stored order is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory`, and the steps that run are those five not-done steps in that order.

---

### User Story 2 - Keep the other erasure behavior (Priority: P2)

The absent-subject path, the completed-row rule, unreadable rows, quorum, tombstones, receipt scans, and restore re-apply stay as they are. A missing email still skips the connector call and still erases the directory. A connector step that returns false still stops the attempt at `partial_failed`.

**Why this priority**: Replace is one decision in the request branch. The other transitions are not this backlog item.

**Independent Test**: The absent-subject pin passes on `565bff6a2ba3153f11347482cdee3555b257f87f` and still passes after the request-branch edit. The existing erasure tests still pass.

**Acceptance Scenarios**:

1. **Given** no stored erasure for the person, **When** a keyed erase runs and one step returns false, **Then** the order is the canonical plan, directory last, with no append onto a previous order.
2. **Given** the erasure suite on the parent, **When** the new tests are the only additions, **Then** every previously passing erasure test still passes.

---

### Edge Cases

- No step is done in the refused-no-key case, and the stored step is already in the plan, so Replace stores exactly the canonical plan.
- A pending stored `scope:*` step that the current plan omits stays among the scope steps. Receipts stay first and directory stays last.
- A done step keeps its mark. Done steps keep their relative order and stay ahead of the not-done steps. A done step is not run. Not-done steps are placed after the done steps, in canonical order.
- `addSteps` still only appends. The completed-row path may still call it. The non-completed request path does not use it to build this plan.
- The removed machine table said a missing email skips the connector and still erases the directory. Today a missing email at `recovered-source/worker/src/ops-rights.ts:188` returns true, so directory still runs. A connector step that returns false is `step_failed` at `src/state/erasure-request.ts:399`, the status is `partial_failed`, and directory does not run in that attempt. That difference is unchanged and out of scope. It needs its own backlog row.
- Independent QA confirmed the reproduction, and the behavior commits are on this branch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A no-key erase is refused before any delete and before any erasure-ledger write. A stored request stays as it was. An absent subject stays absent.
- **FR-002**: A keyed erase of the canonical plan on a non-completed row rewrites the order in the single `transitionErasure` request decision at `src/state/erasure-request.ts:358` and `:370`. When no step is done and every pending stored step is already in that plan, the order becomes the canonical plan at `erasurePlan` (`src/state/erasure-request.ts:260-268`), receipts first and directory last. The grant widen at `erasure-request.ts:252-257` stays as it is. A step already marked done stays done and is not run. Done steps keep their relative order and stay ahead of the not-done steps. Not-done steps are placed after them, in canonical order. `addSteps` keeps the one job of appending and is not given a second ordering pass.
- **FR-010**: A pending stored step that the current plan omits stays in the order, placed with its kind, so a `scope:*` step sits among the scope steps, receipts stay first, and directory stays last. The grant widen at `erasure-request.ts:252-257` is unchanged, so that step remains authorised. Done steps and the completed-row `addSteps` path stay unchanged.
- **FR-003**: A performed step that returns false ends `partial_failed`. Every performed step returning true ends `completed`. Those two outcomes stay as they are.
- **FR-004**: No other erasure transition changes. The completed-row rule, a `request` on an unreadable row or an empty order, quorum, tombstones, receipt scans, restore re-apply, and the missing-email and connector-false results in the edge case stay as they are on `565bff6a2ba3153f11347482cdee3555b257f87f`.
- **FR-005**: The behavior commits are red tests first, one test concern per commit, then one green commit that edits only the `:358`/`:370` decision. The tests are T1, T1b, T2, T3, T3b, T4, and T5 in `tasks.md`. T1, T1b, T2, and T3b fail before that green commit. T3 and T5 pass before it and still pass after it. T4 is a lock. Its log assertions pass before and after that commit. The receipts-first assertion in T4 is the check T1b owns, and the test stays as written.
- **FR-006**: This feature adds no CI config, no deploy, and no package.
- **FR-007**: An absent subject is a regression pin. The keyed erase stores the canonical plan, directory last, and does not append. When no step is already done, that order and the Replace order are the same.
- **FR-008**: No data migration. A directory-before-receipts row is not created by a migration or by the first keyed erase of an absent subject. If such a row is already stored, the same `:358`/`:370` decision re-plans it.
- **FR-009**: A log line emitted by the re-plan contains a principal id, step names, and states only. It does not contain the pseudonym key, an email address, or erased content. No such line is required. The existing route audit that names the pseudonym stays as it is and is outside this check.

### Key Entities

- **Erasure request**: One stored request per person. Status, order, a mark per step, and a grant. Status words include `requested`, `running`, `completed`, and `partial_failed`.
- **Canonical plan**: The array returned by `erasurePlan`. For the reproduced organisation it is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory`. Canonical order means the sequence of this array.
- **Appended order**: The stored order, then each canonical step that was not already in it. On a `directory`-only row this puts directory before receipts. That is the defect.
- **No-key erase**: The pseudonym key is missing, empty, or shorter than 32 characters.
- **Keyed erase**: The pseudonym key is present and at least 32 characters, and the erase runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can follow the observed path and see the appended order run directory before receipts. The M-03 citation is the parent of `e9d50e61` at `ops-rights.ts:124-125`. The canonical order citation is `erasure-request.ts:260-268`.
- **SC-002**: Clarifications names Replace and records the Accept and Resume rejections in the words above.
- **SC-003**: T1, T1b, T2, and T3b fail before the green commit and pass after it. T3 and T5 pass before that commit and on the green head. T4 is a lock: its log assertions pass before and after, and the receipts-first assertion in that test is the check T1b owns. T3b fails on `eaa6bc525dbf53aa441d21ea876e767414d2f1d0` and passes once the `:370` decision is present. Existing erasure tests still pass. Root typecheck and worker typecheck report 0 errors.
- **SC-004**: The spec states the persisted-row finding below. No migration file is added.

## Assumptions

- The reproduced predecessor is a `requested` row with order `directory`, mark `pending`, and a grant that covers that step. The no-key refusal does not write that row. The test inserts it.
- A connector step returns false when the person has an email and the connector is not configured (`ops-rights.ts:187-190`, `connector.ts:222`). Any other step that returns false uses the same `partial_failed` rule.
- Secret values are not copied into this spec. The pseudonym key is described only as missing, empty, short, or usable.
- The behavior commits are on this branch. T3 is a lock. T4 is a lock of the log constraint. The receipts-first assertion in T4 is the check T1b owns, and the test stays as written.

## Observed path

This is the behavior on `565bff6a2ba3153f11347482cdee3555b257f87f`. Replace changes the order decision. It does not change the no-key refusal.

1. `recovered-source/worker/src/ops-admin.ts:179` reads the pseudonym key. Line 180 returns `erase_disabled` when the key is refused, before quorum and before `eraseSubject`.
2. `recovered-source/worker/src/ops-rights.ts:152` checks the key again inside `runErasure`. Line 153 returns the refusal before the ledger runner. A stored `directory` step stays `pending`. The test at `harness/tests/erasure-request.test.ts:1615` locks that. An absent subject stays absent. The test at line 1809 locks that.
3. The later keyed erase builds the plan at `ops-admin.ts:186`. The stored grant does not cover that plan, so `ops-admin.ts:189` does not take the already-granted path. Quorum runs at lines 193–203. The confirming write is `tenant-policy.ts:1172`, which calls `erasureWithGrant`.
4. `src/state/erasure-request.ts:252` keeps a grant that already covers the stored order. Lines 256–257 widen the grant's step list and leave the order as `directory`.
5. `eraseSubject` at `ops-rights.ts:235` sends a `request` whose steps are the canonical plan.
6. `transitionErasure` at `erasure-request.ts:358` does not replace a `requested` row with a non-empty order. Line 370 appends through `addSteps` at lines 325–333. The persisted order is `directory`, then `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`.
7. `runErasure` at `erasure-request.ts:411` continues from the first step that is not done. The first step that runs is `directory`, which breaks M-03.
8. `ops-rights.ts:187` asks the connector when `tenant-policy.ts:1085` has an email. `connector.ts:222` returns false when the connector is absent. `erasure-request.ts:399` sets `partial_failed`.
9. A run of those functions with the connector step returning false ended `partial_failed` and order `["directory","receipts","tombstone","scope:acme","personal","connector"]`. Every step returning true ended `completed` with that same order. An absent start ended `partial_failed` with the canonical plan, directory last.

## Persisted rows

No migration inserts or rewrites an `erasure_requests` ledger. The table is created at `recovered-source/worker/src/tenant-policy.ts:207-209`. `seed` deletes those rows and does not insert a ledger.

The production writers are `recordErasureGrant` (`tenant-policy.ts:1163-1178`) and the `runErasure` persist at `ops-rights.ts:210-218`. A first grant on an absent, unreadable, or uncovered row uses `requestedFrom` with the route's `erasurePlan`, so that stored order is the canonical plan. `eraseSubject` on an absent subject does the same.

A directory-before-receipts order is persisted only when `runErasure` saves the `addSteps` result for a stored non-completed order that already lacked `receipts`. The predecessor used in the reproduction is inserted by the test at `harness/tests/erasure-request.test.ts:1627`. No production writer and no migration creates that predecessor from an absent subject. A direct database write is outside the threat model stated in `docs/state-machines.md`.

If a directory-before-receipts row is already stored, the next keyed request re-plans it through the same `:358`/`:370` decision. Data migration is out of scope.

## M-03 citation

Parent `e268e6e2f0145579e50c89bc8dda0bab4e71b617` of `e9d50e61fd40887e9195ac62e71c98a327cf17dd`, file `recovered-source/worker/src/ops-rights.ts:124-125`:

> The audit pass goes first (M-03): if it cannot finish, nothing else has changed and the whole erase can be asked for again. Every later step is idempotent.

`erasePrincipal` is the last call in that function, at line 156 of the same parent. The current canonical list is `src/state/erasure-request.ts:260-268`.
