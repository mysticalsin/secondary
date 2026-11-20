# Plan 020 — Erasure ledger repair

Status: OPEN. No agreement is recorded on this head.

Risk: HIGH. This touches data-rights erasure.

Parent of the branch: `da3ac9c54a44f4ee249d5a32fecdac00a4a738eb` (tree `916778a48bbbac1b0fa9526826f9b057634859cb`). This delta is on top of `7437b0b2a939dd5bb0c26b9fdd1e93d5343c7d97`.

## CONSENSUS

No agreement is recorded on this head. Loop 1 at `2fa36386` was Devin CONDITIONAL (`cf034c6b`) and Sentinel with C-1 to C-6 (`d3396517`). Loop 2 at `7437b0b2` asked for the report assertions below. The next debate binds to this head.

## Ticket

Done when:

- [ ] L-1 option (1). Two rejected company scopes produce exactly `{ error: "invalid_scope", scopes: 2 }`. Logs, headers, and audit reasons do not contain `SENTINEL_SCOPE_A` or `SENTINEL_SCOPE_B`. A consultant gets 403 and the body has no count. The runbook line is in the erasure section of `docs/state-machines.md`: "If erase returns 422 invalid_scope, scopes is how many company scope ids fail the grammar. The body does not name them. Rename those ids before erasing. Do not drop the bad scope and continue." The implementation commit updates `erase route refuses a company scope the grammar rejects before it stores` to that exact body. This commit does not.
- [ ] `export const SCOPE_ID` lives only in `src/state/erasure-request.ts`. `scopeIdOfStep` calls it. `src/worker/ops-internal.ts` imports `{ SCOPE_ID }` from `../state/erasure-request.ts`. A second literal of the character class fails the pin.
- [ ] A request carrying `scope:C_x` and `not-a-step` is `unknown_step`. The same refusal holds for a completed ledger (`addSteps`) and for a direct `restore` (`reopen`).
- [ ] A readable grant does not gain `scope:C_x` or `not-a-step`. The call does not mutate the existing steps. `requestSecond` on that bad grant returns `refused` or throws inside the transaction, so the pending row stays and the ledger bytes stay.
- [ ] `reportUnreadableLedgers` defaults to `{ unreadable, principalIds: <count>, truncated }`. `{ includeIds: true, cap }` may return ids, including `['p-legacy']`, and sets `truncated` when the cap cuts the list. `GET /v1/admin/rights/erasure-ledgers?limit=1` is configure-only, writes a counts-only audit receipt, and does not change file mtimes or sha256 hashes in the ledger directory.
- [ ] Legacy ledgers are never migrated and never deleted. A report is the only new read.

## Build gates

- C-1. The 422 body is exactly `{ error, scopes: int }`. Keys are `error` and `scopes`. A caller without configure gets 403 and no count.
- C-2. No scope id in a log line, a response header, or an audit reason. The erase test searches for `SENTINEL_SCOPE_A` and `SENTINEL_SCOPE_B`. That search passed on this tree. The body assertion is the remaining red.
- C-3. A refused grant must not spend the second approval and must not return `confirmed` (`tenant-policy.ts` around the delete at 999–1030). Throw inside the transaction, or return `refused` before the delete. The storage test expects `refused`, then the pending requester `ada`, then the original ledger bytes.
- C-4. The merge branch of `erasureWithGrant` (`erasure-request.ts` 266–268) validates every step. The healthy-ledger test starts from `receipts` and `personal` and rejects `scope:C_x` and `not-a-step`. It compares the existing steps before and after, so an in-place mutation that returns the same object does not pass.
- C-5. `addSteps` and `reopen` refuse instead of skipping (`erasure-request.ts` 343 and 354). A completed ledger plus a bad step is not `ok: true` (383–384). The grammar pin is an import check plus one literal in `src/`, not a count by itself.
- C-6. The report has an admin-only caller, a `limit`, an id cap, `truncated`, a counts-only audit receipt, and a directory mtime plus sha256 comparison. The default `principalIds` is a count. `includeIds` returns `['p-legacy']`. A caller without configure gets 403 and an empty body. Every report value is checked for `C_x`.

## N-2

Not dropped. These three tests pass on the current code:

- A signed workspace restore of `bad id` and of `C_x` returns 400 `{ error: "invalid_target" }`. `importAll` stays 0. The mtime and sha256 of every file in the ledger directory stay the same.
- `reapplyErasures` with `bad id` returns `skipped: ["p-reapply"]`, leaves the mark bytes unchanged, and imports no snapshot.
- A consultant erase is 403 and the body has no `scopes` count.

A tenant restore ignores the scope query. `stepsForRestore` returns `["directory"]` when `kind` is `tenant`. The only production caller of `reapplyErasures` is the signed restore route in `src/worker/ops-internal.ts`. There is no CLI path and no cron path. This plan does not add a quorum test or an HMAC replay test.

## What the reds reach

The report function test fails today because `reportUnreadableLedgers` is missing (`'undefined' !== 'function'`). After that check the test requires `unreadable === 1`, default `principalIds === 1`, `includeIds` deep-equal to `['p-legacy']`, no `C_x` in any returned value, a cap of 1 with `truncated`, the same mtime and sha256 for every file in the ledger directory, and the stored row unchanged.

The no-configure route fails today at `404 !== 403`. After that check the body must be empty. The admin route fails today at `404 !== 200`. After that check the body is `{ unreadable: 1, principalIds: 1, truncated: false }` with those keys only, and the audit receipt is counts only.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "ledger repair" harness/tests/erasure-ledger-repair.test.ts
```

Exit 1. 13 tests, 3 pass, 10 fail. `duration_ms` 499.888136.

Passed: the 403 erase, the signed workspace restore, and `reapplyErasures` mark bytes.

```
✖ ledger repair: the erase route counts rejected company scopes and leaks no ids
  { error: 'invalid_scope' }
  missing scopes: 2

✖ ledger repair: every caller imports the exported scope grammar
  false !== true

✖ ledger repair: a request refuses a pending step the grammar does not place
  true !== false

✖ ledger repair: a completed ledger refuses a step that cannot be placed
  true !== false

✖ ledger repair: a restore refuses an unknown step
  true !== false

✖ ledger repair: erasureWithGrant refuses a bad step on a readable row
  actual: [ 'receipts', 'personal', 'scope:C_x', 'not-a-step' ]
  expected: [ 'receipts', 'personal' ]

✖ ledger repair: a bad grant step is not written over the stored ledger
  actual: 'confirmed'
  expected: 'refused'

✖ ledger repair: a read-only report counts an unreadable legacy ledger and does not write
  actual: 'undefined'
  expected: 'function'

✖ ledger repair: a caller without configure gets 403 on the ledger report
  404 !== 403

✖ ledger repair: an admin ledger report returns a count and a counts-only receipt
  404 !== 200
```

`npm test`: exit 1. 709 tests, 699 pass, 10 fail, 0 skipped. `duration_ms` 12474.925198, wall 12.6s. The 10 failures are these tests. `npm run typecheck` exit 0, wall 3.5s. `npm run typecheck:worker` exit 0, wall 3.9s.

## Mutants

None of these edits is applied in this commit. After a fix, each one fails the named test again.

| Mutant | Edit | Red assertion |
| --- | --- | --- |
| count-omitted | 422 body stays `{ error: "invalid_scope" }` | missing `scopes: 2` |
| leak-scope | a log or header contains `SENTINEL_SCOPE_A` | the sentinel search |
| local-grammar | `ops-internal.ts` keeps its own `SCOPE_ID` | `false !== true` on the import |
| inline-step | `scopeIdOfStep` keeps a regex | the `SCOPE_ID` use check, then one literal |
| filter-place-6 | `pending` stays `place(id) < 6` | `true !== false` on the request |
| skip-add | `addSteps` skips an unknown step | `true !== false` on the completed ledger |
| skip-reopen | `reopen` skips an unknown step | `true !== false` on restore |
| merge-bad | the grant merge appends `scope:C_x` | the steps diff |
| mutate-grant | the same object is mutated and returned | existing steps no longer match the copy taken before the call |
| spend-approval | `requestSecond` returns `confirmed` and deletes the ask | `'confirmed' !== 'refused'` |
| no-report | `reportUnreadableLedgers` is absent | `'undefined' !== 'function'` |
| echo-ids | the default report returns principal id strings | the default JSON contains `p-legacy` |

## Rollback

Ordinary revert of this branch onto main `da3ac9c54a44f4ee249d5a32fecdac00a4a738eb`. Legacy ledgers are never migrated and never deleted, so the revert has no data step.

## Unslop

| Before | After | Kept |
| --- | --- | --- |
| 422 body is `{ error: "invalid_scope" }` | Exactly `{ error, scopes: int }` for two rejects, and 403 has no count | Tenant-wide refuse. No ledger row. Sentinel ids stay out of logs |
| The grammar literal is in three places | One export, and every other caller imports it | The same character class |
| `place < 6`, `addSteps`, and `reopen` drop an unknown step | The transition is `unknown_step` | `decodeErasure` fails closed. No rewrite on load |
| A bad step is merged into a readable grant and the second approval is spent | No merge, no in-place edit, result `refused`, pending ask stays | A healthy `receipts` and `personal` row |
| No read of unreadable ledgers | A configure-only count, an opt-in id list, a cap, and a counts-only receipt | Legacy rows are never migrated and never deleted |
| N-2 was treated as already covered | The signed 400 and the mark-byte test are in this file | Tenant restore still ignores scope and reopens directory |
