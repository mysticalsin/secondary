# Contract: refused no-key, then keyed erase

## Start

A stored request for one person:

- status `requested`
- order `directory`
- mark `directory` = `pending`
- grant covers that subject and the step `directory`, with two distinct people

## No-key erase

The pseudonym key is missing, empty, or shorter than 32 characters.

Response: refusal. HTTP `erase_disabled` on the rights route. The runner returns the same refusal and does not apply a transition.

Stored request: the same status, order, marks, and grant. No delete.

## Keyed erase

The pseudonym key is usable. The canonical plan is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory`. The stored grant does not cover that plan, so confirmation writes a wider grant and then the runner sends `request` with those steps.

## Ends after Replace

| Case | Status | Order | Steps that run |
|---|---|---|---|
| Connector step returns false | `partial_failed` | canonical plan, receipts first, directory last | `receipts`, `tombstone`, `scope:acme`, `personal`, `connector` |
| Retry of that row with the connector step returning true | `completed` | canonical plan | `connector`, then `directory`. `receipts`, `tombstone`, `scope:acme`, and `personal` stay `done` and are not run |
| Every performed step returns true | `completed` | canonical plan | `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory` |
| Stored order `directory` with that mark `done` | `completed` when the performed steps return true | `directory`, then `receipts`, `tombstone`, `scope:acme`, `personal`, `connector` | `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`. `directory` stays `done` and is not run. This order already held before the green commit |
| Stored order `receipts` then `directory`, `receipts` done and `directory` pending | `completed` when the performed steps return true | `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory` | `tombstone`, `scope:acme`, `personal`, `connector`, `directory`. `receipts` stays `done` and is not run |
| Absent subject, one step returns false | `partial_failed` | canonical plan, directory last, no append | unchanged from the parent |

The retry proves the idempotency M-03 relies on: a failed erase can be asked for again, and a step already done is not run again.

## Rejected ends

- Accept would keep the appended order, directory before receipts. Rejected because it breaks M-03.
- Resume would keep the stored order and can end `completed` while data remains. Rejected because that is a false erasure receipt.

## Logs

A log line emitted by the re-plan contains a principal id, step names, and states only. It does not contain the pseudonym key, an email address, or erased content. No such line is required. The existing route audit that names the pseudonym is unchanged and is outside this assertion.
