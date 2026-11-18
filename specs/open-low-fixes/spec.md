# Feature Specification: Open low fixes

**Feature Branch**: `cursor/sb-full-fix-b165`

**Created**: 2026-11-18

**Status**: Implemented

**Input**: Tony, 2026-11-18: fix the open findings that have a local change. Leave anything that needs a refactor, a live Access login, or `deploy/assets` on `cursor/recover-v24-deploy-1c66`.

## Clarifications

### Session 2026-11-18

- Q: On a login callback, which login row may be consumed? → A: Only the row whose key is the hash of the cookie state. A state that appears only in the query is not a key. This is machine 33 in `docs/state-machines.md`.
- Q: Does a SCIM user-name compare rewrite stored text? → A: No. The compare uses the same fold as `normalEmail` and `normalizedEmailSql`. An existing row's stored `user_name` and `email` stay as they are unless a rename is allowed and writes the trimmed lowercase value that create and patch already write. This is machine 34.
- Q: What does an unknown stored switch name log? → A: One line per `switchStatus` call, reason `unknown_name`, with no stored name and no enabled value. This is machine 36.
- Q: Is a non-ASCII email fold in this batch? → A: No. Machine 35 stays the recorded limit. SQLite `lower()` does not fold letters such as İ and Ω, and a JavaScript-only fold is not the change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A leaked login state cannot cancel someone else (Priority: P1)

A person starts sign-in. The login row is stored under the hash of the cookie state. A later callback that carries a different state in the query, an IdP error, or a missing code consumes the cookie's row when that cookie is present, and leaves every other login row in place. No session is issued for a mismatch, an IdP error, or a missing code.

**Why this priority**: The query state can name another person's pending login. Consuming that row is a denial of service against that person.

**Independent Test**: Two login rows. The callback sends one as the cookie and the other as the query. The cookie row is gone. The query row's nonce is unchanged. The response is 400 and sets no session cookie.

**Acceptance Scenarios**:

1. **Given** two login rows, **When** the callback query state differs from the cookie state and a code is present, **Then** the cookie row is consumed, the query row's nonce is unchanged, the status is 400, and the log reason is `state_mismatch`.
2. **Given** two login rows, **When** the callback has an IdP `error` and the query state differs from the cookie state, **Then** the cookie row is consumed, the query row's nonce is unchanged, and the status is 400.
3. **Given** two login rows and no cookie, **When** the callback names the second row's state in the query and omits the code, **Then** both rows stay, and the status is 400.
4. **Given** one login row, **When** the cookie state and the query state are the same value and the code exchange succeeds, **Then** that one row is consumed and a session can still be issued. The existing success test is the lock.

---

### User Story 2 - One SCIM user name is one person (Priority: P1)

A directory user name that differs from a stored `user_name` only by case or by the padding `normalEmail` folds is the same user name. Creating it does not insert a principal. A managed sign-in with that address binds the existing principal. A list filter with that address returns that user. A rename onto that name is refused and the caller's email stays. A different address is still `not_provisioned` and inserts nothing.

**Why this priority**: An exact compare misses the provisioned person and `ensurePrincipal` can insert a second principal.

**Independent Test**: Store `user_name` `Ada@Same.example` on a principal whose email is `other@same.example`. Create `ada@same.example`. The result is `uniqueness` and the principal count stays 1.

**Acceptance Scenarios**:

1. **Given** that stored user name, **When** create is asked for the folded form, **Then** the code is `uniqueness`, the principal count stays 1, and the SCIM row count stays 1.
2. **Given** a SCIM row `ada@scim.example` and a null subject, **When** a managed sign-in uses `Ada@Scim.example`, **Then** the principal id is that row's principal, the principal count stays 1, and the stored email bytes stay.
3. **Given** that row, **When** the list filter is ` Ada@Scim.example `, **Then** the total is 1 and the user id is that row.
4. **Given** a second SCIM user, **When** that user is renamed to the folded form of the first user's stored user name, **Then** the code is `uniqueness` and the second user's email is unchanged.
5. **Given** a stored user name `Ada@Self.example` on principal `self`, **When** that same row is renamed to `ada@self.example`, **Then** the rename is allowed.
6. **Given** only `ada@scim.example`, **When** a managed sign-in uses `other@scim.example`, **Then** the reason is `not_provisioned` and the principal count stays 1.

---

### User Story 3 - An unknown switch name is logged once (Priority: P2)

A `switches` row whose name is not one of the four switch names does not change the four flags. `switchStatus` logs one `unknown_name` line for that call, even when two such rows exist. The line has no stored name and no enabled value.

**Why this priority**: A silent skip hides a row the operator did not ask for. The log must not copy the stored name.

**Independent Test**: Insert `not-a-switch` and `also-unknown`. Call `switchStatus` once. One log line has reason `unknown_name`. The joined log does not contain either name. `mcp` stays enabled.

**Acceptance Scenarios**:

1. **Given** those two rows, **When** `switchStatus` runs once, **Then** the log contains one `unknown_name` and neither stored name.
2. **Given** no unknown row, **When** `switchStatus` runs, **Then** the log has no `unknown_name`. The existing absence test remains the lock.

---

### Edge Cases

- A callback with no cookie and no query state consumes nothing.
- A callback whose cookie state equals the query state consumes that one row, not a second row.
- Logs from these callbacks do not contain the cookie state, the query state, the code, the nonce, or the verifier.
- `normalEmail` of a blank user name matches no row. The list filter then returns total 0.
- A stored user name is not rewritten by the compare itself.
- Machine 35 (non-ASCII fold), machine 29 (wiki job claim SQL), machine 30's later retention paths, the budget refund, and machine 12 limit iv are not changed.
- No migration, no package, no deploy, no CI file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A login callback consumes a login row only when the cookie state is present, and only the row keyed by that cookie state's hash. The query state is not a key.
- **FR-002**: A mismatch, an IdP error, and a missing code or missing cookie leave a row that is named only by the query unchanged. Status stays 400 for those three, and no session cookie is set.
- **FR-003**: When the cookie state and the query state are the same value, that one row is consumed. The success path that exchanges a code still issues a session. No other login test assertion is weakened.
- **FR-004**: Callback logs from the new cases contain neither state, nor code, nor nonce, nor verifier.
- **FR-005**: `scimUserCreate` checks `normalizedEmailSql("user_name")` against `normalEmail` of the trimmed lowercase user name before `ensurePrincipal`. A match returns `uniqueness` and inserts no principal.
- **FR-006**: The managed branch of `resolveEntra` matches `user_name` with that same fold when `external_id` is null, the caller is not a guest, and the email is a UPN. A match binds that principal. It does not insert one.
- **FR-007**: `scimUserList` applies the same fold to the user-name filter. A blank folded filter matches no row.
- **FR-008**: `scimUserPatch` treats another row's folded user name as `uniqueness` and does not write the caller's email. The same row is excluded, so a case-only rename of that row still writes.
- **FR-009**: A managed sign-in for an address with no folded user-name match returns `not_provisioned` and inserts no principal.
- **FR-010**: `switchState` logs one `unknown_name` per call when at least one stored name fails `isSwitchName`. Two unknown names are still one line. The line is the existing `illegal_transition` object and does not include the stored name or the enabled value. Known switch flags are unchanged.
- **FR-011**: This batch adds no package, no CI config, no deploy file, and no migration. `candidate-manifest.json` is not edited. The three recovered files are already listed in `PATCHED_RECOVERED`.
- **FR-012**: Machine 35, the wiki job claim SQL, the budget refund, machine 12 limit iv, and the later erasure retention paths are not edited.

### Key Entities

- **Login row**: One `login_state` row keyed by the hash of a state value. Fields used here are the nonce and the fact of the row.
- **Cookie state**: The value of the login cookie. It is the only state that may select a login row.
- **Query state**: The `state` query parameter. It is not a key.
- **SCIM user name**: `scim_users.user_name`. Compared through `normalizedEmailSql`. Not rewritten by the compare.
- **Unknown switch name**: A `switches.name` that `isSwitchName` rejects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On parent `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`, the new login assertions fail, the new SCIM assertions fail, and the new switch assertion fails. After the matching code commit, each of those tests passes.
- **SC-002**: The final `npm test` count is 416 plus the new tests, 0 failed, 0 skipped. No previously passing test is deleted or weakened.
- **SC-003**: `npm run typecheck` and `npm run typecheck:worker` each report 0 errors.
- **SC-004**: A reader can point at the three code commits and the three tests. The log lines named above contain no state, code, nonce, verifier, switch name, or enabled value.

## Assumptions

- Parent head is `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`, where `npm test` is 416 passed and 0 failed, and both typechecks exit 0.
- The login tests use the synthetic states already in `harness/tests/oidc-login.test.ts`. No real IdP is contacted.
- SCIM rows in the new test are inserted with the existing test helper. Addresses use `example` names that are not a person's mailbox.
- `switchStatus` calls `switchState` once. "Once per load" means once per that call.
