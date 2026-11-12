# Tasks: Worker typecheck zero

**Input**: Design documents from `/specs/worker-typecheck-zero/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/promoted-modules.md, quickstart.md

**Tests**: The standing red is `npm run typecheck:worker`. A new red test is added only for a real mismatch (FR-008): a diagnostic the parent commit does not report. A name finding is not a real mismatch. Do not edit `harness/runtime/whole-api-causes.test.ts`. T018 edits `harness/tests/intake.test.ts` and adds one passing test. That test is not a red mismatch test.

**Organization**: Tasks follow the user stories. Implementation is not part of the spec commit that adds this file.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Phase 1: Setup

**Purpose**: Confirm the baseline before any type file is added.

- [x] T001 Record worker typecheck, root typecheck, and `npm test` on `387f2c8b1662283ca74e657ec85f97068c011ab7` in the implementation report. Expected: 119 errors with breakdown TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1; root typecheck 0; `npm test` 403/0. That 403 is the baseline before T018. The final head in SC-002 is 404/0. Covers SC-002.

---

## Phase 2: Foundational

**Purpose**: Retrieval rules that every promotion uses, then the manifest test that promotions require. No type file is written in this phase.

- [x] T002 Confirm `db3e8548` is not merged and that the four blobs in `specs/worker-typecheck-zero/contracts/promoted-modules.md` are readable from the object store. Covers FR-002.
- [x] T003 Confirm `tsconfig.json` and `tsconfig.worker.json` have no `reconstruction/` path, include, or `preserveSymlinks` entry, and leave them that way. Covers FR-005.
- [x] T018 Update `harness/tests/intake.test.ts` and add `reconstructed-manifest.json` at the repository root, beside `candidate-manifest.json`. This task depends on the head of this spec amendment. It does not wait for T001–T017. The commit contains those two paths and no other. `candidate-manifest.json` is not edited. The reconstructed file parses as `{ "files": [] }`. No test is deleted and no existing assertion is dropped. The archive, provenance, and candidate-manifest sha256 checks stay. The candidate counts stay 117 files, 1227833 source bytes, and 165 excluded third-party files. A `PATCHED_RECOVERED` path stays in the candidate manifest and its sha256 stays different from the intake sha256. Every other candidate path still matches the intake byte length and sha256. The updated recovered-source check asserts the walk equals the union of the two path sets, the two sets are disjoint, and each reconstructed sha256 equals its file. The symlink test keeps its three `ENOENT` checks. `recovered-source/worker/src/types.ts` throws `ENOENT` until T004 lists that path. `packages/contracts/src/agent-ui/index.ts` throws `ENOENT` until T005 lists the agent-ui barrel git path, the same file through the `packages` symlink. `packages/contracts/src/view-plan.ts` throws `ENOENT` until T006 lists the view-plan git path, the same file through that symlink. On this commit all three still throw `ENOENT`. One new test passes the walk plus `recovered-source/worker/src/__unlisted__.ts` into that comparison and the comparison fails. That path is not written to disk. The new test passes. On this commit the empty reconstructed list passes. `npm test` is 404 passed and 0 failed, which is 403 plus that one test. Worker typecheck stays 119, with the same breakdown as the parent. Root typecheck is 0. No `error TS` line is new. Covers FR-011, SC-002, SC-007.

**Checkpoint**: Blobs are readable. Tsconfig is unchanged. The reconstructed manifest exists and its `files` array is empty. No type file has been added.

---

## Phase 3: User Story 1 - Promote each stand-in (Priority: P1)

**Goal**: `env.d.ts` first, then four module commits. Each promotion count is lower than its parent, and no commit adds an `error TS` line. Each of those commits also appends one reconstructed-manifest entry.

**Independent Test**: The header checks, the commit message, the one manifest entry, worker count, no new `error TS` line, `npm test` 404/0, root typecheck 0.

- [x] T011 [US2] Write `recovered-source/worker/src/env.d.ts` from blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` before T004. This task does not wait for T004–T010. Remove only the leading provenance comment. N is 9. No blank line follows that comment. `git cat-file -p 841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d | tail -n +10 | git hash-object --stdin` equals `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. `git cat-file -p 841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d | head -n 9` contains only comment lines and blank lines. The committed file is that tail with exactly two import lines replaced and no other byte changed: `import type { TenantPolicy } from "./worker-root/worker/src/tenant-policy.ts";` becomes `import type { TenantPolicy } from "./tenant-policy.ts";`, and `import type { Workspace } from "./worker-root/worker/src/workspace.ts";` becomes `import type { Workspace } from "./workspace.ts";`. `git hash-object` of the committed file is therefore not `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` and not `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. Before writing, confirm `recovered-source/worker/src/tenant-policy.ts:152` is `export class TenantPolicy extends DurableObject<Env> {` and `recovered-source/worker/src/workspace.ts:172` is `export class Workspace extends BrainBase {`. If either line is not that export, stop. The written file contains no `reconstruction/` path and no `worker-root/` path. No tsconfig path is added. Do not edit `stubs.ts`. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`, N=9, and this header verbatim:

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

The commit contains `recovered-source/worker/src/env.d.ts` and `reconstructed-manifest.json`, and no other path. It appends exactly one entry: `path` `recovered-source/worker/src/env.d.ts`, `sourceCommit` `db3e8548`, `sourceBlob` `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`, `n` 9, `sha256` `bdc26d8aa6b926d01eda5b0db807105a9be071f424a375243fca799152521f24`, and `byteEdits` the two FR-007 import lines in file order. QA checks that entry against the file. The typecheck gate is unchanged: no `error TS` line (file, line, column, and TS code) appears that the parent does not report, and the worker count is lower than the parent. If `env.d.ts` references an undeclared name, stop and report that diagnostic. Do not waive it. This step is what clears TS2304 (no `Env`, `1e8f67c:harness/runtime/whole-api-causes.test.ts:111`), TS2322 at `recovered-source/worker/src/stubs.ts:33` and `:42` (`:117`), and the TS7006 at `recovered-source/worker/src/auth/config.ts:54` (`:116`). `ux/notify.ts:45` is not this step. `npm test` is 404/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-003, FR-004, FR-005, FR-007, FR-011.

- [x] T004 [US1] Add `recovered-source/worker/src/types.ts` from blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` after T011. Remove only the leading provenance comment. N is 8. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, N=8, and this header verbatim:

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

QA: `git cat-file -p e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e | tail -n +9 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/worker/src/types.ts`. `git cat-file -p e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e | head -n 8` contains only comment lines and blank lines. This step is what clears TS7053 at `recovered-source/worker/src/admin/routes.ts:914` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:114`; that record names line 910). `ux/notify.ts:45` is TS7006 at parent `a4a721a7`, not TS7053, and this step clears that TS7006 (`:116` in that record). T004's parent is the T011 head (48 `error TS` lines expected from the T011 dry run at `f21513b9`). T004 lowers that count and adds no new `error TS` line versus that head. The `types.ts(37,13)` TS2304 `Env` seen when `types.ts` was tried without `env.d.ts` must not appear. The commit contains `recovered-source/worker/src/types.ts` and `reconstructed-manifest.json`, and no other path. It appends exactly one entry: `path` `recovered-source/worker/src/types.ts`, `sourceCommit` `db3e8548`, `sourceBlob` `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, `n` 8, `sha256` `f228c68d1cab935ee52553f1f6e8f1a82120a25987259ab6811ba9780a401780`, and `byteEdits` `[]`. QA checks that entry against the file. The typecheck gate is unchanged. `npm test` is 404/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, FR-011, SC-001.
- [x] T005 [US1] Add only the barrel `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` from blob `ed80553761da2db13495c6eb250a438d7ef54327`. Do not promote `./schemas.ts`, `./library.ts`, `./view.ts`, `./lock.ts`, or `./planner.ts`. Those already exist only at `recovered-source/shared/packages/contracts/src/agent-ui/` with blobs `3676979bf3ef060c63fb6d5c80ffaa561e140508`, `405d7b636c03bc33e661e8c67aaa68ea42933b25`, `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3`, `3c6dd1f623748116c28caaf7c0e64cfe1ef46019`, and `98cb0da3fe5ddced279b0c96c30724667dcbb6a9`. Leave those five blobs unchanged. The barrel's relative exports point at them. `packages` stays the symlink `79a67f92b7f877ab356884d89c0d307bdf2a9e83`, so `packages/contracts/src/agent-ui/index.ts` is the same file and not a second home. Remove only the leading provenance comment. N is 7. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `ed80553761da2db13495c6eb250a438d7ef54327`, N=7, and this header verbatim:

```
/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * Recovered agent modules import this barrel. The barrel itself was not in either
 * intake. Every export is a name already declared by a recovered sibling. This
 * file adds no behavior. Replace it if a later intake contains the original barrel.
 */
```

QA: `git cat-file -p ed80553761da2db13495c6eb250a438d7ef54327 | tail -n +8 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/shared/packages/contracts/src/agent-ui/index.ts`. `git cat-file -p ed80553761da2db13495c6eb250a438d7ef54327 | head -n 7` contains only comment lines and blank lines. This step is what clears TS2366 at `recovered-source/worker/src/agent/tools.ts:260` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:115`). Worker error count lower than the parent. No `error TS` line is new versus the parent. The commit contains `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` and `reconstructed-manifest.json`, and no other path. It appends exactly one entry: `path` `recovered-source/shared/packages/contracts/src/agent-ui/index.ts`, `sourceCommit` `db3e8548`, `sourceBlob` `ed80553761da2db13495c6eb250a438d7ef54327`, `n` 7, `sha256` `8a14fe9709426880d937495fda805c8f8f58ef2f1ea222d36c98b6bd2988f1e5`, and `byteEdits` `[]`. QA checks that entry against the file. The typecheck gate is unchanged. `npm test` is 404/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-006, FR-011, SC-001, SC-003.
- [x] T006 [US1] Add `recovered-source/shared/packages/contracts/src/view-plan.ts` from blob `d4b092167f4e1875d0254c98499a979cbd305dd6`. The worker import `packages/contracts/src/view-plan.ts` is that same file through the `packages` symlink. Do not replace the symlink and do not write a second copy. Remove only the leading provenance comment. N is 13. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. The commit message records `db3e8548`, blob `d4b092167f4e1875d0254c98499a979cbd305dd6`, N=13, and this header verbatim, and that landed message is not rewritten. The manifest `sourceCommit` is `be6eb37f31e62f0f04a610202cca120aa4d9302f`:

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

QA: `git cat-file -p d4b092167f4e1875d0254c98499a979cbd305dd6 | tail -n +14 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/shared/packages/contracts/src/view-plan.ts`. `git cat-file -p d4b092167f4e1875d0254c98499a979cbd305dd6 | head -n 13` contains only comment lines and blank lines. This step is what clears the TS7006 at `recovered-source/worker/src/ai/planner.ts:38` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:116`, missing ViewPlan). Worker error count lower than the parent. No `error TS` line is new versus the parent. The commit contains `recovered-source/shared/packages/contracts/src/view-plan.ts` and `reconstructed-manifest.json`, and no other path. It appends exactly one entry: `path` `recovered-source/shared/packages/contracts/src/view-plan.ts`, `sourceCommit` `be6eb37f31e62f0f04a610202cca120aa4d9302f`, `sourceBlob` `d4b092167f4e1875d0254c98499a979cbd305dd6`, `n` 13, `sha256` `48ed77b571d3a6ec2946f967ce1045012d10e2641aa9eced8e8c53c2287171bd`, and `byteEdits` `[]`. QA checks that entry against the file. The typecheck gate is unchanged. `npm test` is 404/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, FR-011, SC-001.
- [x] T007 [US1] Add `recovered-source/worker/src/generated/view-plan.validator.d.ts` from blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. Remove only the leading provenance comment. N is 5. No blank line follows that comment. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. No merge or cherry-pick of `db3e8548`. Do not edit `recovered-source/worker/src/generated/view-plan.validator.js`. The commit message records `db3e8548`, blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, N=5, and this header verbatim, and that landed message is not rewritten. The manifest `sourceCommit` is `4ba133b04e49cfb20abe0a22b5ca367284456356`:

```
/**
 * NEW RECONSTRUCTION. Declaration only, for the recovered generated validator.
 * The JavaScript file is unchanged. This is not an original .d.ts.
 * Names match the module's runtime exports: `validate` and `default` are the same function.
 */
```

QA: `git cat-file -p 5a3b92e373e2ba7c38cc43e9b217719b0f8db13c | tail -n +6 | git hash-object --stdin` equals `git rev-parse HEAD:recovered-source/worker/src/generated/view-plan.validator.d.ts`. `git cat-file -p 5a3b92e373e2ba7c38cc43e9b217719b0f8db13c | head -n 5` contains only comment lines and blank lines. This step is what clears TS7016 at `recovered-source/worker/src/genui.ts:10` (`1e8f67c:harness/runtime/whole-api-causes.test.ts:113`). Worker error count lower than the parent. No `error TS` line is new versus the parent. The commit contains `recovered-source/worker/src/generated/view-plan.validator.d.ts` and `reconstructed-manifest.json`, and no other path. It appends exactly one entry: `path` `recovered-source/worker/src/generated/view-plan.validator.d.ts`, `sourceCommit` `4ba133b04e49cfb20abe0a22b5ca367284456356`, `sourceBlob` `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, `n` 5, `sha256` `0513896be9395d9263661cb846388067d5f7fff021056ed6e844c2adcff652bf`, and `byteEdits` `[]`. QA checks that entry against the file. The typecheck gate is unchanged. `npm test` is 404/0 and root typecheck is 0 unless a real-mismatch red test is the only new failure. Covers FR-001, FR-002, FR-003, FR-004, FR-011, SC-001.
- [x] T008 [US1] If any of T004–T007 does not lower the worker error count, stop that commit. If it reports an `error TS` line the parent does not report, that is a regression and a real mismatch: write a red test that names its file, line, and TS code, then stop. Do not use `any` or `@ts-ignore`. The line 111 rule applies only when the tree contains `harness/runtime/whole-api-causes.test.ts`; if it does and the fix would change line 111, stop and ask. Covers FR-004, FR-008, SC-004.

---

## Phase 4: User Story 2 - One location and Env names (Priority: P2)

**Goal**: One path per type. Env findings are names only.

**Independent Test**: Path search, tsconfig search, finding log with no secret values.

- [x] T009 [US2] Check one path per type with the contract table only. For each promoted file, the tail check equals `git rev-parse HEAD:<git path>`. That hash is not the source blob. The five agent-ui sibling blobs are unchanged. A name re-exported by the barrel is not a duplicate. Do not add `reconstruction/` copies. Do not replace the `packages` symlink. T011 has already written `env.d.ts`. Covers FR-006, SC-003.
- [x] T010 [US2] Treat `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` as the source of truth for `interface Env` member names. Do not adopt an off-branch wrangler config. Do not add a wrangler or deploy config; that change is out of scope. Diff those member names against worker `env.<name>` reads. The symmetric difference is a name finding, not a real mismatch. Write findings with names only. Covers FR-007, FR-008, SC-005.
- [x] T012 [US2] A name finding gets no red test. A real mismatch, a diagnostic the parent does not report, gets a red test that names its file, line, and TS code, then the fix, with no `any` or `@ts-ignore`. A new `error TS` line is not waived. Covers FR-008, Principle V.

---

## Phase 5: User Story 3 - Worker typecheck zero (Priority: P3)

**Goal**: Worker typecheck exits 0. CI is not added while main has none.

**Independent Test**: The three gates on the exact head, with SHA and `npm run typecheck:worker` exit code recorded, and no new CI file.

- [x] T013 [US3] The remaining baseline codes, and the step that clears each, are these. Citations are `1e8f67c:harness/runtime/whole-api-causes.test.ts`. Lines :114–117 are the four cause records named below after TS7016; TS7016 is the preceding record at :113. TS7053 at :114 is only `admin/routes.ts` (`PERSONAS[s.persona]`, line 910 in that record and line 914 on this branch) and is cleared by T004. `ux/notify.ts:45` is TS7006 at parent `a4a721a7`, not TS7053. TS2366 at :115 (`agent/tools.ts:260`) is cleared by T005. TS7006 at :116 splits three ways: `ai/planner.ts:38` by T006, `ux/notify.ts:45` by T004, `auth/config.ts:54` by T011. TS2322 at :117 (`stubs.ts:33` and `:42`) is cleared by T011. TS7016 at :113 (`genui.ts:10`) is cleared by T007. TS2304 at :111 (count 68, no `Env`) is cleared by T011. TS2307 at :112 (count 43, missing `types.ts`, `agent-ui/index.ts`, and `view-plan.ts`) is cleared by T004, T005, and T006 as each file appears. If one of those diagnostics is still reported after its step, stop. Do not pick a different step. After those steps, continue only for a real mismatch under FR-008 until `npm run typecheck:worker` reports 0 `error TS` lines. Each commit still lowers the count, and no commit adds an `error TS` line the parent does not report. `npm test` stays 404/0 aside from a required red test that is then made green. Root typecheck stays 0. Covers FR-004, FR-008, FR-009, SC-001, SC-002.
- [x] T014 [US3] Apply the line 111 rule only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not contain that file. If a tree contains it, leave line 111 unchanged, and stop and ask if the work would change it. Covers FR-008, SC-004.
- [x] T015 [US3] Do not attach CI because Tony named a file. That wording is withdrawn. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head. Covers FR-009, SC-006, Principle IX.
- [x] T016 [US3] Confirm the implementation diff has no runtime, schema, or stored-data change. Covers FR-010, SC-005.

---

## Phase 6: Polish

**Purpose**: QA handoff on the exact head.

- [x] T017 [P] Run the checks in `specs/worker-typecheck-zero/quickstart.md` and put the head SHA, per-commit counts, and breakdown in the writer report. The closeout lists every one-sided Env finding from T010. A finding is resolved when the final name-set difference no longer contains that name. A finding is waived only when the closeout prints that name and the word waived. Do not call the head done until `npm run typecheck:worker` reports 0 errors and every remaining one-sided name is waived. Covers SC-001, SC-002, SC-005, SC-007, Principle VIII.

## Phase 7: Provenance correction (ruling b)

**Purpose**: `sourceCommit` is the commit that contains `sourceBlob`. No second field. The check is not part of `npm test`.

- [x] T019 Audit the three older `reconstructed-manifest.json` entries. For `recovered-source/worker/src/env.d.ts`, `git rev-parse db3e8548:reconstruction/env.d.ts` equals `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`. For `recovered-source/worker/src/types.ts`, `git rev-parse db3e8548:reconstruction/worker-root/worker/src/types.ts` equals `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`. For `recovered-source/shared/packages/contracts/src/agent-ui/index.ts`, `git rev-parse db3e8548:reconstruction/packages/contracts/src/agent-ui/index.ts` equals `ed80553761da2db13495c6eb250a438d7ef54327`. If any does not, correct that entry's `sourceCommit` in the same metadata commit as T020. Do not change a blob, a sha256, or a recovered-source file. Covers FR-012.
- [x] T020 Add `harness/verify-provenance.ts` and `npm run verify:provenance`. The script is not part of `npm test`. For every reconstructed entry it finds the single path in `sourceCommit` whose blob is `sourceBlob` and requires `git rev-parse <sourceCommit>:<sourcePath>` to equal `sourceBlob`. A mismatch exits non-zero and prints one line naming that entry's `path`, `sourceCommit`, and `sourceBlob`. Exit 0 prints one line per entry. The same commit sets `view-plan.ts` `sourceCommit` to `be6eb37f31e62f0f04a610202cca120aa4d9302f` and `view-plan.validator.d.ts` `sourceCommit` to `4ba133b04e49cfb20abe0a22b5ca367284456356`. No second field. Recovered-source blobs stay unchanged. `npm test` stays 404/0 with the same test names. Root typecheck stays 0. `npm run typecheck:worker` stays 0. Covers FR-012, SC-008.

## Phase 8: Closeout

**Purpose**: Mark the spec implemented, keep git stderr inside the provenance script, record the runTool guard, and verify a fresh clone.

- [x] T021 Set `specs/worker-typecheck-zero/spec.md` status from Draft to Implemented. No recovered-source byte changes. Covers FR-013.
- [x] T022 `harness/verify-provenance.ts` captures git's stderr. It does not pass a raw `fatal:` line through. Each failing entry prints the script's own one-line reason. Exit 0 when every entry matches. Exit 1 when any entry does not. A missing commit and a shallow clone that lacks the source commit both exit 1 with those script lines only. The real manifest still prints 5 `ok` lines and exits 0. Covers FR-012, FR-013, SC-008.
- [x] T023 Write this closeout note line exactly: `runTool unknown-name path is guarded upstream at loop.ts:155 (isToolName, Object.hasOwn(AGENT_TOOLS)); only caller loop.ts:162 via turn.ts:188; no backlog item`. Covers FR-013.
- [x] T024 On a fresh full clone of the closeout head, run `npm ci`, `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance`. Record the head SHA and each exit code. `npm test` is 404 passed and 0 failed, with the same test names as `c865a7ec984727db92daaaae643033a59bfa3569`. Worker typecheck reports 0 `error TS` lines. Provenance exits 0. There is no wrangler config on the branch, so hands-on Worker smoke is N/A for that reason. The recovered-source tree stays `310531c5c2ea5e451099f626f8cf63f9dc1153ef`. Covers FR-013, SC-009.

## Ledger

Every task is done. None is dropped. `closeout.md` holds the written checks. The closeout commit is the commit that adds this ledger.

| Task | Status | Commit |
|---|---|---|
| T001 | done | `7ab6d9529838ed1447a659986aa1092fdc0469c9` |
| T002 | done | `c865a7ec984727db92daaaae643033a59bfa3569` |
| T003 | done | closeout commit |
| T004 | done | `f0a06db50586b7e3d7c88e8cd111412ea222432e` |
| T005 | done | `02ee5b6fd2edc7978c7fbb8a012bce06a8d87c2f` |
| T006 | done | `b0f5ae8c5dbcff15607f78334caac3a31fc2dd03`; `sourceCommit` corrected in `c865a7ec984727db92daaaae643033a59bfa3569` |
| T007 | done | `9f3a2c311f1d80bf51db638a26d10fa38464d49c`; `sourceCommit` corrected in `c865a7ec984727db92daaaae643033a59bfa3569` |
| T008 | done | `9f3a2c311f1d80bf51db638a26d10fa38464d49c` |
| T009 | done | closeout commit |
| T010 | done | closeout commit |
| T011 | done | `c89008c484d812bf6793d475b06629e193cfa628` |
| T012 | done | closeout commit |
| T013 | done | `9f3a2c311f1d80bf51db638a26d10fa38464d49c` |
| T014 | done | closeout commit |
| T015 | done | closeout commit |
| T016 | done | closeout commit |
| T017 | done | closeout commit |
| T018 | done | `21e06d8ba610565c9f7cded5ca111a0ababfc454` |
| T019 | done | `c865a7ec984727db92daaaae643033a59bfa3569` |
| T020 | done | `c865a7ec984727db92daaaae643033a59bfa3569` |
| T021 | done | closeout commit |
| T022 | done | closeout commit |
| T023 | done | closeout commit |
| T024 | done | closeout commit; exit codes are the writer report for that head |

## Dependencies

Checked after adding T018 ahead of T011. No task needs a file that a later task creates.

- T018 depends on the head of this spec amendment. It does not depend on T001–T017.
- T011 depends on T018.
- T004 depends on T011. T005 depends on T004. T006 depends on T005. T007 depends on T006.
- T008 applies to T004–T007. T011's stop rule is on T011. T018 stops when the suite is not 404/0.
- T009 depends on T004–T007, which already depend on T011, which depends on T018.
- T010 depends on T009.
- T012 depends on T010.
- T013 depends on T012.
- T014 and T015 depend on T013. T015 does not attach a gate.
- T016 and T017 depend on T013–T015.
- T019 and T020 depend on T007. They are the ruling (b) metadata correction. T020's script is what T019's check reruns. The script and the `sourceCommit` corrections land in one commit after the spec amendment. Promotion commit messages are not rewritten.
- T021, T022, T023, and T024 depend on T020. They are the closeout. They do not change `recovered-source` bytes.

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

The first implementation commit is T018. T011 then T004 through T007 follow. Each of those five commits adds one promoted file and exactly one `reconstructed-manifest.json` entry. User Story 2's path check and name log stay after those files exist. User Story 3 reaches 0 and stops without adding CI, because main has none. This spec commit implements none of these tasks. A new `error TS` line is not waived.
