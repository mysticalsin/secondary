# Feature Specification: Lead from the role grant

**Feature Branch**: `cursor/sb-untangle-lead-b165`

**Created**: 2026-11-19

**Status**: Draft

**Input**: Tony approved the three larger untangle refactors ("A, all three", via Jarvis, 01:16 BRT). This slice is the lead rule only. Behaviour of who may decide and who may direct-publish stays as it is.

## User Scenarios & Testing

### User Story 1 - A lead is the role grant, not a second list (Priority: P1)

`acme_lead` can decide in `a_acme` and in `c_sales` because those grants say the role leads that scope. `acme_lead` cannot decide in `core`. A different role with a standing edit or review grant on `c_sales` cannot decide there. A standing `approve_release` grant still can. Changing who leads a brain is a change to that grant, not a change to a role-id set in `wiki/review.ts`.

**Why this priority**: The set `LEAD_ROLES` does not follow the role table. The next lead would be missed.

**Independent Test**: `mayDecide` for `acme_lead` on `a_acme`, `c_sales`, and `core`, and for a circle editor who has edit and review on `c_sales` but no lead grant.

**Acceptance Scenarios**:

1. **Given** `acme_lead`, **When** the node is `a_acme` or `c_sales`, **Then** the decision is allowed.
2. **Given** `acme_lead`, **When** the node is `core`, **Then** the decision is denied.
3. **Given** a role whose `c_sales` grant is edit and review and is not a lead grant, **When** they decide in `c_sales`, **Then** the decision is denied.
4. **Given** a reviewer with a standing `approve_release` grant on `core`, **When** they decide in `core`, **Then** the decision is allowed.

### User Story 2 - The author, the alias, and elevation stay closed (Priority: P1)

The proposal author cannot decide, including when the author id differs only by letter case or is an alias id. Elevation does not count as a lead and does not count as `approve_release`.

**Why this priority**: Deriving the lead from the grant must not open self-approval or elevation.

**Independent Test**: `mayDecide` with the caller's own id, an upper-case author id, an alias id, and an elevated CEO.

**Acceptance Scenarios**:

1. **Given** the caller is the author, **When** the ids differ by letter case, **Then** the decision is denied.
2. **Given** the author id is one of the caller's alias ids, **When** they decide, **Then** the decision is denied.
3. **Given** an elevated CEO, **When** they decide on a node elevation can review, **Then** the decision is denied.

### User Story 3 - Direct publish stays on can.decide (Priority: P2)

`directPublish` keeps `can.decide` exactly as on main. It does not ask `mayDecide`. A caller with `can.decide` true can still direct-publish when the brain's mode and bounds allow it, whether or not they are a lead. A caller with `can.decide` false cannot. Whether publish should ask `mayDecide` instead is deferred until Tony decides.

**Why this priority**: Gating publish on `mayDecide` changed who can publish in both directions.

**Independent Test**: The truth table generated from main `2d61c473`. Same role, workspace, `can.decide`, and stored role give the same publish result.

**Acceptance Scenarios**:

1. **Given** `can.decide` true, a direct circle, and a stored role of none or editor, **When** direct publish is asked, **Then** the result is true.
2. **Given** `can.decide` false, **When** direct publish is asked, **Then** the result is false.
3. **Given** an account or Company Global brain, **When** the stored mode is direct, **Then** the result is false.

## Requirements

### Functional Requirements

- **FR-001**: Which seeded role is a lead MUST be derived from the built-in role table, not from a hand-written id list and not from a `lead` condition on a grant. For the seeded roles, that derivation MUST match the old `LEAD_ROLES` membership (`acme_lead` only). A lead then decides on any node where a standing `edit`, `review`, or `manage_members` check passes, including a stored role that was edited after seeding.
- **FR-002**: Outcomes MUST stay: `acme_lead` decides in `a_acme` and `c_sales` and not in `core`; a standing edit or review grant that is not a lead grant does not decide; a standing `approve_release` grant does.
- **FR-003**: The author MUST stay denied, including a different letter case and an alias id. Elevation MUST NOT count.
- **FR-004**: `directPublish` MUST keep `can.decide` exactly as on main. It MUST NOT gate on `mayDecide`. Whether publish should ask `mayDecide` instead is a follow-up for Tony. Personal brains, publication mode, the stored edit check, and an agent caller stay as they are.
- **FR-005**: `brainOf` MAY still set `can.decide` for the screen.
- **FR-006**: Grant conditions MUST NOT carry a `lead` mark. Resending the built-in `acme_lead` grants through governance MUST succeed. Governance still rejects an unknown condition.

### Success Criteria

- **SC-001**: The new test fails on `3656037a` because the lead is still a role-id set and direct publish still reads `can.decide`, and it passes after the grant check.
- **SC-002**: Existing lead, release, and self-approval tests pass without a weakened assertion.

### Key Entities

- **Lead role**: a built-in role id derived from that role's grants. For the seeded table, only `acme_lead`.
- **Decision**: allow or deny for one caller and one node. No address and no proposal text.

## Assumptions

- `acme_lead` is the only seeded lead because it is the only built-in role with an edit, review, or manage-members grant that is not `approve_release` and not `own_drafts`.
- The lead mark is not a grant condition. Governance validation is unchanged.
- Changing `directPublish` so it asks `mayDecide` instead of `can.decide` is deferred until Tony decides.
- Restating comments next to `leadOf` and `directPublish` are removed. No test in this slice is deleted: each new assertion fails if the lead grant, the author rule, elevation, `approve_release`, or the loose `can.decide` boolean changes.
- The wider comment and test sweep, the switch table, and the folder move are separate slices.

## Out of scope

Switch route lists, moving `recovered-source/worker` next to `src/state`, and a repo-wide deletion of restating comments or tests. This slice only removes restating comments beside the lead check and direct publish.
