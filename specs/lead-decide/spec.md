# Feature Specification: In-brain lead decisions

**Feature Branch**: `cursor/sb-full-fix-b165`

**Created**: 2026-11-18

**Status**: Draft

**Input**: N-A on head `762f076d`. `mayDecide` requires `approve_release` for every wiki decision, so a brain lead cannot list, open, review, or approve inside the brain they lead.

## User Scenarios & Testing

### User Story 1 - A lead decides inside their brain (Priority: P1)

A lead can list, open, review, and approve a wiki proposal in the brain they lead. `acme_lead` leads `a_acme`. The same role's `c_sales` edit grant is the c_sales lead. They cannot decide in a brain they do not lead.

**Independent Test**: `mayDecide` for `acme_lead` on `a_acme`, on `c_sales`, and on `core`.

**Acceptance Scenarios**:

1. **Given** `acme_lead`, **When** the node is `a_acme`, **Then** the decision is allowed.
2. **Given** `acme_lead`, **When** the node is `c_sales`, **Then** the decision is allowed.
3. **Given** `acme_lead`, **When** the node is `core`, **Then** the decision is denied.

### User Story 2 - Elevation and self-approval stay closed (Priority: P1)

An elevated CEO still cannot approve or publish. Nobody approves their own proposal. Elevation does not include `approve_release`.

**Independent Test**: Elevated CEO `mayDecide` is denied. A reviewer with `approve_release` is denied when the author is themselves. No role's elevation actions include `approve_release`.

## Requirements

### Functional Requirements

- **FR-001**: A standing `review`, `edit`, or `approve_release` grant on a node allows `mayDecide` for that node. An allow that exists only while `elevatedUntil` is set does not.
- **FR-002**: An elevated CEO remains denied. This keeps `specs/identity-fold/spec.md` FR-008. `review` and `edit` from elevation are not a release.
- **FR-003**: When the caller is the proposal author, `mayDecide` is denied. The approve route passes that author.
- **FR-004**: `packages/policy` role elevation actions do not include `approve_release`.

### Success Criteria

- **SC-001**: The lead, cross-brain, self-approval, and elevated-CEO assertions fail before the production change and pass after it.
- **SC-002**: `npm test`, both typechecks, and `verify:provenance` pass on the head.

## Assumptions

- `acme_lead` is the c_sales lead because that role holds the `c_sales` edit grant. There is no second role id for that circle.
- `specs/identity-fold/tasks.md` T014 required `approve_release` for every decision. That task is narrowed here to elevated and cross-brain releases. FR-008's outcome is unchanged.
- An `edit` grant limited to `own_drafts` is not a lead grant. The engine already refuses that edit of someone else's item.

## Clarification against FR-008

FR-008 at `specs/identity-fold/spec.md:66` forbids an elevated CEO from approving. It does not require `approve_release` for a standing grant inside the led brain. This spec does not conflict with that line.
