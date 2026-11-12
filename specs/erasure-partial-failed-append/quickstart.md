# Quickstart: Erasure partial-failed append

Docs only until independent QA confirms the Observed path in `spec.md` and the user says to start. Do not edit `src/`, `recovered-source/`, or `harness/` before that.

## Current end, before the green commit

1. Start from a stored `requested` row whose order is `directory` and whose grant covers that step.
2. Refuse a no-key erase. The row is unchanged.
3. Run a keyed erase of the canonical plan.
4. Let the connector step return false. The stored status is `partial_failed` and the order is the appended order, directory before receipts.
5. Repeat with every step returning true. The stored status is `completed` and the order is that same appended order.

## After the user says to start

1. Add T1, T1b, T2, T3, T4, and T5 in `harness/tests/erasure-request.test.ts`, one test concern per commit. T1, T1b, T2, and T3 fail on `565bff6a2ba3153f11347482cdee3555b257f87f`. T4 and T5 pass there.
2. In one later commit, edit only the `transitionErasure` request decision at `src/state/erasure-request.ts:358` and `:370` so those four tests pass. Leave `addSteps` as an append.
3. Run `npm test`, `npm run typecheck`, and `npm run typecheck:worker`. Existing erasure tests still pass. Both typechecks report 0 errors.

No CI config is added. No deploy. No migration.
