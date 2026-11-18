# Contract: Identity boundary

Parent behavior is `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. This contract is the difference.

## Login callback `GET /auth/callback`

| Input | Login rows after the call | HTTP | Session cookie |
|---|---|---|---|
| Cookie state A, query state B, code present, A ≠ B | A consumed, B unchanged | 400 `invalid_state` | absent |
| Cookie state A, query state B, `error` present, A ≠ B | A consumed, B unchanged | 400 `sign_in_failed` | absent |
| No cookie, query state B, no code | B unchanged | 400 `invalid_state` | absent |
| Cookie state A equals query state A, code exchange succeeds | A consumed | 303 | present, as today |

The log `reason` for the first row is `state_mismatch`. For the second, `idp_error`. For the third, `missing_state`. The line does not include A, B, the code, the nonce, or the verifier.

## SCIM user name

Folded name means `normalEmail` of the caller value and `normalizedEmailSql("user_name")` of the stored column.

| Call | When | Result | Principals |
|---|---|---|---|
| `scimUserCreate` | folded name already stored | `{ ok: false, code: "uniqueness" }` | unchanged |
| `sessionCreate` managed, UPN, not guest, `external_id` null | folded name stored, subject null | `{ ok: true, principalId }` of that row | count unchanged; `subject` may be set; `email` bytes unchanged |
| `sessionCreate` managed | no folded match | `{ ok: false, reason: "not_provisioned" }` | unchanged |
| `scimUserList` | filter folds to a stored name | `total` 1 and that user | unchanged |
| `scimUserList` | filter folds to null | `total` 0 | unchanged |
| `scimUserPatch` | another row folds to the new name | `{ ok: false, code: "uniqueness" }` | caller email unchanged |
| `scimUserPatch` | the same row, case-only | `{ ok: true }` | that row's user name becomes the trimmed lowercase value |

## Switch read

`switchStatus` with one or more unknown `switches.name` values returns the same four flags as a read with those rows absent, and emits one log line whose `reason` is `unknown_name`. The line does not contain those names or their `enabled` values.
