# Data model: Erasure partial-failed append

## Erasure request

One row per person. The fields this sequence reads and writes:

| Field | Meaning |
|---|---|
| status | `requested`, `running`, `completed`, or `partial_failed` on this path. `absent` and `unreadable` are the other stored readings and are not the start of the append. |
| order | Step ids. The reproduced start is `directory`. The appended order is that list plus each missing full-plan step. |
| mark | `pending`, `done`, or `failed` for each id in the order. |
| grant | Subject, requester, confirmer, and the approved step ids. The helper widens the step ids and leaves the order. |
| receipts | Unchanged by the decision. The receipt scan stays as it is. |

## Full plan

`receipts`, `tombstone`, each `scope:<company>`, `personal`, `connector`, `directory`. For the reproduced organisation the company scope is `scope:acme`.

## Transitions this feature may change

Only after an option is named, and only when that option is not Accept:

- A `request` on a non-completed, non-empty order. Today it appends. Replace would start the canonical plan. Resume would keep the stored order.
- The grant helper's choice to keep the stored order while widening the approved steps. Replace needs the confirmed grant's plan to become the order. Resume can keep today's helper.

Accept changes neither.

## Transitions this feature does not change

- No-key refusal before a ledger write.
- `request` on `absent`, `unreadable`, or an empty order.
- `request` on `completed`.
- `resume`, `restore`, `step_done`, and `step_failed` for a step already in the order.
- Tombstone rows, receipt cursors, and restore re-apply.

## Validation

The new test reads the stored status and order after the sequence. It does not read a secret. It does not assert a new table.
