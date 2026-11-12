# Quickstart: Worker typecheck zero

Validation for an independent QA session on the exact head. No implementation steps.

## Prerequisites

- Branch `cursor/state-machines-c94c`.
- The head under test is the commit the writer pushed. Do not move it.

## Baseline this spec was written against

Head `387f2c8b1662283ca74e657ec85f97068c011ab7`.

| Command | Expected at that head |
|---|---|
| `npm test` | 403 passed, 0 failed |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:worker` | 119 `error TS` lines: TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1 |

This spec commit does not change those counts.

## After each implementation commit

1. `git rev-parse HEAD` and `git rev-parse HEAD^`.
2. `npm run typecheck:worker` on that exact head and on the parent. Record the SHA, the exit code, and the `error TS` breakdown. T018's count equals its parent. Each promotion commit's count is lower than its parent. No `error TS` line (file, line, column, and TS code) appears that the parent does not report. Until a separate CI commit extends main's CI, this QA run is the gate for every T004+ commit.
3. `npm test`. On this spec head, expect 403 passed and 0 failed. From T018 onward, expect 404 passed and 0 failed, unless the commit is the red test for a logged mismatch and that is the only failure. 404 is 403 plus the one test T018 adds.
4. For T018, `reconstructed-manifest.json` has an empty `files` array, `candidate-manifest.json` is unchanged, and worker typecheck is still 119. For T011 and T004 through T007, the commit has the new file and `reconstructed-manifest.json` only. The new entry's path, sourceCommit, full blob id, N, sha256, and byte edits match the file and the contract table. `sourceCommit` is `db3e8548` for T011, T004, and T005; `be6eb37f31e62f0f04a610202cca120aa4d9302f` for T006; and `4ba133b04e49cfb20abe0a22b5ca367284456356` for T007. The recovered-source walk equals the union of the two manifests. The path sets are disjoint.
5. `npm run typecheck`. Expect exit 0.
6. For a promotion commit, use the git path in [contracts/promoted-modules.md](./contracts/promoted-modules.md), not `packages/...`. N is 8 for `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e`, 7 for `ed80553761da2db13495c6eb250a438d7ef54327`, 13 for `d4b092167f4e1875d0254c98499a979cbd305dd6`, and 5 for `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c`. `git cat-file -p <blob> | tail -n +<N+1> | git hash-object --stdin` equals `git rev-parse HEAD:<git path>`. `git cat-file -p <blob> | head -n <N>` contains only comment lines and blank lines. The commit message records a source commit, the full blob id, N, and that header verbatim. The manifest `sourceCommit` is the commit that contains the blob. A promotion message already on the branch is not rewritten. `npm run verify:provenance` exits 0 and is not part of `npm test`. The `packages` symlink is unchanged. The five agent-ui sibling blobs are unchanged.
7. `git grep -n reconstruction tsconfig.json tsconfig.worker.json` finds no path, include, or `preserveSymlinks` entry.
8. If `harness/runtime/whole-api-causes.test.ts` is in the tree, line 111 is unchanged. If the file is absent, skip this check.

## End state

- `npm run typecheck:worker` reports 0 `error TS` lines. That is the lane's exit criterion.
- Each promoted path exists once. The leading provenance comment is not in the committed file.
- The Env finding list has names only. `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth for member names. `recovered-source/worker/src/env.d.ts` imports `./tenant-policy.ts` and `./workspace.ts`, and it has no `reconstruction/` or `worker-root/` path. No wrangler or deploy config was added.
- The closeout lists every one-sided Env finding. Each name still in the final name-set difference is printed with the word waived. Each name no longer in that difference is marked resolved. The head is not done until that list is complete.
- No CI file was added. Main `190cd048` has no CI config. No merge until a later reviewed commit extends that system and enforces `npm run typecheck:worker` on the exact head.
