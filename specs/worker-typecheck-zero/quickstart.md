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
2. `npm run typecheck:worker` on that exact head. Record the SHA, the exit code, and the `error TS` breakdown. The count is lower than the parent. Until a separate CI commit extends main's CI, this QA run is the gate for every T004+ commit.
3. `npm test`. Expect 403 passed and 0 failed, unless the commit is the red test for a logged mismatch and that is the only failure.
4. `npm run typecheck`. Expect exit 0.
5. For a promotion commit, `git rev-parse HEAD:<git path>` and `git hash-object <git path>` both equal the blob in [contracts/promoted-modules.md](./contracts/promoted-modules.md). Use the git path, not `packages/...`. The `packages` symlink is unchanged. The five agent-ui sibling blobs are unchanged. The file still starts with the blob's `NEW RECONSTRUCTION` comment.
6. `git grep -n reconstruction tsconfig.json tsconfig.worker.json` finds no path, include, or `preserveSymlinks` entry.
7. If `harness/runtime/whole-api-causes.test.ts` is in the tree, line 111 is unchanged. If the file is absent, skip this check.

## End state

- Worker typecheck exits 0.
- Each promoted path exists once.
- The Env finding list has names only. `env.d.ts` blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` is the source of truth for member names. `recovered-source/worker/src/env.d.ts` imports `./tenant-policy.ts` and `./workspace.ts`, and it has no `reconstruction/` or `worker-root/` path. No wrangler or deploy config was added.
- No CI file was added. Main `190cd048` has no CI config. No merge until a later reviewed commit extends that system and enforces `npm run typecheck:worker` on the exact head.
