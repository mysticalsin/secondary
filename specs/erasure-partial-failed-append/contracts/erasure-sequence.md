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

The pseudonym key is usable. The current full plan is `receipts`, `tombstone`, `scope:acme`, `personal`, `connector`, `directory`. The stored grant does not cover that plan, so confirmation writes a wider grant and then the runner sends `request` with those steps.

## Ends

Today, before any option is named:

| Performed steps | Status | Order |
|---|---|---|
| One step returns false | `partial_failed` | `directory`, `receipts`, `tombstone`, `scope:acme`, `personal`, `connector` |
| Every step returns true | `completed` | the same appended order |

After Devin or Tony names an option, both rows of that table become the named option's pair. The test asserts that pair and no other erasure response.
