# Feature Specification: Identity fold on the sign-in path

**Feature Branch**: `cursor/sb-full-fix-b165`

**Created**: 2026-11-18

**Status**: Draft

**Input**: Round 3 on head `48e2d584`. Devin's exact-head gate failed because sign-in still Unicode-lowercases an address before `normalEmail`.

## User Scenarios & Testing

### User Story 1 - A Kelvin sign-in is a different person (Priority: P1)

A directory address that contains U+212A or U+0130 must not bind the principal stored as `k@` or `i@`. The same rule holds for SCIM create, SCIM patch, `sessionCreate`, and the OIDC callback.

**Independent Test**: The restored `sessionCreate` assertions, the SCIM create and patch assertions, and the OIDC callback assertions.

**Acceptance Scenarios**:

1. **Given** principals `k@ascii.example` and `i@ascii.example`, **When** `sessionCreate` runs for U+212A and U+0130, **Then** the new principals are not `kay` or `aye` and the stored ASCII addresses are unchanged.
2. **Given** the same pair in SCIM, **When** create and patch use those characters, **Then** the stored user name is the original character, not the ASCII letter.
3. **Given** an OIDC token whose preferred username contains those characters, **When** the callback succeeds, **Then** the ASCII principal is not taken over.

### User Story 2 - An at-sign with no local part is invalid (Priority: P1)

A SCIM patch of a name that still contains `@` after trim, and that `normalEmail` rejects, writes nothing. The rejector is the `normalEmail` guard.

**Independent Test**: Patch `@ascii.example` and expect `invalid` with the stored name unchanged. Reverting only that guard makes the test fail.

### User Story 3 - Pilot membership uses the same fold (Priority: P2)

A cohort member written with U+212A does not turn a flag on for `k@`.

**Independent Test**: `pilotSave` then `flagsFor`.

### User Story 4 - Unknown switch memory is per tenant and capped (Priority: P2)

Each tenant logs an unknown switch name once. A second tenant still logs it. One tenant stops after 256 names.

**Independent Test**: Two `TenantPolicy` instances, then 257 names on one instance.

### User Story 5 - A failed deny receipt is visible and still closed (Priority: P2)

When the audit service does not accept a deny receipt, the response stays 403 and a structured warning is logged with no address and no reason text.

**Independent Test**: Consultant `POST /roles` with `AUDIT` missing.

### Edge Cases

- Exactly 600 seconds after a login row is written, the row is rejected and deleted. 601 seconds is rejected. `expires_at <= now`.
- A replay after a failed code exchange stays 400, writes no session cookie, and finds no login row.
- Turning a switch off still does not wait for the audit log. That contract is unchanged.

## Requirements

### Functional Requirements

- **FR-001**: `sessionCreate` MUST pass the address to the identity store without `String.prototype.toLowerCase`.
- **FR-002**: SCIM create, SCIM patch, the OIDC mail claim, and every other email or account-key match MUST fold with `normalEmail` or ASCII A–Z only.
- **FR-003**: `normalEmail` MUST return null for a string that contains `@` but has an empty local part, an empty domain, or more than one `@`. The SCIM guard MUST be what rejects that string.
- **FR-004**: Pilot save, flag lookup, and remembered addresses MUST use `normalEmail`.
- **FR-005**: Unknown switch names MUST be remembered per Durable Object instance, at most 256 names. The log line stays `unknown_name` with no name and no value.
- **FR-006**: A deny whose receipt fails MUST stay 403 and MUST log `{ at: "audit_unavailable", action, decision: "deny" }` with no address and no reason text.
- **FR-007**: `switch_disable` MUST stay after the write. Off MUST NOT wait for the audit log. The audit call MUST be bounded, and a refused or timed-out receipt MUST log `{ at: "audit_unavailable", action: "switch_disable" }` with no address.
- **FR-008**: An elevated CEO MUST NOT approve or publish a wiki proposal. `review` and `edit` from elevation are not `approve_release`.
- **FR-009**: A same-person prod re-enable MUST return 409 `switch_refused`. A different person's pending ask stays 202.
- **FR-010**: A withdraw by someone other than the proposer MUST write a `rejected` receipt and MUST NOT write an `allow` receipt. The response stays 403 `not_proposer`.
- **FR-011**: A SCIM user name of `@` MUST be `invalid` and MUST write nothing.

### Success Criteria

- **SC-001**: The four identity paths reject a Kelvin or dotted-I collision. Each red test fails on an assertion before its fix and passes after.
- **SC-002**: `@ascii.example` is `invalid` only while the `normalEmail` guard is present.
- **SC-003**: `npm test`, both typechecks, and `verify:provenance` pass on the final head.
- **SC-004**: Each behavior change has its own test-only commit that fails an assertion, then its own fix commit that makes that assertion pass.

## Assumptions

- SQL `lower()` stays ASCII-only. `normalEmail` stays the same A–Z fold plus the structural null in FR-003.
- Search text, content titles, flag words, and SCIM attribute names are not identity keys and stay as they are.
- The incident-response comment on switch off is the contract. No HTTP change.
