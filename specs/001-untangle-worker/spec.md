# Feature Specification: One deny-receipt warning

**Feature Branch**: `cursor/sb-untangle-b165`

**Created**: 2026-11-19

**Status**: Draft

**Input**: Phase 1 of the Worker untangle. Recommended first slice from `specs/001-untangle-worker/decision-log.md`. No code change in this commit.

## User Scenarios & Testing

### User Story 1 - A failed deny receipt is logged once, the same way (Priority: P1)

A caller who is refused an action still gets 403. When the audit service does not accept the deny receipt, one warning is written. The warning names the action and the decision, and it does not name an address, a reason string, or a secret. Every deny site uses that same warning.

**Why this priority**: The warning text is copied in four places. The next field change will miss one of them.

**Independent Test**: Refuse an action with the audit binding missing or returning a non-202 response. The status is 403. One warning contains `audit_unavailable` and `deny`, and it contains no `@`.

**Acceptance Scenarios**:

1. **Given** a consultant who may not configure, **When** they post an action and the audit receipt fails, **Then** the response is 403 and the warning matches the shared shape.
2. **Given** a governance deny whose receipt fails, **When** the console returns 403, **Then** the same warning shape is used.
3. **Given** a question deny whose receipt fails, **When** the response is 403, **Then** the same warning shape is used.
4. **Given** a deny whose receipt is accepted, **When** the response is 403, **Then** no unavailable warning is written.

### User Story 2 - Switch-off stays its own record (Priority: P2)

Turning a switch off still happens before the audit call. A timeout still does not block the off. That log still says whether the audit succeeded, was refused, or timed out, and what the switch call returned. It does not become the deny warning.

**Why this priority**: The switch log changes for a different reason than a deny.

**Independent Test**: Disable a switch with a refused receipt, a hung receipt, and a refused switch call. Status and log fields stay as they are today.

**Acceptance Scenarios**:

1. **Given** a switch off whose receipt returns 500, **When** the switch was applied, **Then** the log names `refused` and `applied`, and the response is 200.
2. **Given** a hung audit call, **When** the wait ends, **Then** the log names `timed_out` and the response is still the switch result.

### Edge Cases

- A deny with no action string is an open question in the list below. The slice does not invent a fourth field.
- Two denies in one request. Each failed receipt logs once. A success does not log.

## Requirements

### Functional Requirements

- **FR-001**: Deny sites that today log `{ at: "audit_unavailable", action, decision: "deny" }` MUST call one shared warning.
- **FR-002**: A failed deny receipt MUST still return 403. This slice MUST NOT turn a 403 into a 503.
- **FR-003**: The warning MUST NOT include an address, a reason string, a cookie, or a secret.
- **FR-004**: An accepted deny receipt MUST NOT write that warning.
- **FR-005**: The switch-off audit outcome log MUST stay as it is. This slice MUST NOT route it through the deny warning.

### Success Criteria

- **SC-001**: A reader can change the warning fields in one function and the deny tests still describe the same 403 behavior.
- **SC-002**: Existing deny and switch-off tests pass without weakening an assertion.

### Key Entities

- **Deny warning**: action name, decision `deny`, marker `audit_unavailable`. No personal data.
- **Switch-off record**: audit outcome and switch status. Not a deny.

## Assumptions

- The four current warn sites are the whole slice: `admin/routes.ts` deny, both `routes.ts` deny branches, and `uxv2/questions.ts` deny.
- Fail-closed 503 paths stay fail-closed. They are a different policy.

## Open questions

- [NEEDS CLARIFICATION: Should a later slice also collapse the four `audit` wrappers into `ux/util.ts` `audit`, or is the warning function enough?]
- [NEEDS CLARIFICATION: The untangle skill can also remove comments that only restate the code, and tests that would not catch a real bug. Phase 1 does neither. Which, if either, should a later phase include?]
- [NEEDS CLARIFICATION: Lead role, switch route lists, and the `recovered-source` / `src/state` split are larger refactors. Which, if any, does the owner want specified next?]
