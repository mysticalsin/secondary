# Research: Identity fold

## Decision: ASCII A–Z plus a structural null

`String.prototype.toLowerCase` maps U+212A to `k` and U+0130 to `i` plus U+0307. SQLite `lower()` does neither. `normalEmail` already uses A–Z only. The sign-in wrapper, SCIM user name, OIDC mail, and the other email and account-key sites still call `toLowerCase` first, so the shared fold never sees the original character.

## Decision: empty local part is the F-2 input

`@ascii.example` still contains `@` after trim and is 14 characters. A padding-only name is already blank after trim, so the older `@` check rejects it without the `normalEmail` guard. An empty local part is rejected only when `normalEmail` returns null.

## Decision: switch off stays after the write

The route comment says turning a switch off must not wait for the audit log. Auditing first would fail the off closed when audit is down. That is a contract change, so the route stays.

## Alternatives considered

Per-tenant module map for unknown names was rejected. The Durable Object instance is already the tenant boundary, and a cap on that instance needs no new key.
