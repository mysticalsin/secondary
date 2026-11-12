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

**Goal**: `env.d.ts` first, then four module commits. Each count is lower than its parent, and no commit adds an `error TS` line.

**Independent Test**: The header checks, the commit message, worker count, no new `error TS` line, `npm test` 403/0, root typecheck 0.

- [ ] T011 [US2] Write `recovered-source/worker/src/env.d.ts` from blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` before T004. This task does not wait for T004–T010. Remove only the leading provenance comment. N is 9. No blank line follows that comment. `git cat-file -p 841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d | tail -n +10 | git hash-object --stdin` equals `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. `git cat-file -p 841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d | head -n 9` contains only comment lines and blank lines. The committed file is that tail with exactly two import lines replaced and no other byte changed: `import type { TenantPolicy } from "./worker-root/worker/src/tenant-policy.ts";` becomes `import type { TenantPolicy } from "./tenant-policy.ts";`, and `import type { Workspace } from "./worker-root/worker/src/workspace.ts";` becomes `import type { Workspace } from "./workspace.ts";`. `git hash-object` of the committed file is therefore not `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` and not `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. Before writing, confirm `recovered-source/worker/src/tenant-policy.ts:152` is `export class TenantPolicy extends DurableObject<Env> {` and `recovered-source/worker/src/workspace.ts:172` is `export class Workspace extends BrainBase {`. If either line is not that export, stop. The written file contains no `reconstruction/` path and no `worker-root/` path. No tsconfig path is added. Do not edit `stubs.ts`. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`, N=9, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * `Env` is a global in the recovered Worker and no `wrangler.jsonc` was recovered,
 * so `wrangler types` cannot regenerate the original interface. Property names are
 * the ones recovered code reads. Bindings the code null-checks stay optional.
 * Secret names are optional strings with no values. Replace this file if a later
 * intake contains the original generated types.
 */
```

Gate: no `error TS` line (file, line, column, and TS code) appears that the parent does not report, and the worker count is lower than the parent. If `env.d.ts` references an undeclared name, stop and report that diagnostic. Do not waive it. This step is what clears TS2304 (no `Env`, `1e8f67c:harness/runtime/whole-api-causes.test.ts:111`), TS2322 at `recovered-source/worker/src/stubs.ts:33` and `:42` (`:117`), and the TS7006 at `recovered-source/worker/src/auth/config.ts:54` (`:116`). `ux/notify.ts:45` is not this step. Covers FR-003, FR-004, FR-005, FR-007.

- [ ] T004 [US1] Add `recovered-source/worker/src/types.ts` from blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` after T011. Remove only the leading provenance comment. N is 8. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, N=8, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * The API Worker imports `./types.ts` and that file was not in either source-map
 * intake. Connector `worker/src/types.ts` is a different module (source registry
 * records) and is not this file. Shapes below are the fields recovered call sites
 * read and write. Replace this file if a later intake contains the original.
 */
```

QA: `git cat-file -p e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e | tail -n +9 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/worker/src/types.ts`. `git cat-file -p e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e | head -n 8` contains only comment lines and blank lines. This step is what clears TS7053 at `recovered-source/worker/src/admin/routes.ts:914` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:114`; that record names line 910). `ux/notify.ts:45` is TS7006 at parent `a4a721a7`, not TS7053, and this step clears that TS7006 (`:116` in that record). T004's parent is the T011 head (48 `error TS` lines expected from the T011 dry run at `f21513b9`). T004 lowers that count and adds no new `error TS` line versus that head. The `types.ts(37,13)` TS2304 `Env` seen when `types.ts` was tried without `env.d.ts` must not appear. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T005 [US1] Add only the barrel `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` from blob `ed80553761da2db13495c6eb250a438d7ef54327`. Do not promote `./schemas.ts`, `./library.ts`, `./view.ts`, `./lock.ts`, or `./planner.ts`. Those already exist only at `recovered-source/shared/packages/contracts/src/agent-ui/` with blobs `3676979bf3ef060c63fb6d5c80ffaa561e140508`, `405d7b636c03bc33e661e8c67aaa68ea42933b25`, `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3`, `3c6dd1f623748116c28caaf7c0e64cfe1ef46019`, and `98cb0da3fe5ddced279b0c96c30724667dcbb6a9`. Leave those five blobs unchanged. The barrel's relative exports point at them. `packages` stays the symlink `79a67f92b7f877ab356884d89c0d307bdf2a9e83`, so `packages/contracts/src/agent-ui/index.ts` is the same file and not a second home. Remove only the leading provenance comment. N is 7. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `ed80553761da2db13495c6eb250a438d7ef54327`, N=7, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * Recovered agent modules import this barrel. The barrel itself was not in either
 * intake. Every export is a name already declared by a recovered sibling. This
 * file adds no behavior. Replace it if a later intake contains the original barrel.
 */
```

QA: `git cat-file -p ed80553761da2db13495c6eb250a438d7ef54327 | tail -n +8 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/shared/packages/contracts/src/agent-ui/index.ts`. `git cat-file -p ed80553761da2db13495c6eb250a438d7ef54327 | head -n 7` contains only comment lines and blank lines. This step is what clears TS2366 at `recovered-source/worker/src/agent/tools.ts:260` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:115`). Worker error count lower than the parent. No `error TS` line is new versus the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-006, SC-001, SC-003.
- [ ] T006 [US1] Add `recovered-source/shared/packages/contracts/src/view-plan.ts` from blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. The worker import `packages/contracts/src/view-plan.ts` is that same file through the `packages` symlink. Do not replace the symlink and do not write a second copy. Remove only the leading provenance comment. N is 13. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `d4b092167f4e1875d0254c98499a979cbd305dd6`, N=13, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * Both the API and MCP workers import this module as types only. Neither intake
 * contained the file. The component names and props are the API validator schema
 * embedded in recovered `view-plan.validator.js`. The MCP validator names the
 * same eight components and is a different file, not a replacement for this one.
 *
 * Schema rules a type can carry are carried: Table's `anyOf` (nodeId or lens) and
 * `minItems: 1` on `metrics` and `columns`. `components` stays a plain array because
 * recovered `genui.ts` assigns a `ViewPlanComponent[]` variable to it. Patterns,
 * lengths, integer ranges, `uniqueItems`, and upper item counts stay with the validator.
 */
```

QA: `git cat-file -p d4b092167f4e1875d0254c98499a979cbd305dd6 | tail -n +14 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/shared/packages/contracts/src/view-plan.ts`. `git cat-file -p d4b092167f4e1875d0254c98499a979cbd305dd6 | head -n 13` contains only comment lines and blank lines. This step is what clears the TS7006 at `recovered-source/worker/src/ai/planner.ts:38` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:116`, missing ViewPlan). Worker error count lower than the parent. No `error TS` line is new versus the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T007 [US1] Add `recovered-source/worker/src/generated/view-plan.validator.d.ts` from blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. Remove only the leading provenance comment. N is 5. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. Do not edit `recovered-source/worker/src/generated/view-plan.validator.js`. The commit message records `db3e8548`, blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, N=5, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Declaration only, for the recovered generated validator.
 * The JavaScript file is unchanged. This is not an original .d.ts.
 * Names match the module's runtime exports: `validate` and `default` are the same function.
 */
```

QA: `git cat-file -p 5a3b92e373e2ba7c38cc43e9b217719b0f8db13c | tail -n +6 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/worker/src/generated/view-plan.validator.d.ts`. `git cat-file -p 5a3b92e373e2ba7c38cc43e9b217719b0f8db13c | head -n 5` contains only comment lines and blank lines. This step is what clears TS7016 at `recovered-source/worker/src/genui.ts:10` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:113`). Worker error count lower than the parent. No `error TS` line is new versus the parent. `npm test` is 403/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, SC-001.
- [ ] T008 [US1] If any of T004–T007 does not lower the worker error count, stop that commit. If it reports an `error TS` line the parent does not report, that is a regression and a real mismatch: write a red test that names its file, line, and TS code, then stop. Do not use `any` or `@ts-ignore`. The line 111 rule applies only when the tree contains `harness/runtime/whole-api-causes.test.ts`; if it does and the fix would change line 111, stop and ask. Covers FR-004, FR-008, SC-004.

---

## Phase 4: User Story 2 - One location and Env names (Priority: P2)

**Goal**: One path per type. Env findings are names only.

**Independent Test**: Path search, tsconfig search, finding log with no secret values.

- [ ] T009 [US2] Check one path per type with the contract table only. For each promoted file, the tail check equals `git rev-parse HEAD:<git path>`. That hash is not the source blob. The five agent-ui sibling blobs are unchanged. A name re-exported by the barrel is not a duplicate. Do not add `reconstruction/` copies. Do not replace the `packages` symlink. T011 has already written `env.d.ts`. Covers FR-006, SC-003.
- [ ] T010 [US2] Treat `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` as the source of truth for `interface Env` member names. Do not adopt an off-branch wrangler config. Do not add a wrangler or deploy config; that change is out of scope. Diff those member names against worker `env.<name>` reads. The symmetric difference is a name finding, not a real mismatch. Write findings with names only. Covers FR-007, FR-008, SC-005.
- [ ] T012 [US2] A name finding gets no red test. A real mismatch, a diagnostic the parent does not report, gets a red test that names its file, line, and TS code, then the fix, with no `any` or `@ts-ignore`. A new `error TS` line is not waived. Covers FR-008, Principle V.

---

## Phase 5: User Story 3 - Worker typecheck zero (Priority: P3)

**Goal**: Worker typecheck exits 0. CI is not added while main has none.

**Independent Test**: The three gates on the exact head, with SHA and `npm run typecheck:worker` exit code recorded, and no new CI file.

- [ ] T013 [US3] The remaining baseline codes, and the step that clears each, are these. Citations are `1e8f67c:harness/runtime/whole-api-causes.test.ts`. Lines :114–117 are the four cause records named below after TS7016; TS7016 is the preceding record at :113. TS7053 at :114 is only `admin/routes.ts` (`PERSONAS[s.persona]`, line 910 in that record and line 914 on this branch) and is cleared by T004. `ux/notify.ts:45` is TS7006 at parent `a4a721a7`, not TS7053. TS2366 at :115 (`agent/tools.ts:260`) is cleared by T005. TS7006 at :116 splits three ways: `ai/planner.ts:38` by T006, `ux/notify.ts:45` by T004, `auth/config.ts:54` by T011. TS2322 at :117 (`stubs.ts:33` and `:42`) is cleared by T011. TS7016 at :113 (`genui.ts:10`) is cleared by T007. TS2304 at :111 (count 68, no `Env`) is cleared by T011. TS2307 at :112 (count 43, missing `types.ts`, `agent-ui/index.ts`, and `view-plan.ts`) is cleared by T004, T005, and T006 as each file appears. If one of those diagnostics is still reported after its step, stop. Do not pick a different step. After those steps, continue only for a real mismatch under FR-008 until `npm run typecheck:worker` reports 0 `error TS` lines. Each commit still lowers the count, and no commit adds an `error TS` line the parent does not report. `npm test` stays 403/0 aside from a required red test that is then made green. Root typecheck stays 0. Covers FR-004, FR-008, FR-009, SC-001, SC-002.
- [ ] T014 [US3] Apply the line 111 rule only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not contain that file. If a tree contains it, leave line 111 unchanged, and stop and ask if the work would change it. Covers FR-008, SC-004.
- [ ] T015 [US3] Do not attach CI because Tony named a file. That wording is withdrawn. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head. Covers FR-009, SC-006, Principle IX.
- [ ] T016 [US3] Confirm the implementation diff has no runtime, schema, or stored-data change. Covers FR-010, SC-005.

---

## Phase 6: Polish

**Purpose**: QA handoff on the exact head.

- [ ] T017 [P] Run the checks in `specs/worker-typecheck-zero/quickstart.md` and put the head SHA, per-commit counts, and breakdown in the writer report. The closeout lists every one-sided Env finding from T010. A finding is resolved when the final name-set difference no longer contains that name. A finding is waived only when the closeout prints that name and the word waived. Do not call the head done until `npm run typecheck:worker` reports 0 errors and every remaining one-sided name is waived. Covers SC-001, SC-002, SC-005, Principle VIII.

## Dependencies

Checked after moving T011 ahead of T004. No task needs a file that a later task creates.

- T011 depends on T002 and T003 only. It does not depend on T004–T010.
- T004 depends on T011. T005 depends on T004. T006 depends on T005. T007 depends on T006.
- T008 applies to T004–T007. T011's stop rule is on T011.
- T009 depends on T004–T007, which already depend on T011.
- T010 depends on T009.
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

The first implementation commit is T011. T004 then T007 follow. User Story 2's path check and name log stay after those files exist. User Story 3 reaches 0 and stops without adding CI, because main has none. This spec commit implements none of these tasks. A new `error TS` line is not waived.
