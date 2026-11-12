# Quickstart: Erasure partial-failed append

Spec phase only. Do not edit `src/`, `recovered-source/`, or `harness/` until Clarifications names one option.

## Reproduce the current end

1. Start from a stored `requested` row whose order is `directory` and whose grant covers that step.
2. Refuse a no-key erase. The row is unchanged.
3. Run a keyed erase of the full plan.
4. Let the connector step return false. The stored status is `partial_failed` and the order is `directory` plus the other plan steps.
5. Repeat with every step returning true. The stored status is `completed` and the order is that same appended list.

The file:line path is the Observed path in `spec.md`.

## After an option is named

1. Add one test in `harness/tests/erasure-request.test.ts` for steps 1–5.
2. If the named option is not today's pair, the test fails on `565bff6a2ba3153f11347482cdee3555b257f87f` before a production edit.
3. If the named option is today's pair, the test passes there and `src/` and `recovered-source/` stay unchanged.
4. Run `npm test`, `npm run typecheck`, and `npm run typecheck:worker`. Existing erasure tests still pass. Both typechecks report 0 errors.

No CI config is added. No deploy.
