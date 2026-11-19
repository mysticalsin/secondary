# Tasks: One deny-receipt warning

**Input**: `specs/001-untangle-worker/plan.md` and `spec.md`

**Prerequisites**: Owner accepts this slice. Phase 1 does not implement it.

**Tests**: Required by the constitution before a behavior-preserving edit that could drift. The red test asserts the shared warning and the unchanged 403.

## Format

- **[P]**: Can run in parallel
- **[US1]**: Failed deny receipt uses one warning
- **[US2]**: Switch-off log stays as it is

## Phase 1

- [ ] T001 Confirm `routes.ts` can call the shared warning without an import cycle. If it cannot, stop and record the cycle. [US1]
- [ ] T002 [P] Add a failing test that a governance deny, an action deny, and a question deny each log the same fields and return 403 when the receipt fails. [US1]
- [ ] T003 After T002 is red, add one warning function and replace the four copied `console.warn` calls. Do not change status codes. [US1]
- [ ] T004 [P] Re-run the existing switch-off tests unchanged. They must still see `succeeded`, `refused`, or `timed_out`. [US2]
- [ ] T005 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the implementation head. [US1]

## Dependencies

T003 after T002. T001 before T003. T004 and T005 after T003.

## Not in this task list

Lead-role derivation, switch route tables, folder moves, comment removal, and test removal. Those need a separate spec after the owner chooses.
