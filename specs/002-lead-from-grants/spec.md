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

### User Story 3 - Direct publish asks the same question (Priority: P2)

`directPublish` asks `mayDecide`. It does not read `can.decide`. The wiki caller computes that boolean from `mayDecide` already, and the brain screen computes it with the stored role as well. Publish follows the decision function. A non-lead with the boolean set still does not publish. Personal brains, the publication mode, the stored edit check, and the agent-call refusal stay as they are.

**Why this priority**: The publish rule and the lead rule were split across a boolean.

**Independent Test**: Call `directPublish` for a non-lead whose `can.decide` is true. The result is false.

**Acceptance Scenarios**:

1. **Given** a non-lead and `can.decide` true, **When** direct publish is asked, **Then** the result is false.
2. **Given** a lead and `can.decide` false, **When** the publication mode is review, **Then** the result is false.
3. **Given** a lead and a brain whose publication mode is review, **When** direct publish is asked, **Then** the result is false.

## Requirements

### Functional Requirements

- **FR-001**: Who may decide inside a brain MUST be read from the built-in role table (`roles.ts`), by role id and the grant that covers that brain. A built-in grant with `conditions.lead === true` that includes a standing `edit`, `review`, or `manage_members` on the node is a lead of that node. `mayDecide` MUST NOT read `lead` from the tenant's stored roles. The set `LEAD_ROLES` MUST NOT remain.
- **FR-002**: Outcomes MUST stay: `acme_lead` decides in `a_acme` and `c_sales` and not in `core`; a standing edit or review grant that is not a lead grant does not decide; a standing `approve_release` grant does.
- **FR-003**: The author MUST stay denied, including a different letter case and an alias id. Elevation MUST NOT count.
- **FR-004**: `directPublish` MUST call `mayDecide` for a shared brain. It MUST NOT read `can.decide`. Personal brains, publication mode, the stored edit check, and an agent caller MUST stay as they are. The wiki route's own `need` check is unchanged.
- **FR-005**: `brainOf` MAY still set `can.decide` for the screen. That field is not the publish rule.
- **FR-006**: Seeding a tenant MUST NOT store `conditions.lead`. Governance MUST keep rejecting `lead` as an unknown condition. An edit of `acme_lead` that does not resend grants MUST NOT be `invalid_condition`. A role stored before this mark existed MUST still decide where the built-in role is a lead.

### Success Criteria

- **SC-001**: The new test fails on `3656037a` because the lead is still a role-id set and direct publish still reads `can.decide`, and it passes after the grant check.
- **SC-002**: Existing lead, release, and self-approval tests pass without a weakened assertion.

### Key Entities

- **Lead grant**: a role grant whose conditions include `lead: true`, on a scope the caller holds with a standing decision action.
- **Decision**: allow or deny for one caller and one node. No address and no proposal text.

## Assumptions

- The two grants that make `acme_lead` a lead today (`c_sales` edit, and `a_acme` edit, review, and manage members) are the grants marked `lead` on the built-in role. No other current grant is a lead grant.
- `conditions.lead` is data for this rule on the built-in role only. The policy engine does not read it, so view, edit, and release checks are unchanged. Tenants seeded before the mark keep their old grants. New seeds omit the mark. Governance does not gain a way to set it.
- An `edit` grant limited to `own_drafts` is not marked `lead`.
- Restating comments next to `leadOf` and `directPublish` are removed. No test in this slice is deleted: each new assertion fails if the lead grant, the author rule, elevation, `approve_release`, or the loose `can.decide` boolean changes.
- The wider comment and test sweep, the switch table, and the folder move are separate slices.

## Out of scope

Switch route lists, moving `recovered-source/worker` next to `src/state`, and a repo-wide deletion of restating comments or tests. This slice only removes restating comments beside the lead check and direct publish.
