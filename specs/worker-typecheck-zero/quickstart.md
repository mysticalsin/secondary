# Quickstart: Worker typecheck zero

Validation for an independent QA session on the exact head. No implementation steps.

## Prerequisites

- Branch `cursor/state-machines-c94c`.
- The head under test is the commit the writer pushed. Do not move it.

## Baseline this spec was written against

Head `387f2c8b1662283ca74e657ec85f97068c011ab7`.

| Command | Expected at that head |
|---|---|
| `npm test` | 403 passed, 0 failed |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:worker` | 119 `error TS` lines: TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1 |

This spec commit does not change those counts.

## After each implementation commit

1. `git rev-parse HEAD` and `git rev-parse HEAD^`.
2. `npm run typecheck:worker`. Count `error TS` lines. The count is lower than the parent. Record the code breakdown.
3. `npm test`. Expect 403 passed and 0 failed, unless the commit is the red test for a logged mismatch and that is the only failure.
4. `npm run typecheck`. Expect exit 0.
5. For a promotion commit, `git rev-parse HEAD:<destination>` equals the blob in [contracts/promoted-modules.md](./contracts/promoted-modules.md).
6. `git grep -n reconstruction tsconfig.json tsconfig.worker.json` finds no path, include, or `preserveSymlinks` entry.
7. Confirm `harness/runtime/whole-api-causes.test.ts` is still absent, or byte-identical to the start if it was present.

## End state

- Worker typecheck exits 0.
- Each promoted path exists once.
- The Env finding list has names and mismatches only.
- No CI file was added unless Tony named it. If he did not, the writer report says the gate is not attached.
