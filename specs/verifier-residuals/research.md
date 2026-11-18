# Research: Verifier residuals

## R1. ASCII lowercase

**Decision**: `normalEmail` replaces `toLowerCase()` with a replace of ASCII A–Z only. SQL stays `lower()`.

**Rationale**: JavaScript `toLowerCase` maps U+212A to `k` and U+0130 to `i` plus U+0307. SQLite `lower()` leaves both characters unchanged. The non-managed lookup binds the JavaScript fold and compares it to the SQL fold, so a Kelvin sign matches an ASCII `k` principal. Machine 35 says the two sides stay one expression and a JavaScript-only Unicode fold is not the change.

**Alternatives rejected**: Reject every non-ASCII local part. That refuses addresses the SQL fold can store as themselves. Changing other `trim().toLowerCase()` call sites is L2 and stays out.

## R2. Patch guard

**Decision**: `scimUserPatch` adds the same `!normalEmail(userName)` check `scimUserCreate` already has, before any write.

**Rationale**: Sentinel F-2. A name the fold blanks must not be stored by patch.

## R3. Ready status

**Decision**: A synchronous throw from `tenantStub` or `env.BLOBS` is a failed check. The existing route maps `ready: false` to 503.

**Rationale**: Inspector D3. The route already returns 503 for a failed check. The 500 is the throw escaping `readiness` before that return.

## R4. Switch log

**Decision**: A module-level `Set` records names already logged in this isolate. The log object is unchanged and does not include the name.

**Rationale**: Sentinel F-5. One line per name, then silence. The set is process memory, not a table.

## R5. Login lifetime

**Decision**: The existing `loginStateTake` delete-and-reject is the behavior. The new test drives the callback 601 seconds later.

**Rationale**: Devin L1. `LOGIN_STATE_MS` is 600 seconds. The callback clock is the `now` argument.
