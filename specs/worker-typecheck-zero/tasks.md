# Tasks: Worker typecheck zero

**Input**: Design documents from `/specs/worker-typecheck-zero/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/promoted-modules.md, quickstart.md

**Tests**: The standing red is `npm run typecheck:worker`. A new red test is added only for a real mismatch (FR-008): a diagnostic the parent commit does not report. A name finding is not a real mismatch. Do not edit `harness/runtime/whole-api-causes.test.ts`.

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

- [ ] T004 [US1] Add `recovered-source/worker/src/types.ts` by copying only blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`. After copying, `git hash-object recovered-source/worker/src/types.ts` equals `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`. Add no comment. Keep the `NEW RECONSTRUCTION` comment that is already in the blob. This step is what clears TS7053 (`1e8f67c:harness/runtime/whole-api-causes.test.ts:114`, `PERSONAS[s.persona]` in `admin/routes.ts`, line 910 in that record and line 914 on this branch) and the TS7006 at `ux/notify.ts:45` (`:116` in that record: org-role types). Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-003, FR-004, SC-001.
- [ ] T005 [US1] Add only the barrel `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` by copying blob `ed80553761da2db13495c6eb250a438d7ef54327`. Do not promote `./schemas.ts`, `./library.ts`, `./view.ts`, `./lock.ts`, or `./planner.ts`. Those already exist only at `recovered-source/shared/packages/contracts/src/agent-ui/` with blobs `3676979bf3ef060c63fb6d5c80ffaa561e140508`, `405d7b636c03bc33e661e8c67aaa68ea42933b25`, `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3`, `3c6dd1f623748116c28caaf7c0e64cfe1ef46019`, and `98cb0da3fe5ddced279b0c96c30724667dcbb6a9`. Leave those five blobs unchanged. The barrel's relative exports point at them. `packages` stays the symlink `79a67f92b7f877ab356884d89c0d307bdf2a9e83`, so `packages/contracts/src/agent-ui/index.ts` is the same file and not a second home. After copying, `git hash-object recovered-source/shared/packages/contracts/src/agent-ui/index.ts` equals `ed80553761da2db13495c6eb250a438d7ef54327`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `ed80553761da2db13495c6eb250a438d7ef54327`. Add no comment. Keep the blob's `NEW RECONSTRUCTION` comment. This step is what clears TS2366 at `recovered-source/worker/src/agent/tools.ts:260` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:115`). Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-003, FR-006, SC-001, SC-003.
- [ ] T006 [US1] Add `recovered-source/shared/packages/contracts/src/view-plan.ts` by copying only blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. The worker import `packages/contracts/src/view-plan.ts` is that same file through the `packages` symlink. Do not replace the symlink and do not write a second copy. After copying, `git hash-object recovered-source/shared/packages/contracts/src/view-plan.ts` equals `d4b092167f4e1875d0254c98499a979cbd305dd6`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. Add no comment. Keep the blob's `NEW RECONSTRUCTION` comment. This step is what clears the TS7006 at `recovered-source/worker/src/ai/planner.ts:38` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:116`, missing ViewPlan). Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T007 [US1] Add `recovered-source/worker/src/generated/view-plan.validator.d.ts` by copying only blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. After copying, `git hash-object recovered-source/worker/src/generated/view-plan.validator.d.ts` equals `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. No merge or cherry-pick of `db3e8548`. The commit message names `db3e8548` plus blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. Add no comment. Keep the blob's `NEW RECONSTRUCTION` comment. Do not edit `recovered-source/worker/src/generated/view-plan.validator.js`. This step is what clears TS7016 at `recovered-source/worker/src/genui.ts:10` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:113`). Worker error count lower than the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T008 [US1] If any of T004–T007 does not lower the worker error count, stop that commit. Do not use `any` or `@ts-ignore`. If the commit reports a diagnostic the parent does not report, that is a real mismatch: write a red test that names its file, line, and TS code, then stop. The line 111 rule applies only when the tree contains `harness/runtime/whole-api-causes.test.ts`; if it does and the fix would change line 111, stop and ask. Covers FR-008, SC-004.

---

## Phase 4: User Story 2 - One location and Env names (Priority: P2)

**Goal**: One path per type. Env findings are names only.

**Independent Test**: Path search, tsconfig search, finding log with no secret values.

- [ ] T009 [US2] Check one path per type with the contract table only: `git rev-parse HEAD:<git path>` equals that row's blob. The five agent-ui sibling blobs are unchanged. A name re-exported by the barrel is not a duplicate. Do not add `reconstruction/` copies. Do not replace the `packages` symlink. Covers FR-006, SC-003.
- [ ] T010 [US2] Treat `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` as the source of truth for `interface Env` member names. Do not adopt an off-branch wrangler config. Do not add a wrangler or deploy config; that change is out of scope. Diff those member names against worker `env.<name>` reads. The symmetric difference is a name finding, not a real mismatch. Write findings with names only. Covers FR-007, FR-008, SC-005.
- [ ] T011 [US2] Write `recovered-source/worker/src/env.d.ts` with the blob's `interface Env` members. Do not copy `./worker-root/worker/src/tenant-policy.ts` or `./worker-root/worker/src/workspace.ts`. The imports are exactly `import type { TenantPolicy } from "./tenant-policy.ts";` and `import type { Workspace } from "./workspace.ts";`. Before writing, confirm `recovered-source/worker/src/tenant-policy.ts:152` is `export class TenantPolicy extends DurableObject<Env> {` and `recovered-source/worker/src/workspace.ts:172` is `export class Workspace extends BrainBase {`. If either line is not that export, stop. The written file contains no `reconstruction/` path and no `worker-root/` path. No tsconfig path is added. `git hash-object` of this file is not required to equal `841f0dbc97ac`. This step is what clears TS2322 at `recovered-source/worker/src/stubs.ts:33` and `:42` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:117`) and the TS7006 at `recovered-source/worker/src/auth/config.ts:54` (`:116` in that record: missing Env). Do not edit `stubs.ts`. Worker error count lower than the parent. Covers FR-005, FR-007, FR-004.
- [ ] T012 [US2] A name finding gets no red test. A real mismatch, a diagnostic the parent does not report, gets a red test that names its file, line, and TS code, then the fix, with no `any` or `@ts-ignore`. Covers FR-008, Principle V.

---

## Phase 5: User Story 3 - Worker typecheck zero (Priority: P3)

**Goal**: Worker typecheck exits 0. CI is not added while main has none.

**Independent Test**: The three gates on the exact head, with SHA and `npm run typecheck:worker` exit code recorded, and no new CI file.

- [ ] T013 [US3] The remaining baseline codes, and the step that clears each, are these. Citations are `1e8f67c:harness/runtime/whole-api-causes.test.ts`. Lines :114–117 are the four cause records named below after TS7016; TS7016 is the preceding record at :113. TS7053 at :114 (`admin/routes.ts`, `PERSONAS[s.persona]`, line 910 in that record and line 914 on this branch) is cleared by T004. TS2366 at :115 (`agent/tools.ts:260`) is cleared by T005. TS7006 at :116 splits three ways: `ai/planner.ts:38` by T006, `ux/notify.ts:45` by T004, `auth/config.ts:54` by T011. TS2322 at :117 (`stubs.ts:33` and `:42`) is cleared by T011. TS7016 at :113 (`genui.ts:10`) is cleared by T007. TS2304 at :111 (count 68, no `Env`) is cleared by T011. TS2307 at :112 (count 43, missing `types.ts`, `agent-ui/index.ts`, and `view-plan.ts`) is cleared by T004, T005, and T006 as each file appears. If one of those diagnostics is still reported after its step, stop. Do not pick a different step. After those steps, continue only for a real mismatch under FR-008 until `npm run typecheck:worker` exits 0. Each commit still lowers the count. `npm test` stays 403/0 aside from a required red test that is then made green. Root typecheck stays 0. Covers FR-004, FR-008, FR-009, SC-001, SC-002.
- [ ] T014 [US3] Apply the line 111 rule only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not contain that file. If a tree contains it, leave line 111 unchanged, and stop and ask if the work would change it. Covers FR-008, SC-004.
- [ ] T015 [US3] Do not attach CI because Tony named a file. That wording is withdrawn. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head. Covers FR-009, SC-006, Principle IX.
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
