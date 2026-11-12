# Feature Specification: Erasure partial-failed append

**Feature Branch**: `cursor/erasure-partial-failed-append-7e21`

**Created**: 2026-11-12

**Status**: Draft

**Input**: Backlog SB-ERASURE-PARTIAL-FAILED-APPEND. After a no-key erasure is refused and a later keyed erase runs, the erasure request can end as `partial_failed` with the full plan appended. That path is fixed or explicitly accepted. No other erasure transition changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lock the refused-then-keyed outcome (Priority: P1)

A configure holder asks to erase a person while the pseudonym key is missing, empty, or shorter than 32 characters. That ask is refused and the stored erasure request is unchanged. A later erase of the same person, with a usable key, runs the current full plan against that stored request. The request's terminal status and step order are whatever option Devin or Tony names. This spec does not name one.

**Why this priority**: The backlog item is this one sequence. The terminal status and the order are a product decision.

**Independent Test**: Drive the reproduced sequence. A missing key leaves the stored request byte-for-byte. The later keyed erase ends in the named option's status and order. Until an option is named, no behavior file changes.

**Acceptance Scenarios**:

1. **Given** a stored non-completed erasure whose order is non-empty and whose grant covers that order, **When** a no-key erase is refused, **Then** the stored status, order, marks, and grant are unchanged and nothing is deleted.
2. **Given** that same stored request and a later keyed erase whose plan contains steps the stored order does not, **When** a performed step returns false, **Then** the terminal status and order equal the named option. The option is not named in this draft.
3. **Given** the same stored request and the same keyed erase, **When** every performed step returns true, **Then** the terminal status and order equal the same named option's success pair.

---

### User Story 2 - Leave every other erasure transition (Priority: P2)

Resumes, restores, completed-row additions, unreadable rows, quorum, tombstones, and receipt scans keep the behavior they have on `565bff6a2ba3153f11347482cdee3555b257f87f`.

**Why this priority**: The backlog item is one path. A fix that retunes another transition is out of scope.

**Independent Test**: The existing erasure tests stay as they are, apart from the one new test for this sequence.

**Acceptance Scenarios**:

1. **Given** the erasure suite on this branch's parent, **When** this feature's test is the only addition, **Then** every previously passing erasure test still passes.

---

### Edge Cases

- An absent subject has no stored order. A no-key refusal writes nothing. A later keyed erase creates the canonical plan rather than appending. Whether that path is in this item is an open question.
- A stored completed request already adds only the missing steps. This feature does not change that rule.
- A stored unreadable request already starts a fresh plan. This feature does not change that rule.
- The no-key refusal is a missing, empty, or short pseudonym key. A present key of at least 32 characters is the keyed erase.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A no-key erase is refused before any delete and before any erasure-ledger write. A stored request stays as it was. An absent subject stays absent.
- **FR-002**: The required terminal status and order for the later keyed erase are [NEEDS CLARIFICATION: which option — Accept the appended order, Replace with the canonical plan, or Resume the stored order only]. No behavior file changes while that option is unnamed.
- **FR-003**: The named option applies to both ends of the same keyed erase: a performed step that returns false, and every performed step returning true.
- **FR-004**: No other erasure transition changes. The completed-row rule, the unreadable fresh plan, quorum, tombstones, receipt scans, and restore re-apply stay as they are on `565bff6a2ba3153f11347482cdee3555b257f87f`.
- **FR-005**: After an option is named, the first behavior change is one test of this sequence. If the named option is not today's outcome, that test fails before any production edit. If the named option is today's outcome, the test locks that outcome and no production file changes.
- **FR-006**: The spec phase adds no CI config, no deploy, and no package.

### Key Entities

- **Erasure request**: One stored request per person. It has a status, an ordered step list, a mark per step, and a grant. Status words include `requested`, `running`, `completed`, and `partial_failed`.
- **Full plan**: Receipts, the tombstone, each company scope, the personal brain, the connector, then the directory.
- **Appended order**: The stored order, followed by each full-plan step that was not already in it.
- **No-key erase**: The pseudonym key is missing, empty, or shorter than 32 characters. The ask is refused.
- **Keyed erase**: The pseudonym key is present and at least 32 characters, and the erase runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can follow the reproduction path and see a refused no-key erase leave a stored request unchanged, then a keyed erase persist `partial_failed` with the appended order when one performed step returns false.
- **SC-002**: Before any file under `src/`, `recovered-source/`, or `harness/` changes, the Clarifications section names exactly one of the three options. This draft names none.
- **SC-003**: The one new test asserts the named option's status and order for the false-step end and the all-success end. Existing erasure tests still pass. Root typecheck and worker typecheck stay at 0 errors.

## Assumptions

- The sequence in this item starts from a stored non-completed order. The reproduced row is `requested` with order `directory` and a grant that covers that order.
- "Can end as `partial_failed`" is the false-step end. The same append ends `completed` when every step returns true. Both ends belong to one option.
- The connector step is a concrete step that returns false when the person has an email and the connector is not configured. Any other step that returns false reaches the same status rule.
- Secret values are not copied into this spec. The pseudonym key is described only as missing, empty, short, or usable.

## Observed path

This is the behavior on `565bff6a2ba3153f11347482cdee3555b257f87f`. It is not the required end state.

1. `recovered-source/worker/src/ops-admin.ts:179` reads the pseudonym key. Line 180 returns `erase_disabled` when the key is refused, before quorum and before `eraseSubject`.
2. `recovered-source/worker/src/ops-rights.ts:152` checks the key again inside `runErasure`. Line 153 returns the refusal before the ledger runner. A stored `directory` step stays `pending`. The existing test at `harness/tests/erasure-request.test.ts:1615` locks that. An absent subject stays absent. The test at line 1809 locks that.
3. The later keyed erase builds the full plan at `ops-admin.ts:186`. The stored grant does not cover that plan, so `ops-admin.ts:189` is not a resume. Quorum runs at lines 193–203. The confirming write is `tenant-policy.ts:1172`, which calls `erasureWithGrant`.
4. `src/state/erasure-request.ts:252` keeps a grant that already covers the stored order. Lines 256–257 widen the grant's step list and leave the order as `directory`.
5. `eraseSubject` at `ops-rights.ts:235` sends a `request` whose steps are the full plan.
6. `transitionErasure` at `erasure-request.ts:358` does not replace a `requested` row with a non-empty order. Line 370 appends through `addSteps` at lines 325–333. The persisted order is `directory`, then `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`. The status is still `requested`.
7. `runErasure` at `erasure-request.ts:411` resumes because that request has no run effect and the status is not `completed`.
8. Steps run in the appended order. `ops-rights.ts:187` asks the connector when the person has an email (`tenant-policy.ts:1085`). `connector.ts:222` returns false when the connector is absent. `erasure-request.ts:389` then sets `partial_failed` and marks `connector` failed.
9. A run of the same functions with the connector step returning false ended `partial_failed` and order `["directory","receipts","tombstone","scope:acme","personal","connector"]`. The same run with every step returning true ended `completed` with that same order. An absent start ended `partial_failed` with the canonical plan order, directory last. That absent path is not an append.
