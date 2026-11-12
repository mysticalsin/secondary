# Quickstart: Erasure partial-failed append

The behavior commits are on this branch.

## Current end, before the green commit

1. Start from a stored `requested` row whose order is `directory` and whose grant covers that step.
2. Refuse a no-key erase. The row is unchanged.
3. Run a keyed erase of the canonical plan.
4. Let the connector step return false. The stored status is `partial_failed` and the order is the appended order, directory before receipts.
5. Repeat with every step returning true. The stored status is `completed` and the order is that same appended order.

## Commits on this branch

1. Add T1, T1b, T2, T3, T3b, T4, and T5 in `harness/tests/erasure-request.test.ts`, one test concern per commit. T1, T1b, T2, and T3b fail before the green commit. T3 and T5 pass there. T4 is a lock of the log constraint. The receipts-first assertion in that test is the check T1b owns, and the test stays as written.
2. In one commit, edit only the `transitionErasure` request decision at `src/state/erasure-request.ts:358` and `:370` so the red tests pass. Leave `addSteps` as an append. T3b is the later test of that decision.
3. Run `npm test`, `npm run typecheck`, and `npm run typecheck:worker`. Existing erasure tests still pass. Both typechecks report 0 errors.

No CI config is added. No deploy. No migration.
