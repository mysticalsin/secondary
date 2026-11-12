# Research: Erasure partial-failed append

## Decision: Replace with the done-step guard

**Decision**: Rewrite a non-completed request in the single `transitionErasure` decision at `src/state/erasure-request.ts:358` and `:370`. When no step is done and every pending stored step is already in the plan, the order is the canonical plan. A stored step that is not done, pending or failed, and that the current plan omits stays, placed with its kind, so a `scope:*` step sits among the scope steps, receipts stay first, and directory stays last. One not-done predicate does that keep. A failed step the plan omits is retried, and the erase does not end `completed` until that step succeeds. A step that is already done stays done, is not run, and keeps its place relative to other done steps. Done steps stay ahead of the not-done steps. Not-done steps are placed after them, in canonical order. `addSteps` keeps its one job of appending. The completed-row path may still call it. The grant widen at `:252-257` is unchanged, so the omitted step remains authorised.

**Rationale**: M-03. In parent `e268e6e2f0145579e50c89bc8dda0bab4e71b617` of `e9d50e61fd40887e9195ac62e71c98a327cf17dd`, `recovered-source/worker/src/ops-rights.ts:124-125` says the audit pass goes first, so a failed erase changes nothing else and can be asked for again, and every later step is idempotent. The canonical order is `erasurePlan` at `src/state/erasure-request.ts:260-268`. The appended order runs directory before receipts, which breaks M-03. Devin withdrew the resume-lookup reason.

**Alternatives considered**:

- Accept is rejected. It keeps directory before receipts and breaks M-03.
- Resume is rejected. It can end `completed` while data remains, which is a false erasure receipt.

## Decision: the absent subject is an unchanged pin

**Decision**: An absent subject gets the canonical plan, directory last, and no append. Both that path and Replace end in the same order when no step is already done. The pin is T5. It passes on the parent and stays passing.

**Rationale**: The backlog wording is the appended order. The absent path does not append. It is in scope only as a regression pin.

**Alternatives considered**: Editing the absent path. That path already matches the canonical plan.

## Decision: no data migration

**Decision**: Do not add a migration. If a directory-before-receipts row is already stored, the same `:358`/`:370` decision re-plans it.

**Rationale**: No migration inserts or rewrites an `erasure_requests` ledger. The table is created at `recovered-source/worker/src/tenant-policy.ts:207-209`. `seed` deletes those rows and does not insert a ledger. The production writers are `recordErasureGrant` (`tenant-policy.ts:1163-1178`) and the `runErasure` persist at `ops-rights.ts:210-218`. A first grant on an absent, unreadable, or uncovered row uses `requestedFrom` with the route's `erasurePlan`, so that stored order is the canonical plan. A directory-before-receipts order is persisted only when `runErasure` saves the `addSteps` result for a stored non-completed order that already lacked `receipts`. The predecessor in the reproduction is the test insert at `harness/tests/erasure-request.test.ts:1627`. No production writer and no migration creates that predecessor from an absent subject. A direct database write is outside the threat model in `docs/state-machines.md`. No live data was read.

**Alternatives considered**: A migration that rewrites stored orders. Out of scope.

## Decision: the connector difference stays

**Decision**: Write the difference. Change no behavior. It needs its own backlog row.

**Rationale**: The removed machine table said a missing email skips the connector and still erases the directory. Today a missing email at `ops-rights.ts:188` returns true, so directory still runs. A connector step that returns false is `step_failed` at `erasure-request.ts:413`, the return at line 414 sets `partial_failed`, and directory does not run in that attempt.

**Alternatives considered**: Restoring the old table's "still erase the directory" result after a false connector. That is a different item.

## Findings

Parent commit `565bff6a2ba3153f11347482cdee3555b257f87f`.

A pure run of `erasureWithGrant` then `runErasure` on a `requested` row whose order is `directory` and whose grant covers `directory`:

- After the grant helper, the order is still `["directory"]` and the grant steps are the canonical plan.
- The request persists order `["directory","receipts","tombstone","scope:acme","personal","connector"]` while the status is still `requested`.
- The runner continues from the first step that is not done, in that appended order. The first step that runs is `directory`.
- The connector step returning false ends `partial_failed` with `connector` marked `failed` and that appended order.
- Every step returning true ends `completed` with that same appended order.
- An absent start with the connector step returning false ends `partial_failed` with order `["receipts","tombstone","scope:acme","personal","connector","directory"]`.

The no-key refusal does not call the runner. `ops-admin.ts:180` returns before quorum. `ops-rights.ts:153` returns before `applyLedger`. The stored step stays `pending`.

The false connector step is `ops-rights.ts:187` when `emailOfPrincipal` (`tenant-policy.ts:1085`) returns an email and `forgetSourceAccess` (`connector.ts:222`) returns false because the connector is absent. Any other step that returns false uses the same `step_failed` rule at `erasure-request.ts:413`, which sets `partial_failed` at line 414.
