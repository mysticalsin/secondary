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

- [ ] T004 [US1] Add `recovered-source/worker/src/types.ts` as blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` in one commit. The commit message names `db3e8548` plus blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`. No provenance comment in the file. Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a mismatch red test is the only new failure. Covers FR-001, FR-003, FR-004, SC-001.
- [ ] T005 [US1] Add `packages/contracts/src/agent-ui/index.ts` as blob `ed80553761da2db13495c6eb250a438d7ef54327` in one commit. The commit message names `db3e8548` plus blob `ed80553761da2db13495c6eb250a438d7ef54327`. No provenance comment in the file. Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a mismatch red test is the only new failure. Covers FR-001, FR-003, FR-004, SC-001.
- [ ] T006 [US1] Add `packages/contracts/src/view-plan.ts` by copying only blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. After copying, `git hash-object packages/contracts/src/view-plan.ts` must equal `d4b092167f4e1875d0254c98499a979cbd305dd6`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. No provenance comment in the file. Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T007 [US1] Add `recovered-source/worker/src/generated/view-plan.validator.d.ts` by copying only blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. After copying, `git hash-object recovered-source/worker/src/generated/view-plan.validator.d.ts` must equal `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. No provenance comment in the file. Do not edit `recovered-source/worker/src/generated/view-plan.validator.js`. Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T008 [US1] If any of T004–T007 does not lower the worker error count, stop that commit. Do not use `any` or `@ts-ignore`. If the cause is a mismatch, write a new red test. The line 111 rule applies only when the tree contains `harness/runtime/whole-api-causes.test.ts`; if it does and the fix would change line 111, stop and ask. Covers FR-008, SC-004.

---

## Phase 4: User Story 2 - One location and Env names (Priority: P2)

**Goal**: One path per type. Env findings are names only.

**Independent Test**: Path search, tsconfig search, finding log with no secret values.

- [ ] T009 [US2] Show each promoted type at exactly one path. Do not add `reconstruction/` copies. If a copy is present, retarget it to the promoted path or delete it in the same commit. Covers FR-006, SC-003.
- [ ] T010 [US2] Treat `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` as the source of truth. Do not adopt an off-branch wrangler config. Do not add a wrangler or deploy config; that change is out of scope. Check the blob line by line against Env names the code reads. Write findings with names and mismatches only. Covers FR-007, SC-005.
- [ ] T011 [US2] Log the blob's imports of `TenantPolicy` and `Workspace` from `reconstruction/worker-root/` as a mismatch. Do not add a tsconfig path to repair them. Change those import paths to `recovered-source/worker/src/tenant-policy.ts` and `recovered-source/worker/src/workspace.ts` only when those files already export those type names. If an export is missing, or the worker error count rises, stop and ask. Covers FR-005, FR-007.
- [ ] T012 [US2] For a finding that is a real type mismatch, add a red test first, then the fix, with no `any` or `@ts-ignore`. Covers FR-008, Principle V.

---

## Phase 5: User Story 3 - Worker typecheck zero (Priority: P3)

**Goal**: Worker typecheck exits 0. CI is not added while main has none.

**Independent Test**: The three gates on the exact head, with SHA and `npm run typecheck:worker` exit code recorded, and no new CI file.

- [ ] T013 [US3] Continue mismatch fixes under FR-008 until `npm run typecheck:worker` exits 0. Each commit still lowers the count. `npm test` stays 403/0 aside from a required red test that is then made green. Root typecheck stays 0. Covers FR-004, FR-009, SC-001, SC-002.
- [ ] T014 [US3] Apply the line 111 rule only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not contain that file. If a tree contains it, leave line 111 unchanged, and stop and ask if the work would change it. Covers FR-008, SC-004.
- [ ] T015 [US3] Do not add CI here. A CI gate is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head. Covers FR-009, SC-006, Principle IX.
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
- T015 does not add a CI file. Main has no CI system to extend.
- T017 can be drafted while T016 is confirmed. Both read the same head.

## Parallel example: after worker typecheck is 0

```text
T014 Apply the line 111 rule only if the file is in the tree
T015 Stop: main has no CI; do not add any
```

## Implementation strategy

MVP is User Story 1: four promotion commits, each with a lower worker count. User Story 2 adds the single-location check and the Env finding log. User Story 3 reaches 0 and stops without adding CI, because main has none. This spec commit implements none of these tasks.
