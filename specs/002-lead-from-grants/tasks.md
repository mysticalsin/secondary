# Tasks: Lead from the role grant

**Input**: `specs/002-lead-from-grants/plan.md` and `spec.md`

**Prerequisites**: Tony approved this refactor. The parent head is `3656037a`.

**Tests**: The red test pins who decides today and fails until the lead comes from the grant and direct publish stops reading `can.decide`.

## Format

- **[US1]**: The lead is a grant
- **[US2]**: Author, alias, and elevation stay closed
- **[US3]**: Direct publish asks `mayDecide`

## Phase 1

- [x] T001 Write `specs/002-lead-from-grants/` and record Tony's decision on the untangle log. [US1]
- [ ] T002 Add a failing test for the pinned decisions, the loose `can.decide` boolean, and the single grant source. [US1] [US2] [US3]
- [ ] T003 After T002 is red, mark the two `acme_lead` lead grants, derive the decision from them, and make `directPublish` call `mayDecide`. [US1] [US3]
- [ ] T004 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the implementation head. [US1]

## Dependencies

T002 after T001. T003 after T002. T004 after T003.

## Not in this task list

Switch route lists, the folder move, comment deletion, and test deletion.
