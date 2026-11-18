# Tasks: Open low fixes

**Input**: `specs/open-low-fixes/plan.md`

**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/identity-boundary.md

**Tests**: FR-001 through FR-010. Red first. One behavior per code commit. T001, T003, and T005 fail on the parent. T002, T004, and T006 make them pass. T007 records status. No task edits `deploy/assets`.

## Phase 1: Specification

- [x] T000 Add this spec set and the constitution patch 1.0.1. No file under `recovered-source/`, `harness/`, or `src/` changes in that commit. Covers FR-011, FR-012.

## Phase 2: Login row (US1)

- [x] T001 [US1] In `harness/tests/oidc-login.test.ts`, change the mismatch test so the query row's nonce stays, and add the IdP-error case and the no-cookie case from the contract. These assertions fail on `c9417c885fc3f12fdcf5201fa15f0e807d50f05d`. Covers FR-001, FR-002, FR-003, FR-004, SC-001. Done in `ee730be`.
- [x] T002 [US1] After T001 is red, edit only the take loop in `recovered-source/worker/src/auth/routes.ts` so `loginStateTake` receives the cookie state's hash and no other hash. T001 passes. The success test still passes. Covers FR-001, FR-002, FR-003, FR-004. Done in `03b6650`.

## Phase 3: SCIM user name (US2)

- [x] T003 [US2] In `harness/tests/email-identity.test.ts`, add the create, managed sign-in, list, refused rename, allowed case-only rename, and `not_provisioned` assertions from the contract. The create and the managed sign-in fail on the parent. Covers FR-005, FR-006, FR-007, FR-008, FR-009, SC-001. Done in `cded729`.
- [x] T004 [US2] After T003 is red, edit `recovered-source/worker/src/auth/identity-store.ts` only. Create checks the folded user name before `ensurePrincipal`. List, managed sign-in, and patch use the same fold. Patch excludes the row being updated. T003 passes. Existing email-identity tests stay passing. Covers FR-005, FR-006, FR-007, FR-008, FR-009. Done in `68b754b`.

## Phase 4: Unknown switch name (US3)

- [x] T005 [US3] In `harness/tests/kill-switch.test.ts`, insert two unknown switch names and assert one `unknown_name` line that contains neither name, with `mcp` still enabled. This fails on the parent. Covers FR-010, SC-001, SC-004. Done in `33d097a`.
- [x] T006 [US3] After T005 is red, edit `switchState` in `recovered-source/worker/src/tenant-policy.ts` only. One `unknown_name` log per call. No stored name in the line. T005 passes. Covers FR-010. Done in `47a021e`.

## Phase 5: Record and gates

- [x] T007 Mark machines 33, 34, and 36 fixed in `docs/state-machines.md`. In `RECOVERY.md`, state that the 119-error figure is the intake measurement and that `specs/worker-typecheck-zero/closeout.md` records 0. Do not change a recovered byte in this commit. Covers FR-012, SC-004.
- [x] T008 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the final head. Record the counts and exit codes. Covers SC-002, SC-003. Measured after the QA files: `npm test` exit 0, 421 passed, 0 failed, 0 skipped, runner `duration_ms` 4782.987446. `npm run typecheck` exit 0, 0 `error TS` lines, 2485 ms. `npm run typecheck:worker` exit 0, 0 `error TS` lines, 3866 ms. `npm run verify:provenance` exit 0, 161 ms, five `ok` lines.

## Dependencies

- T001, T003, and T005 depend on T000. They do not depend on each other.
- T002 depends on T001 being red. T004 depends on T003 being red. T006 depends on T005 being red.
- T007 depends on T002, T004, and T006.
- T008 depends on T007.

## Parallel example

```text
T001 Login red test
T003 SCIM red test
T005 Switch red test
```

The three red tests touch different files and can be written in either order. Each green commit waits on its own red test.
