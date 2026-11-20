# Plan 020 — Erasure ledger repair

Status: OPEN. Plan and red tests only. No production change in this commit.

Risk: HIGH. This touches data-rights erasure. The plan debate runs before any implementation.

Parent: `da3ac9c54a44f4ee249d5a32fecdac00a4a738eb` (tree `916778a48bbbac1b0fa9526826f9b057634859cb`).

## Ticket

Done when:

- [ ] One badly named company scope still blocks the tenant erase. The 422 body is `{ error: "invalid_scope", scopes: <count> }` and contains no scope id. The runbook line below is in `docs/state-machines.md`. No ledger row is written.
- [ ] One exported grammar. The pin test sees that character class once.
- [ ] A request that carries a step `transitionErasure` cannot place is `unknown_step`. The stored order is not shortened.
- [ ] A grant whose steps are not all plan steps does not replace the existing value, and `recordErasureGrant` does not write it.
- [ ] `reportUnreadableLedgers` counts unreadable rows, returns their principal ids, and writes nothing. No migration and no deletion in this pull request unless the debate approves a later repair.
- [ ] New tests each open a fresh sqlite file and a fresh principal.

## What was checked

L-1 is still open. `erasurePlan` throws `invalid_scope` when any company scope fails `SCOPE_ID` (`src/state/erasure-request.ts`). `POST /v1/admin/rights/erase` catches that and returns `{ error: "invalid_scope" }` with 422 (`src/worker/ops-admin.ts`). There is no runbook file. The red test gets 422 and then `undefined !== 1` for the missing count. The route still writes no row.

N-1 is still open. The character class `[a-z0-9][A-Za-z0-9_.:@-]{0,127}` is written in `SCOPE_ID`, again inside `scopeIdOfStep`, and again in `src/worker/ops-internal.ts`. The pin counts 3.

N-2 is dropped. Evidence: `harness/tests/erasure-request.test.ts` test `a non-conforming restore scope is skipped instead of treated as done` calls `reapplyErasures` with scope `bad id` and expects `skipped: [subject-1]`. `src/worker/ops-internal.ts` `target` rejects that scope before `reapplyErasures`, and the restore route returns 400 `invalid_target`. The defence stays.

N-3 is still open. `decodeErasure` returns unreadable for `scope:C_x` (the red report test asserts that before it fails). `transitionErasure` on an in-progress ledger filters with `place(id) < 6`, so `scope:C_x` is dropped and the transition stays `ok: true` (`true !== false`).

R-1 is still open. No existing test calls `erasureWithGrant` with a bad step. On an unreadable row it returns a new unreadable object, and `recordErasureGrant` saves it. The sqlite status changes from `requested` to `unreadable`.

The per-principal view cache is `CACHE` in `packages/policy/src/engine.ts`, a `WeakMap` from the org object to a map keyed by principal id, roles, memberships, and grants. A reused principal against a mutated org can hide a change. This plan does not change that cache. Each new scenario uses its own org object, its own sqlite `TenantPolicy`, and its own principal (`p-l1`, `ada-l1`, `p-grant`, `p-r1`, `p-legacy`).

Sentinel R-2 and R-3 stay out of this ticket.

## Decision record draft

Not an agreement. The debate can strike any line.

1. L-1. Proposed: keep the tenant-wide refuse. Add the count to the 422 body and do not include scope ids. Add this runbook line to the erasure section of `docs/state-machines.md`: "If erase returns 422 invalid_scope, the scopes count is how many company scope ids fail the grammar. The body does not name them. Rename those ids before erasing. Do not drop the bad scope and continue." Alternative, if the debate wants no response change: keep `{ error: "invalid_scope" }` and add only the runbook line. Then delete the count assertion before implementation. Refuse-not-drop stays either way.
2. N-1. Export one grammar from `src/state/erasure-request.ts`. `scopeIdOfStep` and `src/worker/ops-internal.ts` use that export. No second literal.
3. N-3. `transitionErasure` returns `unknown_step` when a pending step has no place. It does not build a shorter order. Legacy rows that decode as unreadable stay unread until a read-only report lists them. The report returns `{ unreadable, principalIds }` and does not echo ledger text. No deletion. No migration in this pull request unless the debate approves one after the report.
4. R-1. When any approved step is not a plan step, `erasureWithGrant` returns the same object it was given. `recordErasureGrant` already skips a write when `next === existing`, so the stored ledger stays.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "ledger repair" harness/tests/erasure-ledger-repair.test.ts
```

Exit 1. 0 pass, 6 fail. `duration_ms` 350.717473.

```
✖ ledger repair: the erase route counts rejected company scopes and leaks no ids
  undefined !== 1

✖ ledger repair: one scope grammar is exported and the other copies are gone
  3 !== 1

✖ ledger repair: a request refuses a pending step the grammar does not place
  true !== false

✖ ledger repair: erasureWithGrant keeps the existing row when a step is not a plan step
  not reference-equal
  actual and expected both { status: { tag: 'unreadable' }, order: [], mark: {}, grant: null, receipts: null }

✖ ledger repair: a bad grant step is not written over the stored ledger
  actual: 'unreadable'
  expected: 'requested'

✖ ledger repair: a read-only report counts an unreadable legacy ledger and does not write
  actual: 'undefined'
  expected: 'function'
```

`npm test` on this tree: exit 1. 702 tests, 696 pass, 6 fail, 0 skipped. `duration_ms` 14413.920484, wall 14.54s. The 6 failures are these tests. `npm run typecheck` exit 0, wall 4.83s. `npm run typecheck:worker` exit 0, wall 5.14s.

## Mutants

Today's code is the red case. After a fix, each of these edits fails the named test again. None of them is applied in this commit.

| Mutant | Edit | Red assertion |
| --- | --- | --- |
| count-omitted | 422 body stays `{ error: "invalid_scope" }` | `undefined !== 1` |
| second-grammar | a second copy of the character class in `ops-internal.ts` | `3 !== 1`, or `2 !== 1` after the first fix |
| inline-step | `scopeIdOfStep` keeps its own regex | the same pin |
| filter-place-6 | `pending` stays `place(id) < 6` | `true !== false` |
| replace-grant | `erasureWithGrant` returns a new unreadable object | not reference-equal |
| persist-unreadable | `recordErasureGrant` saves that object | `'unreadable' !== 'requested'` |
| no-report | `reportUnreadableLedgers` is absent | `'undefined' !== 'function'` |

## Rollback

Ordinary revert of this branch onto main `da3ac9c54a44f4ee249d5a32fecdac00a4a738eb`. This commit has no migration and deletes no row, so the revert has no data step. If a later debate approves a migration, the rollback is rewritten before that code is committed.

## Unslop

| Before | After | Kept |
| --- | --- | --- |
| 422 body is `{ error: "invalid_scope" }` and names no count | Proposed body adds `scopes` and still names no id | Tenant-wide refuse. No ledger row. No dropped scope |
| The grammar literal is in three places | One export, and the pin fails if a second copy returns | The same character class. `scope:C_x` stays unreadable |
| `place(id) < 6` drops a pending step and returns ok | The request is `unknown_step` and the order stays | `decodeErasure` fails closed. No rewrite on load |
| A bad grant step is saved as `unreadable` over the row | The existing object is returned and the sqlite row stays | `next === existing` already means do not write |
| No read-only list of unreadable ledgers | A report counts them and returns principal ids | No deletion. No migration unless the debate approves one |
| N-2 skip path had no direct caller in the old review | Already called by the existing test | The HTTP route still returns 400 `invalid_target` first |
