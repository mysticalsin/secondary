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
- Q: Where does the worker typecheck gate live? → A: CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config, so stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Promote each stand-in to its import path (Priority: P1)

A reviewer can see four separate commits. Each commit places one named blob at the path the Worker already imports, and the worker typecheck error count is lower than on the parent commit.

**Why this priority**: The 43 missing-module errors and the errors that follow from them stay until these files exist at the import paths.

**Independent Test**: For each commit, check the blob hash of the new file, the commit message provenance, the worker error count, `npm test` at 403/0, and root typecheck at 0.

**Acceptance Scenarios**:

1. **Given** head `387f2c8b` with worker typecheck at 119 errors, **When** the `types.ts` blob is placed at `recovered-source/worker/src/types.ts` in one commit, **Then** that file's git blob is `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, the commit message names `db3e8548` and that blob id, and the worker error count is lower than 119.
2. **Given** the previous promotion commit, **When** `packages/contracts/src/agent-ui/index.ts` is added as blob `ed80553761da2db13495c6eb250a438d7ef54327`, **Then** the worker error count is lower than that commit's parent.
3. **Given** the previous promotion commit, **When** `packages/contracts/src/view-plan.ts` is added as blob `d4b092167f4e1875d0254c98499a979cbd305dd6`, **Then** the worker error count is lower than that commit's parent.
4. **Given** the previous promotion commit, **When** `recovered-source/worker/src/generated/view-plan.validator.d.ts` is added as blob `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`, **Then** the worker error count is lower than that commit's parent.
5. **Given** any of those commits, **When** QA reads the commit message, **Then** it names `db3e8548` and the blob id. The file has no provenance comment.

---

### User Story 2 - One location, and Env names checked without secrets (Priority: P2)

A reviewer can show that each promoted type exists at one path, and that Env was checked as names only.

**Why this priority**: A second copy under `reconstruction/`, or a secret value in git, would undo the promotion and violate the security rule.

**Independent Test**: Search the branch for a second copy of each promoted path. Read the Env finding log. Confirm it lists name mismatches and contains no secret values.

**Acceptance Scenarios**:

1. **Given** the four promotions, **When** QA searches the branch, **Then** each type exists at exactly one path, and no `tsconfig` path, include, or `preserveSymlinks` setting points at `reconstruction/`.
2. **Given** Env checking, **When** the Env commit runs, **Then** blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is out of scope. Each name mismatch is a finding.
3. **Given** that Env blob imports `TenantPolicy` and `Workspace` from `reconstruction/worker-root/`, **When** those imports cannot resolve on this branch, **Then** the mismatch is a finding and no `tsconfig` path into `reconstruction/` is added. The import path may be changed to `recovered-source/worker/src/tenant-policy.ts` and `recovered-source/worker/src/workspace.ts` only when those files already export those type names. If an export is missing, or the worker error count rises, stop and ask.
4. **Given** a mismatch between the Env names and the code, **When** the code and the type disagree, **Then** a new red test states the mismatch before any fix, and the fix does not use `any` or `@ts-ignore`.

---

### User Story 3 - Worker typecheck reaches zero (Priority: P3)

An independent QA session reports worker typecheck at 0 errors, with the test suite and root typecheck unchanged from the baseline except for a red test this spec required.

**Why this priority**: Zero is the end state. It comes after the promotions and the Env check, because those are what remove the errors.

**Independent Test**: On the exact head, run `npm test`, `npm run typecheck`, and `npm run typecheck:worker`, and record the SHA and the worker exit code. Apply the line 111 check only if `harness/runtime/whole-api-causes.test.ts` is in the tree.

**Acceptance Scenarios**:

1. **Given** the promotions and the Env findings, **When** worker typecheck exits 0, **Then** QA records 0 errors, `npm test` is 403 passed and 0 failed, and root typecheck is 0 errors.
2. **Given** a tree that does not contain `harness/runtime/whole-api-causes.test.ts`, **When** implementation finishes, **Then** the line 111 rule is not applied. **Given** a tree that contains that file, **When** the work would change line 111, **Then** it stops and asks.
3. **Given** main `190cd048` has no CI config, **When** implementation reaches the gate task, **Then** it stops and reports before adding anything. Until a separate reviewed commit extends main's existing CI, QA gates each T004+ head by running `npm run typecheck:worker` and recording the SHA and exit code. No merge until that CI check exists.

---

### Edge Cases

- A promotion commit does not lower the worker error count. Stop. Do not add `any` or `@ts-ignore`.
- A promotion raises the worker error count or the root typecheck error count. Stop and report the new diagnostics.
- `npm test` is not 403 passed and 0 failed after a commit, and the failure is not the single red test this spec required for a mismatch. Stop. Do not edit unrelated tests.
- A tree contains `harness/runtime/whole-api-causes.test.ts` and the work would change line 111. Stop and ask. If the file is absent, the line 111 rule does not apply.
- The Env check finds a binding the code uses that the blob does not name, or a name the blob has that the code does not use. Log the finding. A behavior change is out of scope.
- `reconstruction/` is added by a merge. Do not merge. If copies appear, the same commit either points them at the promoted paths or deletes the copies.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each of the four modules is promoted in its own commit, in this order: `recovered-source/worker/src/types.ts`, `packages/contracts/src/agent-ui/index.ts`, `packages/contracts/src/view-plan.ts`, `recovered-source/worker/src/generated/view-plan.validator.d.ts`.
- **FR-002**: The file bytes are the named blobs, retrieved from the object store. Do not merge or cherry-pick `db3e8548`. For `packages/contracts/src/view-plan.ts` and `recovered-source/worker/src/generated/view-plan.validator.d.ts`, copy only the named blob, and `git hash-object` of the file must equal that blob id.
- **FR-003**: The commit message names `db3e8548` plus the blob id. The promoted file does not gain a provenance comment.
- **FR-004**: After each promotion commit, the worker typecheck error count is strictly lower than the parent commit. `npm test` is 403/0 and root typecheck is 0, unless a mismatch red test is the only new failure and is still red on purpose.
- **FR-005**: No `tsconfig` path, include, or `preserveSymlinks` setting points at `reconstruction/`.
- **FR-006**: After the four promotions, each of those types exists at exactly one path on the branch. This branch does not gain a `reconstruction/` copy. If a copy is already present, the same commit retargets it to the promoted path or deletes it.
- **FR-007**: `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth. No off-branch wrangler config is adopted. Any wrangler or deploy config is a separate change and is out of scope. The check compares that blob line by line with the bindings the code reads. Each mismatch is a finding. Secret values are not written.
- **FR-008**: A mismatch between a type and the code gets a new red test before the fix. The fix does not use `any` or `@ts-ignore`. The line 111 rule applies only to a tree that contains `harness/runtime/whole-api-causes.test.ts`. In that tree, line 111 is not the mismatch test and is not edited.
- **FR-009**: The end state of the implementation, not of this spec commit, is worker typecheck exit 0. CI is a separate reviewed commit that extends main's existing CI system, with no new infrastructure. If main has no CI, stop and report before adding anything. Until that commit exists, each T004+ commit is gated by QA running `npm run typecheck:worker` on the exact head, with the SHA and exit code recorded. No merge until CI enforces the check on the exact head.
- **FR-010**: Implementation does not change runtime behavior, database schema, or stored data.

### Key Entities

- **Promoted module**: One source file identified by destination path and git blob. It has one location on the branch.
- **Env binding name**: A property name on the Env interface. It has no value in git.
- **Typecheck count**: The number of `error TS` lines from `npm run typecheck:worker` on one commit.
- **Finding**: A recorded mismatch between Env names and the names the code reads. It is not a code change by itself.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: QA, in a non-writer session, can list every implementation commit with its parent worker error count and its own worker error count, and each own count is lower than its parent, ending at 0.
- **SC-002**: On that same head, `npm test` reports 403 passed and 0 failed, and root typecheck reports 0 errors.
- **SC-003**: QA can show one path per promoted type and no `reconstruction/` tsconfig reference.
- **SC-004**: The line 111 rule is checked only on a tree that contains `harness/runtime/whole-api-causes.test.ts`. On this branch the file is absent, so the check does not run.
- **SC-005**: The Env finding log contains names and mismatches only. It contains no secret values. No runtime, schema, or stored data change is in the diff.
- **SC-006**: No CI file is added. Main `190cd048` has no CI config, and the writer report says so. Each T004+ head has a recorded SHA and `npm run typecheck:worker` exit code from QA.

## Assumptions

- Baseline at `387f2c8b1662283ca74e657ec85f97068c011ab7` is worker typecheck 119 errors: TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1. `npm test` is 403/0. Root typecheck is 0.
- The Worker import paths for the four modules are the destinations in FR-001. Those paths are the single home.
- Reading a blob with git and writing it to the destination is not a merge.
- This spec commit adds no code and no type files. The counts above stay the baseline until implementation commits begin.
