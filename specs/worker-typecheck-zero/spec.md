# Feature Specification: Worker typecheck zero

**Feature Branch**: `cursor/state-machines-c94c`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "worker-typecheck-zero. Tony chose option B: fix the worker typecheck step by step on this branch. Devin's plan (a)–(f) is the scope. This document is the spec phase. It does not add code or type files."

## Clarifications

Answers below are facts checked at head `387f2c8b1662283ca74e657ec85f97068c011ab7`. They are not guesses.

### Session 2026-11-12

- Q: Which bytes are promoted? → A: The four blobs Tony/Devin named, resolved in this repository's object store: `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, `ed80553761da2db13495c6eb250a438d7ef54327`, `d4b092167f4e1875d0254c98499a979cbd305dd6`, `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`.
- Q: Are those the blobs at commit `db3e8548` for every path? → A: No. `types.ts` and `agent-ui/index.ts` match `db3e8548`. `view-plan.ts` at `db3e8548` is blob `82bac154e813b9fa59c2f93e871127e0c37c3b8e`, not `d4b092167f4e`. `view-plan.validator.d.ts` at `db3e8548` is blob `a403845f6cd562a3b2488e0e736aa57aaf57cbd2`, not `5a3b92e373e2`. Promote the named blobs.
- Q: Is `reconstruction/` on this branch? → A: No. `db3e8548` is not an ancestor of this head. Do not merge that commit or its branch. Read the named blobs from the object store.
- Q: Does a wrangler config exist on this branch? → A: No. Devin ruled that `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is a separate change, out of scope here.
- Q: Does the line 111 rule apply on this branch? → A: Only when the tree contains `harness/runtime/whole-api-causes.test.ts`. This branch does not contain that file. If a tree contains it, line 111 stays unchanged; if the work would change it, stop and ask.
- Q: Where does the worker typecheck gate live? → A: CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head. This replaces the earlier wording that CI is attached only when Tony names the file.

### Session 2026-11-12, QA #54

- Q: The barrel `ed80553761da2db13495c6eb250a438d7ef54327` re-exports `./schemas.ts`, `./library.ts`, `./view.ts`, `./lock.ts`, and `./planner.ts`. Where do those siblings live? → A: In git they exist only at `recovered-source/shared/packages/contracts/src/agent-ui/`. Their blobs are `schemas.ts` `3676979bf3ef060c63fb6d5c80ffaa561e140508`, `library.ts` `405d7b636c03bc33e661e8c67aaa68ea42933b25`, `view.ts` `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3`, `lock.ts` `3c6dd1f623748116c28caaf7c0e64cfe1ef46019`, `planner.ts` `98cb0da3fe5ddced279b0c96c30724667dcbb6a9`. At `db3e8548` the reconstruction copies of those five paths are symlinks to these files, not second sources. T005 does not promote them.
- Q: How does T005 make those re-exports resolve? → A: Place only the barrel at `recovered-source/shared/packages/contracts/src/agent-ui/index.ts`. It is byte-identical to blob `ed80553761da2db13495c6eb250a438d7ef54327` except for removing the leading provenance comment (N=7), the same rule as the other promotions. The tracked symlink `packages` → `recovered-source/shared/packages` (blob `79a67f92b7f877ab356884d89c0d307bdf2a9e83`) makes `packages/contracts/src/agent-ui/index.ts` the same file. The barrel's `./` specifiers then name the existing siblings. Do not copy a sibling to another path. Do not replace the symlink. T005 stays one module and one commit.
- Q: What does "one path per type" mean for QA? → A: The contract table. One git path and one source blob per module. The committed hash is the tail check, not the source blob. A name re-exported by the barrel is not a second path. The sibling's only home is the recovered file above.
- Q: The four blobs start with a `NEW RECONSTRUCTION` comment. Constitution II says provenance goes in the commit message. → A: II applies as written. No exception. Each promotion removes only that leading comment and any blank lines directly after it. Measured N is 8 for `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, 7 for `ed80553761da2db13495c6eb250a438d7ef54327`, 13 for `d4b092167f4e1875d0254c98499a979cbd305dd6`, and 5 for `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. None of the four has a blank line after the comment, so N is the comment only. Every other byte stays identical. The commit message records `db3e8548`, the full blob id, N, and the removed header verbatim.
- Q: `env.d.ts` blob `841f0dbc97ac` imports `./worker-root/worker/src/tenant-policy.ts` and `./worker-root/worker/src/workspace.ts`. How are those mapped? → A: Those two specifiers are not copied and no `reconstruction/` or `worker-root/` path is added. The written file is `recovered-source/worker/src/env.d.ts`. Its imports are `import type { TenantPolicy } from "./tenant-policy.ts";` and `import type { Workspace } from "./workspace.ts";`. QA checks `recovered-source/worker/src/tenant-policy.ts:152` is `export class TenantPolicy extends DurableObject<Env> {` and `recovered-source/worker/src/workspace.ts:172` is `export class Workspace extends BrainBase {`. The interface member names match the blob. `git hash-object` of the written file is not required to equal `841f0dbc97ac`, because those two import lines differ from the blob.
- Q: What is a real mismatch, as opposed to a name finding? → A: A diagnostic is one `error TS` line, identified by file, line, column, and TS code. A real mismatch is a diagnostic on the commit under test that the parent commit does not report. The red test names that file, line, and TS code, fails on that commit, and is not `harness/runtime/whole-api-causes.test.ts`. A name finding is not a real mismatch: it is an `interface Env` property in blob `841f0dbc97ac` that no worker `env.<name>` read uses, or a worker `env.<name>` read whose name is absent from that interface. QA diffs the two name sets. A name finding is logged. It gets no red test and no behavior change.
- Q: How was analyze run? → A: Spec Kit v1.4.0 is installed. `uvx --from git+https://github.com/github/spec-kit.git@v1.4.0 specify version` reports CLI Version 1.4.0. `specify --help` has no `analyze` command. The integration is `none`, so no analyze binary was installed. Analyze is the read-only review in that package's `templates/commands/analyze.md`. Its script is `.specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks`, run from the repo root with `SPECIFY_FEATURE_DIRECTORY=specs/worker-typecheck-zero`. The counts in the plan are the result of that review.

### Session 2026-11-12, ruling C

- Q: `candidate-manifest.json` lists the recovered intake. Where do promoted files go? → A: Devin ruled C. `candidate-manifest.json` stays the recovered list and is not edited. Promoted files are listed only in `reconstructed-manifest.json` at the repository root, beside `candidate-manifest.json`. T018 commits that file with an empty `files` array and updates `harness/tests/intake.test.ts` before T011. T011 and T004 through T007 each add one entry in the same commit as the file.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Promote each stand-in to its import path (Priority: P1)

A reviewer can see four separate commits. Each commit places one named blob at the path the Worker already imports, and the worker typecheck error count is lower than on the parent commit.

**Why this priority**: The 43 missing-module errors and the errors that follow from them stay until these files exist at the import paths.

**Independent Test**: For each promotion commit, check the blob hash of the new file, the one new `reconstructed-manifest.json` entry, the commit message provenance, the worker error count, `npm test` at 404/0, and root typecheck at 0. 404 is 403 plus the one test T018 adds.

**Acceptance Scenarios**:

1. **Given** the T011 head, with 48 `error TS` lines expected, **When** `types.ts` is placed at `recovered-source/worker/src/types.ts` in one commit with its leading comment removed, **Then** the tail check for blob `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` and N=8 passes, the commit message names `db3e8548`, that blob id, N, and the header verbatim, the worker error count is lower than that parent, and no `error TS` line is new versus that head.
2. **Given** the previous promotion commit, **When** the barrel is placed at `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` byte-identical to blob `ed80553761da2db13495c6eb250a438d7ef54327` except for removing the leading provenance comment (N=7), and the five sibling blobs are unchanged, **Then** the worker error count is lower than that commit's parent and no sibling has a second path.
3. **Given** the previous promotion commit, **When** `recovered-source/shared/packages/contracts/src/view-plan.ts` is added as blob `d4b092167f4e1875d0254c98499a979cbd305dd6`, **Then** the worker error count is lower than that commit's parent. The import path `packages/contracts/src/view-plan.ts` is that same file.
4. **Given** the previous promotion commit, **When** `recovered-source/worker/src/generated/view-plan.validator.d.ts` is added as blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, **Then** the worker error count is lower than that commit's parent.
5. **Given** any of those commits, **When** QA reads the commit message, **Then** it records `db3e8548`, the full blob id, N, and the removed header verbatim. `git cat-file -p <blob> | tail -n +<N+1> | git hash-object --stdin` equals `git rev-parse HEAD:<git path>`. `git cat-file -p <blob> | head -n <N>` contains only comment lines and blank lines. The committed file does not contain that header.
6. **Given** T018 has landed, **When** one of those four commits runs, **Then** the commit contains that module and `reconstructed-manifest.json`, and no other path. The manifest gains exactly the one entry for that module. The entry matches the file under FR-011. The worker typecheck gate for that commit is unchanged.

---

### User Story 2 - One location, and Env names checked without secrets (Priority: P2)

A reviewer can show that each promoted type exists at one path, and that Env was checked as names only.

**Why this priority**: A second copy under `reconstruction/`, or a secret value in git, would undo the promotion and violate the security rule.

**Independent Test**: Search the branch for a second copy of each promoted path. Read the Env finding log. Confirm it lists name mismatches and contains no secret values.

**Acceptance Scenarios**:

1. **Given** the four promotions, **When** QA reads the contract table, **Then** each module has one git path and the tail check equals `git rev-parse HEAD:<git path>`. A name re-exported by the barrel is not a second path. No `tsconfig` path, include, or `preserveSymlinks` setting points at `reconstruction/`.
2. **Given** Env checking, **When** the Env commit runs, **Then** blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is out of scope. Each name mismatch is a finding.
3. **Given** blob `841f0dbc97ac` imports `./worker-root/worker/src/tenant-policy.ts` and `./worker-root/worker/src/workspace.ts`, **When** the Env file is written at `recovered-source/worker/src/env.d.ts`, **Then** those specifiers are not copied. The imports are `./tenant-policy.ts` and `./workspace.ts`. Line 152 of `tenant-policy.ts` is `export class TenantPolicy extends DurableObject<Env> {`. Line 172 of `workspace.ts` is `export class Workspace extends BrainBase {`. The file contains no `reconstruction/` or `worker-root/` path. The commit also appends the one FR-011 entry for that path, and it contains no other path.
4. **Given** a diagnostic the parent commit does not report, **When** that diagnostic is a real mismatch, **Then** a new red test names its file, line, and TS code before any fix, and the fix does not use `any` or `@ts-ignore`. A name-set difference on `interface Env` is a finding, not a real mismatch, and gets no red test.
5. **Given** this spec head, **When** T018 commits, **Then** `reconstructed-manifest.json` parses as an object whose `files` array is empty, `candidate-manifest.json` is byte-identical to its parent, and `harness/tests/intake.test.ts` is the only test file in the commit. The recovered-source walk equals the union of the two manifest path sets. The two path sets are disjoint. An empty reconstructed list passes on that commit. `npm test` is 404 passed and 0 failed. Worker typecheck stays 119. Root typecheck is 0.
6. **Given** the T018 tests, **When** the comparison is given the recovered-source walk plus `recovered-source/worker/src/__unlisted__.ts`, **Then** the comparison fails. That path is in neither manifest and is not written to disk. The test that shows this failure passes.

---

### User Story 3 - Worker typecheck reaches zero (Priority: P3)

An independent QA session reports worker typecheck at 0 errors. The suite is 404 passed and 0 failed, which is the 403 baseline plus the one passing test T018 adds, unless a red test this spec required is the only extra failure. Root typecheck is unchanged from the baseline.

**Why this priority**: Zero is the end state. It comes after the promotions and the Env check, because those are what remove the errors.

**Independent Test**: On the exact head, run `npm test`, `npm run typecheck`, and `npm run typecheck:worker`, and record the SHA and the worker exit code. Apply the line 111 check only if `harness/runtime/whole-api-causes.test.ts` is in the tree.

**Acceptance Scenarios**:

1. **Given** the promotions and the Env findings, **When** worker typecheck reports 0 errors, **Then** QA records 0 errors, `npm test` is 404 passed and 0 failed, root typecheck is 0 errors, and the closeout has resolved or waived every one-sided Env finding.
2. **Given** a tree that does not contain `harness/runtime/whole-api-causes.test.ts`, **When** implementation finishes, **Then** the line 111 rule is not applied. **Given** a tree that contains that file, **When** the work would change line 111, **Then** it stops and asks.
3. **Given** main `190cd048` has no CI config, **When** implementation reaches the gate task, **Then** it stops and reports before adding anything. Until a separate reviewed commit extends main's existing CI, QA gates each T004+ head by running `npm run typecheck:worker` and recording the SHA and exit code. No merge until that CI check exists.

---

### Edge Cases

- A promotion commit does not lower the worker error count, or it reports an `error TS` line the parent does not report. Stop. Do not add `any` or `@ts-ignore`.
- A promotion raises the worker error count or the root typecheck error count. Stop and report the new diagnostics.
- `npm test` is not 403 passed and 0 failed on this spec head, or not 404 passed and 0 failed after T018, and the failure is not the single red test this spec required for a mismatch. Stop. Do not edit unrelated tests. Do not delete a test or drop an assertion in `harness/tests/intake.test.ts`.
- A tree contains `harness/runtime/whole-api-causes.test.ts` and the work would change line 111. Stop and ask. If the file is absent, the line 111 rule does not apply.
- An Env property is in blob `841f0dbc97ac`'s `interface Env` and not in a worker `env.<name>` read, or the reverse. Log that name finding. It is not a real mismatch. A behavior change is out of scope.
- `reconstruction/` is added by a merge. Do not merge. If copies appear, the same commit either points them at the promoted paths or deletes the copies.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: T018 lands before T011. `recovered-source/worker/src/env.d.ts` (T011) is written before any of the four modules. Each of those four is then promoted in its own commit, in this order: `recovered-source/worker/src/types.ts`, the agent-ui barrel, `view-plan.ts`, `recovered-source/worker/src/generated/view-plan.validator.d.ts`. The barrel's git path is `recovered-source/shared/packages/contracts/src/agent-ui/index.ts`. The view-plan git path is `recovered-source/shared/packages/contracts/src/view-plan.ts`. The worker import strings `packages/contracts/src/agent-ui/index.ts` and `packages/contracts/src/view-plan.ts` are those same files through the `packages` symlink. T005 does not add the five sibling modules. T011 and T004 through T007 each also append one `reconstructed-manifest.json` entry, so each of those commits has two paths.
- **FR-002**: The four promoted modules come from the named blobs, retrieved from the object store. Do not merge or cherry-pick `db3e8548`. Remove only the leading provenance comment and any blank lines directly after it. Every other byte stays identical: no reformatting, and line endings and the final newline unchanged. QA checks `git cat-file -p <blob> | tail -n +<N+1> | git hash-object --stdin` against `git rev-parse HEAD:<git path>`, and `git cat-file -p <blob> | head -n <N>` contains only comment lines and blank lines. The agent-ui siblings are not part of this copy. `env.d.ts` uses the same comment removal, and FR-007 then replaces its two import specifiers.
- **FR-003**: Constitution II applies as written. The committed file does not contain the leading provenance comment. The commit message records `db3e8548`, the full blob id, N, and the removed header text verbatim.
- **FR-004**: No commit on this lane adds an `error TS` line (file, line, column, and TS code) that its parent does not report. An `error TS` line is never waived. If `env.d.ts` references an undeclared name, the writer stops and reports. T018 adds no promoted module, so its worker error count equals its parent. After each promotion commit (T011 and T004 through T007) other than the single red-test commit, the worker typecheck error count is strictly lower than the parent. `npm test` is 403/0 on this spec head. From T018 onward it is 404/0, unless that red test is the only new failure and is still red on purpose. Root typecheck is 0. The lane is done only when `npm run typecheck:worker` reports 0 errors at the final head. Every one-sided Env finding is resolved or explicitly waived in the closeout before that head is called done. A finding is resolved when the final name-set difference no longer contains it. A finding is waived only when the closeout prints that name and the word waived.
- **FR-005**: No `tsconfig` path, include, or `preserveSymlinks` setting points at `reconstruction/`.
- **FR-006**: One path per type means the contract table: one git path and one source blob per module. The committed hash is the tail check in FR-002, not equality with the source blob. Names re-exported through the agent-ui barrel are not duplicates. A one-sided Env finding is the name finding in FR-008. The five siblings stay at their recovered paths and keep the blobs named in the QA #54 clarification. This branch does not gain a `reconstruction/` copy. The `packages` symlink is not replaced.
- **FR-007**: `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth for `interface Env` member names, and T011 writes it before T004. No off-branch wrangler config is adopted. Any wrangler or deploy config is a separate change and is out of scope. The blob has a leading provenance comment. N is 9. No blank line follows it. `git cat-file -p 841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d | tail -n +10 | git hash-object --stdin` equals `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`. The written file is that tail with the two `./worker-root/worker/src/` import specifiers replaced by `./tenant-policy.ts` and `./workspace.ts`, which resolve to `export class TenantPolicy` at `recovered-source/worker/src/tenant-policy.ts:152` and `export class Workspace` at `recovered-source/worker/src/workspace.ts:172`. No other byte of the tail changes. No `reconstruction/` path is added. A name-set difference is a finding. Secret values are not written. An undeclared name in the written file stops the commit. It is not waived.
- **FR-008**: A real mismatch is a diagnostic (`error TS` line, identified by file, line, column, and TS code) that the parent commit does not report. It gets a new red test, naming that file, line, and TS code, before any fix. The fix does not use `any` or `@ts-ignore`. A name finding, defined as the symmetric difference of `interface Env` property names in blob `841f0dbc97ac` and worker `env.<name>` reads, is logged and gets no red test. The line 111 rule applies only to a tree that contains `harness/runtime/whole-api-causes.test.ts`. In that tree, line 111 is not the mismatch test and is not edited.
- **FR-009**: The end state of the implementation, not of this spec commit, is worker typecheck exit 0. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. If main has no CI, stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head.
- **FR-010**: Implementation does not change runtime behavior, database schema, or stored data.
- **FR-011**: `reconstructed-manifest.json` at the repository root is the list of promoted files. `candidate-manifest.json` stays the recovered intake list and is not edited. The parsed reconstructed file is an object with a `files` array. T018 writes that array empty. Each later entry has `path`, `sourceCommit` (`db3e8548`), `sourceBlob` (the full promoted blob id), `n`, `sha256` (SHA-256 hex of the committed file bytes), and `byteEdits` (an array of `{ "before", "after" }` strings). `sourceBlob` is the blob this spec promotes. For `view-plan.ts` and `view-plan.validator.d.ts` that blob is not the blob at the same path on `db3e8548`. `byteEdits` is empty when the spec names no replacement inside the tail. Header removal is `n`, not a `byteEdits` entry. For `env.d.ts`, `byteEdits` is the two import replacements in FR-007, TenantPolicy then Workspace, each `before`/`after` the full import line. The contract table records each entry's sha256. The recovered-source walk equals the union of the two manifest path sets, with no extra and no missing path. The two path sets are disjoint. A candidate path in `PATCHED_RECOVERED` stays in `candidate-manifest.json` and its sha256 stays different from the intake sha256. Every other candidate path still matches the intake byte length and sha256. A reconstructed path's sha256 equals its entry. No test in `harness/tests/intake.test.ts` is deleted, and no existing assertion is dropped. The symlink test keeps its three `ENOENT` checks. `recovered-source/worker/src/types.ts` throws `ENOENT` until T004 lists that path. `packages/contracts/src/agent-ui/index.ts` throws `ENOENT` until T005 lists `recovered-source/shared/packages/contracts/src/agent-ui/index.ts`, which is the same file through the `packages` symlink. `packages/contracts/src/view-plan.ts` throws `ENOENT` until T006 lists `recovered-source/shared/packages/contracts/src/view-plan.ts`, which is the same file through that symlink. On the T018 commit all three still throw `ENOENT`. After the matching promotion, the path exists and the reconstructed entry's sha256 matches the file. One new test passes the walk plus `recovered-source/worker/src/__unlisted__.ts` to the same comparison, and that comparison fails. The path is not written to disk. `npm test` on T018 is 404 passed and 0 failed.

### Key Entities

- **Promoted module**: One source file identified by the contract table's git path and blob. It has one location on the branch. A barrel re-export is not another location.
- **Env binding name**: A property name on the Env interface. It has no value in git.
- **Typecheck count**: The number of `error TS` lines from `npm run typecheck:worker` on one commit.
- **Finding**: A recorded mismatch between Env names and the names the code reads. It is not a code change by itself.
- **Reconstructed manifest entry**: One object in `reconstructed-manifest.json` `files`. It names one promoted path and the bytes committed at that path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: QA, in a non-writer session, can list every implementation commit with its parent worker error count and its own worker error count. T018's count equals its parent. Every promotion commit's count is lower than its parent. No commit adds an `error TS` line the parent does not report. The final head reports 0 errors.
- **SC-002**: On that same head, `npm test` reports 404 passed and 0 failed, and root typecheck reports 0 errors. 404 is 403 plus the one test T018 adds.
- **SC-007**: On T018, `reconstructed-manifest.json` has an empty `files` array and the suite passes. After each of T011 and T004 through T007, the new entry matches the committed file and the contract sha256, the recovered-source walk equals the union of the two manifests, and the path sets are disjoint. The unlisted-path test fails the comparison.
- **SC-003**: QA shows the contract table: one git path and one source blob per module, the tail check equal to `git rev-parse HEAD:<git path>`, sibling blobs unchanged, and no `reconstruction/` tsconfig reference. Barrel re-exports are not extra paths.
- **SC-004**: The line 111 rule is checked only on a tree that contains `harness/runtime/whole-api-causes.test.ts`. On this branch the file is absent, so the check does not run.
- **SC-005**: The Env finding log contains names and mismatches only. It contains no secret values. Before the final head is called done, the closeout marks every one-sided Env finding resolved or waived. No runtime, schema, or stored data change is in the diff.
- **SC-006**: No CI file is added. Main `190cd048` has no CI config, and the writer report says so. Each T004+ head has a recorded SHA and `npm run typecheck:worker` exit code from QA.

## Assumptions

- Baseline at `387f2c8b1662283ca74e657ec85f97068c011ab7`, and on this spec head, is worker typecheck 119 errors: TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1. `npm test` is 403/0. Root typecheck is 0. T018 keeps that worker count and raises the suite to 404/0.
- The Worker import paths for the four modules are the destinations in FR-001. Those paths are the single home.
- Reading a blob with git and writing it to the destination is not a merge.
- This spec commit adds no code and no type files. The counts above stay the baseline until implementation commits begin.
