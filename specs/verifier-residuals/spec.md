# Feature Specification: Verifier residuals

**Feature Branch**: `cursor/sb-full-fix-b165`

**Created**: 2026-11-18

**Status**: Implemented

**Input**: Sentinel report `37eb44c2f426efa0cce0d6dfb157eda79deafaa3c374f136bdc43842c2775269` and Inspector report `4f47ada0cebc9c39119800366206e15a202c0d07e3039c3b25c1e07f3a90fea7`, both on head `6f7aaeae6af7c39d06d056a5306be25b9f888b0c`, plus Devin's L1. L2, the budget refund, the wiki claim reducer, and the role-null member pass stay out.

## Clarifications

### Session 2026-11-18

- Q: How should U+212A and U+0130 compare to ASCII `k` and `i`? → A: The lowercase step is ASCII A–Z on both sides, the same rule as SQLite `lower()`. Those two characters stay themselves and do not match `k` or `i`. Ω still does not match ω.
- Q: What does a missing Durable Object or R2 binding do to `/v1/ready`? → A: The check is `fail`, the body is `{ ready: false, checks: { do, r2 } }`, and the status is 503.
- Q: How often is `unknown_name` logged? → A: Once per distinct stored name for the life of the isolate. The line still has no name and no value. A second read logs nothing new.
- Q: Where do the QA shell, boot script, plan, and screenshots live? → A: On `cursor/sb-full-fix-qa-b165`, based on the fix head. `harness/tests/local-boot.test.ts` stays on this branch.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kelvin sign is not the letter k (Priority: P1)

A non-managed sign-in whose address contains U+212A does not bind the principal stored as ASCII `k`. U+0130 does not bind ASCII `i`. `normalEmail` and `normalizedEmailSql` return the same text for both characters.

**Independent Test**: Store `k@ascii.example` and `i@ascii.example`. Sign in with U+212A and U+0130 at that domain. Neither principal id is the stored ASCII row. SQL and JS folds are equal and are not `k@` or `i@`.

### User Story 2 - Patch uses the create fold guard (Priority: P1)

`scimUserPatch` refuses a user name that `normalEmail` blanks, and it does not write the row. The predicate is the same one `scimUserCreate` already uses.

**Independent Test**: Patch a stored user to a padding-only name. The code is `invalid`. The stored user name and email are unchanged.

### User Story 3 - Readiness without bindings is 503 (Priority: P1)

`GET /v1/ready` with no Durable Object namespace and no R2 binding returns 503 and `{ ready: false, checks: { do: "fail", r2: "fail" } }`.

**Independent Test**: `harness/tests/local-boot.test.ts` calls the real app with those bindings absent.

### User Story 4 - An unknown switch name is logged once per name (Priority: P2)

Two unknown switch names produce two `unknown_name` lines on the first read and none on the second. Neither line contains a stored name or an enabled value. The four known switches stay enabled.

**Independent Test**: Insert two unknown rows, call `switchStatus` twice, count the lines.

### User Story 5 - A login older than 600 seconds is rejected (Priority: P2)

The callback clock is 601 seconds after the login row was stored. The response is 400, no session cookie is set, and the row is gone.

**Independent Test**: One OIDC callback with `now` moved past `LOGIN_STATE_MS`.

### Edge Cases

- A second read of the same unknown switch names logs nothing.
- U+212A and U+0130 stay equal between SQL and JS.
- Coverage locks, not new product rules: the login and session cookies are `__Host-` names with `Secure`, `HttpOnly`, `SameSite=Lax`, and no `Domain`. A failed code exchange cannot be replayed. The callback redirects to the stored validated `returnTo`, and `https://` and `//` are not stored. Two SCIM creates of the same folded ASCII name, then a patch onto that name, do not add a principal.
- No package, no deploy, no migration. L2's other `trim` / `toLowerCase` compares are not edited.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `normalEmail` lowercases only ASCII A–Z. `normalizedEmailSql` stays `lower()`, which is the same ASCII rule. U+212A does not become `k`. U+0130 does not become `i`.
- **FR-002**: A non-managed `sessionCreate` with those two addresses does not return the principal id stored under the ASCII letter.
- **FR-003**: `scimUserPatch` returns `invalid` when `normalEmail` of the trimmed user name is null, and it does not update `user_name` or `email`.
- **FR-004**: `readiness` treats a thrown binding call as `fail` for that check. `GET /v1/ready` returns 503 with `{ ready: false, checks }` when either check is `fail`. The route already maps `ready: false` to 503.
- **FR-005**: `switchState` logs `unknown_name` once per distinct stored name per isolate. The line is the existing `illegal_transition` object. A repeat read adds no line.
- **FR-006**: An OIDC callback whose clock is past the 600 second login lifetime returns 400, sets no session cookie, and leaves no login row.
- **FR-007**: This batch adds no package, no CI file, no deploy file, and no migration. It does not edit `pilot-member.ts` or other pre-existing `trim().toLowerCase()` email compares outside `normalEmail`.

### Key Entities

- **Folded address**: Padding replaced, ends trimmed, ASCII A–Z lowercased. Blank is null.
- **Login row**: `login_state`, lifetime 600 seconds from the clock that stored it.
- **Ready body**: `ready` boolean and `checks.do` / `checks.r2` of `ok` or `fail`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The F-1, D3, and F-5 tests fail on `6f7aaeae` and pass after their code commits. F-2's padding patch is refused. L1's expiry callback is 400 and the row is gone.
- **SC-002**: `npm test`, both typechecks, and `npm run verify:provenance` exit 0 on the final fix head. Provenance is not weakened.
- **SC-003**: The fix branch tip does not contain `qa/FULL-QA-PLAN.md`, `qa/boot-local.mjs`, `qa/synthetic-shell.html`, `qa/synthetic-shell.css`, or `qa/screenshots/`. Those files are on `cursor/sb-full-fix-qa-b165`. `harness/tests/local-boot.test.ts` remains.

## Assumptions

- Parent behavior head for this delta is `6f7aaeae6af7c39d06d056a5306be25b9f888b0c`.
- Addresses in tests are synthetic. U+212A and U+0130 are the characters, not a person's mailbox.
- The QA branch is documentation and screenshots. It is not merged from this spec's implementation commits.
