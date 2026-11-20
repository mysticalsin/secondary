# Plan 020 — Erasure ledger repair

Status: IMPLEMENTED. The plan was agreed with conditions at `cad7746ab7e60e8c1054be66a912ae1de8281224` (tree `7214bb3b`). The reds that follow that head are `7fe365849771d06e8363019e354e9827fe930418`. This file records the decisions the implementation follows.

Risk: HIGH. This touches data-rights erasure.

Parent of the branch: `da3ac9c54a44f4ee249d5a32fecdac00a4a738eb` (tree `916778a48bbbac1b0fa9526826f9b057634859cb`). This delta is on top of `7437b0b2a939dd5bb0c26b9fdd1e93d5343c7d97`.

## CONSENSUS

No agreement is recorded on this head. Loop 1 at `2fa36386` was Devin CONDITIONAL (`cf034c6b`) and Sentinel with C-1 to C-6 (`d3396517`). Loop 2 at `7437b0b2` asked for the report assertions below. The next debate binds to this head.

Implementation head: Devin and Sentinel lines pending re-bind.

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

Red commit `7fe365849771d06e8363019e354e9827fe930418`: exit 1. 23 tests, 4 pass, 19 fail. `duration_ms` 705.640424.

Passed on that red: the 403 erase, the signed workspace restore, `reapplyErasures` mark bytes, and the nested-write fingerprint. The nested-write test is a pinning (non-red) test.

The 19 failures: missing `scopes: 2`; grammar import `false !== true`; request, completed, and restore `true !== false`; a readable grant gained `scope:C_x` and `not-a-step`; a stored bad grant `'confirmed' !== 'refused'`; the report symbol `'undefined' !== 'function'`; the no-configure report `404 !== 403`; the admin report `404 !== 200`; a non-matching grant and a missing grant were not the same object; a replayed grant `'confirmed' !== 'refused'`; a refused tag `202 !== 422`; truncated and `includeIds` `404 !== 200`; an audit failure `404 !== 503`; a javascript copy `[]` against `['pkg/copy.js', 'pkg/copy.mjs']`.

Green on `1a75589a420ad571f7e58ac682a076eb12fe1840`: 23 pass, 0 fail, `duration_ms` 668.710438.

Green after the loop-1 pins: 27 pass, 0 fail, `duration_ms` 858.764776. The new pins pass on the current code, so they are not a separate red commit. Dropping the `unknown_step` catch then fails `500 !== 422`.

## Mutants

None of these edits is applied in this commit. After a fix, each one fails the named test again.

The report red on `7fe3658` stopped at `typeof` `'undefined' !== 'function'`. The assertions after that check are load-bearing. Measured on this tree, with the export and the route present, three stub mutants fail the later assertion:

- The export returns `{ unreadable: 0, principalIds: 0, truncated: false }`. `a read-only report counts an unreadable legacy ledger and does not write` fails `0 !== 1` at the `unreadable` check.
- The export writes `mutant-write.txt` into the ledger directory. The same test fails the recursive fingerprint: actual contains `mutant-write.txt`, expected does not.
- The route returns 200 `{ unreadable: 1, principalIds: 1, truncated: false }` without configure. `a caller without configure gets 403 on the ledger report` fails `200 !== 403`.

Loop-1 survivors, also measured here and not left in the tree:

- Dropping the `unknown_step` catch in `requestSecond` fails `an unknown step is refused with 422 unknown_step` with `500 !== 422`.
- Deleting the report `limit` slice fails `the report limit keeps the first row and the cap sets truncated` with `3 !== 1`.
- Deleting the `REPORT_MAX` clamp fails `the report clamps a limit above one hundred rows` with `120 !== 100`.
- Returning every id instead of the cap fails that limit test with `['p-a', 'p-b', 'p-c']` against `['p-a']`.
- Forcing `truncated: false` fails the same test with `false !== true`.
- Deleting `ORDER BY principal_id` fails `the ledger page is ordered by principal id` with `['p-m', 'p-a']` against `['p-a', 'p-m']`.

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

## Plan debate

Loop 1 at `2fa36386` was Devin CONDITIONAL (`/workspace/sb-gate/PLAN-REVIEW-sb-pr30-2fa36386.md`, sha256 `cf034c6b`) and Sentinel AGREED with conditions C-1 to C-6 (`/workspace/sentinel/debate-msb-pr30-2fa36386-20261120.md`, sha256 `d3396517`).

Loop 2 at `7437b0b2` required the report reds to carry their full assertions past the existence checks. That landed at `cad7746ab7e60e8c1054be66a912ae1de8281224`, tree `7214bb3b`.

The plan is AGREED with conditions at that head. Devin (non-author engineering): `/workspace/sb-gate/PLAN-REVIEW-sb-pr30-cad7746a.md`, report_sha256 `44a1862a`. Sentinel (security): `/workspace/sentinel/debate-msb-pr30-cad7746a-20261120.md`, sha256 `7b55cba4`.

## Decision record

- L-1 is option 1. A company scope the grammar rejects is `422` with exactly `{ error: "invalid_scope", scopes: <count> }`. The body does not name the ids. A caller without configure gets `403` and no count. The runbook sentence is in `docs/state-machines.md`, section 30: "If erase returns 422 invalid_scope, scopes is how many company scope ids fail the grammar. The body does not name them. Rename those ids before erasing. Do not drop the bad scope and continue."
- Refuse-not-drop stays. `addSteps` and `reopen` return no next state when a step is unknown, and `transitionErasure` answers `unknown_step`. An in-progress request does not drop a step whose place is 6.
- A bad step on a readable grant, on a grant that does not cover the order, or on a row with no grant returns the same object from `erasureWithGrant`. `recordErasureGrant` throws `unknown_step` inside the pending-delete transaction, so the delete rolls back. The result tag is `refused`, not `confirmed`. The erase route maps `refused` to `422` `{ error: "unknown_step" }` and does not return `202`.
- F-4. When the report's audit write does not return 202, the route returns `503` `{ error: "audit_unavailable" }`. That body names no principal and no scope. The ledger row is not updated and is not deleted.
- F-5. The route tests fingerprint the temp directory recursively, including a nested file. A write or a new file in that nested directory changes the fingerprint, so the comparison is not vacuous. The report handler does not write that tree. The stored ledger bytes are compared as well.
- F-6. The grammar pin walks `src/**/*.{ts,js,mjs}`. That is the whole implementation set. A copy of the character class in a `.js` or `.mjs` file fails the pin. The only allowed literal is `export const SCOPE_ID` in `src/state/erasure-request.ts`.
- N-2. A tenant restore ignores the scope query and reopens `directory`. `stepsForRestore` returns `["directory"]` when `kind` is `tenant`. There is no CLI caller and no cron caller of `reapplyErasures`. The only production caller is the signed restore route in `src/worker/ops-internal.ts`.
- `GET /v1/admin/rights/erasure-ledgers` reuses `requireConfigure`. A caller without configure gets `403` and an empty body, and the audits and the row are unchanged. The default body is a count. `includeIds=1` returns ids. Any other `includeIds` value is ignored and stays a count. The read uses `LIMIT` with a cap of 100, and `truncated` is set when another row exists past that page. The audit receipt is `rights_erasure_ledgers` with reason `unreadable <count>` and a null scope.
- Legacy ledgers are never migrated and never deleted. The report only reads them.
