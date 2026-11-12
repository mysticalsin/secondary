# Data model: Erasure partial-failed append

## Erasure request

One row per person. The fields this sequence reads and writes:

| Field | Meaning |
|---|---|
| status | `requested`, `running`, `completed`, or `partial_failed` on this path. `absent` and `unreadable` are the other stored readings. An absent start uses the canonical plan and is not an append. |
| order | Step ids. The reproduced start is `directory`. The appended order is that list plus each missing canonical step. Replace stores the canonical plan when no step is done. |
| mark | `pending`, `done`, or `failed` for each id in the order. A `done` mark stays `done`. |
| grant | Subject, requester, confirmer, and the approved step ids. The helper widens the step ids and leaves the order. Replace does not edit that helper. |
| receipts | Unchanged by the order decision. The receipt scan stays as it is. |

## Canonical plan

The array returned by `erasurePlan` at `src/state/erasure-request.ts:260-268`: `receipts`, `tombstone`, each `scope:<company>`, `personal`, `connector`, `directory`. For the reproduced organisation the company scope is `scope:acme`.

## Appended order

The stored order, then each canonical step that was not already in it. On a `directory`-only row this is `directory`, `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`. Directory runs before receipts. That is the defect.

## Replace

In the single request decision at `erasure-request.ts:358` and `:370`:

- A step marked `done` stays `done` and is not run.
- Done steps keep their relative order.
- Not-done steps are placed after the done steps, in canonical order, once each.
- When no step is done, the stored order is exactly the canonical plan.
- A performed step that returns false ends `partial_failed`. Every performed step returning true ends `completed`.

`addSteps` still only appends. The completed-row path may still call it. The non-completed request path does not use it for this plan.

## Transitions this feature changes

- A `request` on a non-completed, non-empty order. Today it appends. After the green commit it uses Replace.

## Transitions this feature does not change

- No-key refusal before a ledger write.
- `request` on `absent`, `unreadable`, or an empty order. T5 pins the absent subject. The unreadable row and the empty order stay as they are and are not part of that pin.
- `request` on `completed`.
- `resume`, `restore`, `step_done`, and `step_failed` for a step already in the order.
- A missing email at `ops-rights.ts:188` returns true, so directory still runs.
- A connector step that returns false is `step_failed` at `erasure-request.ts:399` and the status is `partial_failed`.
- Tombstone rows, receipt cursors, and restore re-apply.
- No migration rewrites a stored ledger.

## Validation

The new tests read the stored status, order, and marks after the sequence. They do not read a secret. They do not assert a new table. They do not assert that the directory row is kept.
