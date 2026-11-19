# Tasks: v24 deploy recovery

**Input**: Design documents from `/specs/v24-deploy-recovery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required. T001 and T002 are written first and must fail before T003.

**Organization**: Setup, then the two red tests, then the config and wrapper that make them pass, then the gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Phase 1: Setup

**Purpose**: Confirm the parent head before any new test.

- [x] T000 Confirm the parent is `c9417c885fc3f12fdcf5201fa15f0e807d50f05d` and the branch is `cursor/recover-v24-deploy-1c66`. Record parent `npm test` as 416 passed and 0 failed, and both typechecks and `npm run verify:provenance` as exit 0. Add no recovered-source edit. Covers FR-012, FR-013.

## Phase 2: Red tests

**Purpose**: Failing tests for bindings and the graph wrapper. No config and no wrapper exist yet.

**Independent Test**: `npm test` fails, and the new assertions are the failures.

- [x] T001 [US1] Add `harness/tests/v24-bindings.test.ts`. It parses `wrangler.jsonc`, requires the 26 names and types in `contracts/bindings.md`, requires `secrets.required` to be the nine secret names, requires the eleven plain-text names in the config comment, requires `keep_vars` true, requires no `vars` key, requires the single `v3` migration, and requires the asset, service, and R2 fields in FR-001 through FR-007 and FR-014. It also requires `deploy/assets/UNREPRODUCED` to be the only file in that directory, and it checks `deploy/guard.ts` plus `deploy.sh` with no arguments. Covers FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-011, FR-014, SC-001, SC-003.
- [x] T002 [P] [US2] Add `harness/tests/graph-entry.test.ts`. It imports `deploy/graph-route.ts`, checks the eight sha256 rows in `contracts/graph-entry.md`, and checks the serve, head, delegate, and rewrite rules in User Story 2. It reads `deploy/graph-entry.ts` for the re-export and the absence of a second Durable Object class. Covers FR-009, SC-002.

## Phase 3: User Story 1 and User Story 3 - Config and guard (Priority: P1)

**Goal**: The config matches the contract, and a real deploy is refused.

**Independent Test**: T001 passes. `deploy.sh` without `--dry-run` exits non-zero.

- [x] T003 [US1] Add `wrangler` `4.158.0` to devDependencies and refresh `package-lock.json`. Do not change `@cloudflare/workers-types`. Replace the package description that says this tree is not a deployable Worker with one sentence: `deploy.sh` refuses a real deploy while `deploy/assets/UNREPRODUCED` exists. Covers FR-012.
- [x] T004 [US1] Add `wrangler.jsonc` with the fields T001 asserts, including `alias` to `./harness/adapters/policy-entry.ts` and a Text rule for `**/*.html`, `**/*.css`, and `**/*.txt`. Add `deploy/assets/UNREPRODUCED` and no other file in that directory. Covers FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-011, FR-014, SC-001.
- [x] T005 [US3] Add `deploy/guard.ts` and `deploy.sh`. The guard fails a real deploy while the marker exists, fails when `.dev.vars` exists, and fails a `vars` object or a migration other than FR-007. `deploy.sh --dry-run` invokes local `wrangler deploy --dry-run` with no `--secrets-file`. Any other argument fails. Covers FR-008, FR-013, SC-003.

## Phase 4: User Story 2 - Graph wrapper (Priority: P1)

**Goal**: `/graph` is served from recovered bytes and the Worker classes stay re-exported.

**Independent Test**: T002 passes.

- [x] T006 [US2] Extract the eight v24 files into the repo paths in `contracts/graph-entry.md`. Add `deploy/graph-route.ts` and `deploy/graph-entry.ts`. Do not edit `recovered-source/`. Covers FR-009, FR-010, SC-002.

## Phase 5: User Story 4 - Verdict check (Priority: P2)

**Goal**: The pending-column verdict stays no, with no source edit.

**Independent Test**: `git diff` for `recovered-source/worker/src/brains/store.ts` is empty, and `wrangler.jsonc` has no tag other than `v3`.

- [x] T007 [US4] Do not edit `recovered-source/worker/src/brains/store.ts` and do not add a migration tag other than `v3`. The spec's pending-column verdict remains the record. Covers FR-010, SC-005.

## Phase 6: Gates

**Purpose**: Run the checks named in the spec.

- [x] T008 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the implementation head. All exit 0. Worker errors stay 0. Existing tests stay as they are. Covers FR-012, SC-006.
- [x] T009 [US3] Run `bash deploy.sh --dry-run` with no login. Record the exit code. A non-zero result that asks for an account is reported and is not followed by `wrangler login`. Covers SC-004, FR-013.

## Phase 7: Take main

**Purpose**: Put main `0644553837eb3ea8d49cddc8a0954d12a6cb5364` on this branch without a force push.

- [x] T009a Merge `origin/main` into `cursor/recover-v24-deploy-1c66`. Do not rebase. Resolve nothing by editing main's behavior: the merge has no conflicts. Record `npm test` on the merge head as 459 passed and 0 failed. Covers the 2026-11-19 clarification.

## Phase 8: User Story 5 - Asset drop-in check (Priority: P1)

**Goal**: A real deploy stays refused until a captured manifest matches, and a synthetic match passes the guard.

**Independent Test**: T010 fails before T011, then passes. `deploy/assets/` is still only `UNREPRODUCED`.

- [x] T010 [US5] Add the asset drop-in test in `harness/tests/v24-bindings.test.ts`. It uses temporary synthetic files only. `deploy.sh` exits 2 with `assets-unreproduced` while the marker exists, and exits 2 with `assets-manifest-mismatch` when any listed file's sha256 differs, a listed file is missing, or an unlisted file is present. The guard fails with `assets-manifest-missing` when the manifest is absent. The guard passes when the manifest matches. The pass case does not start Wrangler. A stub stands in for `wrangler` so a refusal cannot upload. Do not rewrite the existing tests. Covers FR-008, FR-011, FR-015, SC-003, SC-007.
- [x] T011 [US5] Teach `deploy/guard.ts` the order and the line rules in `contracts/asset-manifest.md`. Do not add files under `deploy/assets/`. Do not call Wrangler from the test's pass case. Covers FR-015, SC-007.

## Phase 9: Gates after the manifest check

- [x] T012 Run `npm test`, `npm run typecheck`, `npm run typecheck:worker`, and `npm run verify:provenance` on the implementation head. All exit 0. `npm test` is 460 passed and 0 failed. Existing tests stay as they are. Do not run `wrangler deploy`. Covers FR-012, SC-006.

## Phase 10: Close the guard bypasses (Priority: P1)

**Goal**: A direct Wrangler deploy has no staging directory, a case-variant sentinel is refused, and the bytes Wrangler reads are the copies the guard hashed.

**Independent Test**: T013 fails on `da7297c`, then T014 passes. `deploy/assets/` is still only `UNREPRODUCED`.

- [x] T013 [US5] Add the four failing tests in `harness/tests/v24-bindings.test.ts`. `npm run deploy` must be `./deploy.sh` and `deploy/.staged` must be absent. A file named `unreproduced` with its real hash is refused. `assets.directory` of `./deploy/assets` or `../outside` is refused. A matching fixture staged at the directory named in the config keeps those bytes after the source changes, and a later `deploy.sh` does not start Wrangler. Covers FR-006, FR-008, FR-016.
- [x] T014 [US5] Point `assets.directory` at `deploy/.staged`, gitignore it, and add the npm `deploy` script. The guard reads that directory from the config. T016 replaces the in-repo copy. Do not invent UI bytes. Covers FR-006, FR-008, FR-016.

## Phase 11: Temp staging (Priority: P1)

**Goal**: The configured directory is never created, Wrangler reads a temp directory, and an empty sentinel directory is refused.

**Independent Test**: T015 fails on `8de81a4`, then T016 passes. `deploy/.staged` stays absent.

- [x] T015 [US5] Add failing tests: a pre-existing or empty configured directory is refused and left in place; `deploy.sh` passes `--assets` to a `0700` directory outside that path and removes it when the stub exits 7; an empty `unreproduced`, `UNREPRODUCED`, or `keep/Unreproduced` directory is refused. Covers FR-016.
- [x] T016 [US5] Stage with `mktemp -d`, `chmod 0700`, and `trap 'rm -rf "$tmp"' EXIT`. Run `wrangler deploy --assets "$tmp"`. Refuse when the configured path exists. Treat every `unreproduced` directory name as the sentinel. Record the Wrangler 4.158.0 `--dry-run` evidence. Do not invent UI bytes and do not run a real deploy. Covers FR-016. T018 drops the redundant chmod.

## Phase 12: Rehash the staged copy (Priority: P1)

**Goal**: A change to a staged copy after the write and before the rehash refuses the deploy, and `deploy.sh` does not chmod the temp directory.

**Independent Test**: T017 fails on `5dbf2ba`, then T018 passes. Deleting the rehash turns only that test red.

- [x] T017 [US5] Add one failing test. `DEPLOY_AFTER_COPY` replaces the temp copy after the write and before the rehash. `deploy.sh` exits 2 with `assets-manifest-mismatch` and does not start Wrangler. Covers FR-016.
- [x] T018 [US5] Honor `DEPLOY_AFTER_COPY` between the write and the rehash. Drop the `chmod 0700` after `mktemp -d`. Record the proof that deleting the rehash fails only this test. Do not invent UI bytes and do not run a real deploy. Covers FR-016. T020 removes the env seam.

## Phase 13: Hook instead of an env seam (Priority: P1)

**Goal**: The rehash is tested through an exported function. The deploy path reads no environment variable.

**Independent Test**: T019 fails on `5a18583`, then T020 passes. Deleting the rehash turns only the `afterCopy` test red.

- [x] T019 [US5] Add failing tests. `copyThenRehash` is missing, so a hook cannot replace a staged file. `deploy/guard.ts` still contains `DEPLOY_AFTER_COPY`. Covers FR-016.
- [x] T020 [US5] Export `copyThenRehash` with an optional `afterCopy`. Call it from the deploy path with no hook. Remove every `process.env` read from `deploy/guard.ts`. Replace the `5dbf2bad` assertion that expected the env var to refuse a deploy. Record the proof that deleting the rehash fails only the hook test. Do not invent UI bytes and do not run a real deploy. Covers FR-016.

## Dependencies & Execution Order

### Phase Dependencies

- T000 has no dependencies.
- T001 and T002 depend on T000 and can run in parallel. They must fail before T003.
- T003 depends on the red run of T001 and T002.
- T004 depends on T003.
- T005 depends on T004.
- T006 depends on T002's red run and can follow T004.
- T007 is a non-edit check after T004 and T006.
- T008 depends on T004, T005, and T006.
- T009 depends on T005 and T006.
- T009a has no dependency on T010.
- T010 depends on T009a and must fail before T011.
- T011 depends on the red run of T010.
- T012 depends on T011.
- T013 is a failing test and depends on T012.
- T014 depends on the red run of T013.
- T015 is a failing test and depends on T014.
- T016 depends on the red run of T015.
- T017 is a failing test and depends on T016.
- T018 depends on the red run of T017.
- T019 is a failing test and depends on T018.
- T020 depends on the red run of T019.

### Parallel Opportunities

- T001 and T002 touch different test files.
- T006 touches `deploy/graph*` and can be written after the red run without waiting for T005.

## Implementation Strategy

T000 records the parent. T001 and T002 land as a failing test commit. T003 through T006 make those tests pass. T007 confirms the constructor was not edited. T008 and T009 are the gates. T009a merges main. T010 lands as a failing test. T011 makes that test pass. T012 repeats the four gates. T015 lands as a failing test. T016 makes that test pass and records the `--assets` dry run. T017 lands as a failing test. T018 makes that test pass, drops the extra chmod, and records the rehash deletion proof. T019 lands as a failing test. T020 removes the env seam and records the hook-test deletion proof. No task deploys, and no task writes live UI bytes.
