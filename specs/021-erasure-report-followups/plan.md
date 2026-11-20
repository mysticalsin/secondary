# Plan 021 — Erasure report follow-ups

Status: RED. No production change is in the red commit. The decisions below are what the green commit implements.

Risk: MEDIUM. This changes the report flag and one audit reason. It does not change erasure.

Parent: `3192477c2550c3776c83a5e2fd5ff34693734256` (tree `22c32f79a95dbe86b7c41d54861b2d001cf936c9`).

## Ticket

SB-ERASURE-REPORT-FOLLOWUPS. Sentinel residuals from #30 (`ffce42cf`).

Done when:

- [ ] `reportUnreadableLedgers` sets `truncated: true` in both modes whenever `rows.length > limit` or `bad.length > cap`. It does not return `truncated: false` after a clip.
- [ ] Two unreadable rows and `{ cap: 1 }` with no `includeIds` are exactly `{ unreadable: 2, principalIds: 1, truncated: true }`.
- [ ] A limit of 1 on three unreadable rows sets `truncated: true`. The clamp to 100 rows sets `truncated: true` when 120 rows are passed with `includeIds`, even though the cap does not cut the scanned ids.
- [ ] `GET /v1/admin/rights/erasure-ledgers?includeIds=1` writes the reason `unreadable <count> ids=1`. The reason has no principal id and no scope id. A query that is not exactly `includeIds=1` keeps `unreadable <count>` and does not append `ids=1`.
- [ ] F-D is not implemented. The plan-debate question below is the record.
- [ ] F-B and F-E stay notes. No code for them.

## Decision record

- F-A. The old pin `{ unreadable: 2, principalIds: 1, truncated: false }` was the clip with the flag off. The new value is `{ unreadable: 2, principalIds: 1, truncated: true }`. `unreadable` stays the count of unreadable rows inside the scanned window. `principalIds` on the default path stays that capped count, not the ids. `truncated` is true because the cap cut the count. The same flag is true when `rows.slice(0, limit)` drops rows, including when the limit is clamped to 100. Both modes use that rule.
- F-C. When the route returns ids, the receipt reason is `unreadable <count> ids=1`. The ids themselves stay out of the receipt.
- F-D, plan-debate question. Can the erase route return 503 `audit_unavailable` with no state change when `audit()` is false? No, not with these stores. The pending path writes `pending_ops` before the receipt. The completion path runs `eraseSubject` before the receipt: personal items, receipt pseudonyms, the tombstone, and the directory row are already gone. `appendReceipt` is a separate HTTP call. Those writes do not share a transaction. A 503 after either write leaves the ask or the erasure in place. A receipt written before the erase would claim an erasure that has not happened if the erase then fails. This slice leaves F-D out.
- F-B. The `refused` tag at `src/worker/tenant-policy.ts` line 989 is also the tag returned when the grant write throws `unknown_step`. Callers cannot tell an illegal quorum step from an unknown erasure step by the tag. This slice does not split it.
- F-E. The function tests pass rows to `reportUnreadableLedgers` and do not open the ledger directory, so they do not see a write. The route tests already fingerprint that directory. This slice does not add a write probe to the function tests.

## Red

TEST COMMAND:

```
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern "ledger repair" harness/tests/erasure-ledger-repair.test.ts
```

Red on this commit, before the production change: exit 1. 28 tests, 24 pass, 4 fail. `duration_ms` 902.042204.

The 4 failures:

- `includeIds is ignored unless the caller asks and still stays configure-only` fails `'unreadable 1' !== 'unreadable 1 ids=1'`.
- `the default report caps the count and sets truncated` fails `deepStrictEqual`: actual `{ unreadable: 2, principalIds: 1, truncated: false }`, expected `{ unreadable: 2, principalIds: 1, truncated: true }`.
- `the report limit keeps the first row and the cap sets truncated` fails `false !== true` on the limit of 1.
- `the report clamps a limit above one hundred rows` fails `false !== true` when 120 rows are listed with `includeIds`.

## Mutants

None of these edits is applied in a commit. After the fix, each one fails the named test again.

- `er-report-default-truncated-stuck-false`: the default return keeps `truncated: false`. `the default report caps the count and sets truncated` fails `deepStrictEqual`.
- `er-report-row-clip-unflagged`: `truncated` is only `bad.length > cap`. `the report limit keeps the first row and the cap sets truncated` fails `false !== true`, and `the report clamps a limit above one hundred rows` fails the same way.
- `er-report-receipt-omits-ids`: the reason stays `unreadable <count>` when ids are returned. `includeIds is ignored unless the caller asks and still stays configure-only` fails `'unreadable 1' !== 'unreadable 1 ids=1'`.

## Rollback

Revert onto `3192477c2550c3776c83a5e2fd5ff34693734256`. Nothing is migrated.

## Unslop

| Before | After | Kept |
| --- | --- | --- |
| A cap cut the default count and left `truncated` false | `{ unreadable: 2, principalIds: 1, truncated: true }` | The default path still returns a count, not ids |
| `rows.slice(0, limit)` dropped rows with no flag | `truncated` is true in both modes | `unreadable` stays the scanned count |
| An id list receipt said only `unreadable N` | `unreadable N ids=1` | The ids themselves stay out of the receipt |
| The erase route ignores `audit()` | Left out. See the F-D question | No erase behavior change |
