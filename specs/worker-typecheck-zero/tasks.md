# Tasks: Worker typecheck zero

**Input**: Design documents from `/specs/worker-typecheck-zero/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/promoted-modules.md, quickstart.md

**Tests**: The standing red is `npm run typecheck:worker`. A new red test is added only for a real mismatch (FR-008). Do not edit `harness/runtime/whole-api-causes.test.ts`.

**Organization**: Tasks follow the user stories. Implementation is not part of the spec commit that adds this file.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Phase 1: Setup

**Purpose**: Confirm the baseline before any type file is added.

- [ ] T001 Record worker typecheck, root typecheck, and `npm test` on `387f2c8b1662283ca74e657ec85f97068c011ab7` in the implementation report. Expected: 119 errors with breakdown TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1; root typecheck 0; `npm test` 403/0. Covers SC-002.

---

## Phase 2: Foundational

**Purpose**: Retrieval rules that every promotion uses. No type file is written in this phase.

- [ ] T002 Confirm `db3e8548` is not merged and that the four blobs in `specs/worker-typecheck-zero/contracts/promoted-modules.md` are readable from the object store. Covers FR-002.
- [ ] T003 Confirm `tsconfig.json` and `tsconfig.worker.json` have no `reconstruction/` path, include, or `preserveSymlinks` entry, and leave them that way. Covers FR-005.

**Checkpoint**: Blobs are readable. Tsconfig is unchanged. No type file has been added.

---

## Phase 3: User Story 1 - Promote each stand-in (Priority: P1)

**Goal**: Four commits, one module each, each with a lower worker error count.

**Independent Test**: Blob id, commit message, worker count, `npm test` 403/0, root typecheck 0.

- [ ] T004 [US1] Add `recovered-source/worker/src/types.ts` as blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` in one commit. Commit message: reconstructed, plus that blob. No provenance comment in the file. Worker error count lower than the parent. Covers FR-001, FR-003, FR-004, SC-001.
- [ ] T005 [US1] Add `packages/contracts/src/agent-ui/index.ts` as blob `ed80553761da2db13495c6eb250a438d7ef54327` in the next commit, with the same provenance and count rules. Covers FR-001, FR-003, FR-004, SC-001.
- [ ] T006 [US1] Add `packages/contracts/src/view-plan.ts` as blob `d4b092167f4e1875d0254c98499a979cbd305dd6`, not blob `82bac154e813b9fa59c2f93e871127e0c37c3b8e`, in the next commit, with the same rules. Covers FR-001, FR-002, FR-004, SC-001.
- [ ] T007 [US1] Add `recovered-source/worker/src/generated/view-plan.validator.d.ts` as blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, not blob `a403845f6cd562a3b2488e0e736aa57aaf57cbd2`, in the next commit. Do not edit `recovered-source/worker/src/generated/view-plan.validator.js`. Covers FR-001, FR-002, FR-004, SC-001.
- [ ] T008 [US1] If any of T004–T007 does not lower the worker error count, stop that commit. Do not use `any` or `@ts-ignore`. If the cause is a mismatch, write a new red test that is not `harness/runtime/whole-api-causes.test.ts`, then stop if fixing it would change line 111 of that file. Covers FR-008, SC-004.

---

## Phase 4: User Story 2 - One location and Env names (Priority: P2)

**Goal**: One path per type. Env findings are names only.

**Independent Test**: Path search, tsconfig search, finding log with no secret values.

- [ ] T009 [US2] Show each promoted type at exactly one path. Do not add `reconstruction/` copies. If a copy is present, retarget it to the promoted path or delete it in the same commit. Covers FR-006, SC-003.
- [ ] T010 [US2] Because no wrangler config is on the branch, do not run `wrangler types`. Check blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` line by line against Env names the code reads. Write findings with names and mismatches only. Covers FR-007, SC-005.
- [ ] T011 [US2] Log the blob's imports of `TenantPolicy` and `Workspace` from `reconstruction/worker-root/` as a mismatch. Do not add a tsconfig path to repair them. Change those import paths to `recovered-source/worker/src/tenant-policy.ts` and `recovered-source/worker/src/workspace.ts` only when those files already export those type names. If an export is missing, or the worker error count rises, stop and ask. Covers FR-005, FR-007.
- [ ] T012 [US2] For a finding that is a real type mismatch, add a red test first, then the fix, with no `any` or `@ts-ignore`. Covers FR-008, Principle V.

---

## Phase 5: User Story 3 - Worker typecheck zero (Priority: P3)

**Goal**: Worker typecheck exits 0. The CI file is not invented.

**Independent Test**: The three gates on the exact head, plus the absence of an unnamed workflow file.

- [ ] T013 [US3] Continue mismatch fixes under FR-008 until `npm run typecheck:worker` exits 0. Each commit still lowers the count. `npm test` stays 403/0 aside from a required red test that is then made green. Root typecheck stays 0. Covers FR-004, FR-009, SC-001, SC-002.
- [ ] T014 [US3] Do not add or edit `harness/runtime/whole-api-causes.test.ts`. If the file is present and line 111 would change, stop and ask. Covers FR-008, SC-004.
- [ ] T015 [US3] Do not add a CI workflow file. Ask Tony which file should require `npm run typecheck:worker` on the exact head. Covers FR-009, SC-006, Principle IX.
- [ ] T016 [US3] Confirm the implementation diff has no runtime, schema, or stored-data change. Covers FR-010, SC-005.

---

## Phase 6: Polish

**Purpose**: QA handoff on the exact head.

- [ ] T017 [P] Run the checks in `specs/worker-typecheck-zero/quickstart.md` and put the head SHA, per-commit counts, and breakdown in the writer report. Covers SC-001, SC-002, Principle VIII.

## Dependencies

- T004–T007 run in that order. Each depends on the previous commit's lower count.
- T009 depends on T004–T007.
- T010 and T011 depend on T009.
- T012 depends on T010.
- T013 depends on T012.
- T014 and T015 depend on T013. T015 does not attach a gate.
- T016 and T017 depend on T013–T015.

## Parallel opportunities

- T014 and T015 touch different checks and can be confirmed in either order after T013.
- T017 can be drafted while T016 is confirmed. Both read the same head.

## Parallel example: after worker typecheck is 0

```text
T014 Confirm line 111 was not edited
T015 Ask Tony for the CI file; do not add one
```

## Implementation strategy

MVP is User Story 1: four promotion commits, each with a lower worker count. User Story 2 adds the single-location check and the Env finding log. User Story 3 reaches 0 and stops at the unnamed CI file. This spec commit implements none of these tasks.
