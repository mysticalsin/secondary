# Tasks: One switch table

**Input**: `specs/003-switch-table/plan.md` and `spec.md`

**Prerequisites**: Tony approved this refactor. The base is main `8d8ab548`.

**Tests**: The switch-gate matrix is generated from main before the table moves. The head deep-equals it.

## Format

- **[US1]**: One declaration
- **[US2]**: Other answers stay

## Phase 1

- [x] T001 Write `specs/003-switch-table/` and record the slice in the untangle decision log. [US1]
- [x] T002 Generate the switch-gate matrix from main and commit it with a test that deep-equals it. [US1] [US2]
- [x] T003 After T002, move the matchers and handler keys into one table. Handlers read the name from that table and keep their current body. [US1] [US2]
- [x] T004 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the head. [US1]

## Dependencies

T002 after T001. T003 after T002. T004 after T003.

## Not in this task list

Lead derivation, the folder move, and a repo-wide deletion of comments or tests.
