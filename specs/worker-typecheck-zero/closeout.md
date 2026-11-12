# Closeout: Worker typecheck zero

Recovered-source tree `310531c5c2ea5e451099f626f8cf63f9dc1153ef`. No recovered-source byte is changed by this closeout. No task is dropped.

runTool unknown-name path is guarded upstream at loop.ts:155 (isToolName, Object.hasOwn(AGENT_TOOLS)); only caller loop.ts:162 via turn.ts:188; no backlog item

## T001

Baseline recorded in `quickstart.md` at `7ab6d9529838ed1447a659986aa1092fdc0469c9` for head `387f2c8b1662283ca74e657ec85f97068c011ab7`: worker typecheck 119 errors (TS2304 68, TS2307 43, TS7006 3, TS2322 2, TS7053 1, TS7016 1, TS2366 1), root typecheck 0, `npm test` 403/0.

## T002

`db3e8548bf74b863847ed9fbf1b71573dd384ee8` is not an ancestor of this branch. The promoted blobs are readable from the object store. The provenance check at `c865a7ec984727db92daaaae643033a59bfa3569` resolves each one.

## T003

`tsconfig.json` and `tsconfig.worker.json` have no `reconstruction/` path, include, or `preserveSymlinks` entry. No commit from `387f2c8b1662283ca74e657ec85f97068c011ab7` to this head edits either file.

## T009

Each promoted git path's blob is the tail, not the source blob. Sibling blobs and the `packages` symlink are unchanged.

| Path | `git rev-parse HEAD:<path>` | Source blob, different |
|---|---|---|
| `recovered-source/worker/src/env.d.ts` | `365eac99a5fb774699b0391d9b8547bf84ae8c37` | `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` |
| `recovered-source/worker/src/types.ts` | `9ac4ad39f25594123b9bac8b7114ce095bf8ca8d` | `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` |
| `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` | `1ca677e5c91e3bf308a06def277ce0e2a1061de7` | `ed80553761da2db13495c6eb250a438d7ef54327` |
| `recovered-source/shared/packages/contracts/src/view-plan.ts` | `3e51e45bee512e7ff4cfbb2d600a9ba2af115ab5` | `d4b092167f4e1875d0254c98499a979cbd305dd6` |
| `recovered-source/worker/src/generated/view-plan.validator.d.ts` | `2dd6cb7ef1f401acc62098db60e650926b0e3101` | `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c` |

Sibling blobs: `schemas.ts` `3676979bf3ef060c63fb6d5c80ffaa561e140508`, `library.ts` `405d7b636c03bc33e661e8c67aaa68ea42933b25`, `view.ts` `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3`, `lock.ts` `3c6dd1f623748116c28caaf7c0e64cfe1ef46019`, `planner.ts` `98cb0da3fe5ddced279b0c96c30724667dcbb6a9`. `packages` is `79a67f92b7f877ab356884d89c0d307bdf2a9e83`.

## T010 and T017

`interface Env` in `recovered-source/worker/src/env.d.ts` has 55 member names. Worker reads of `env.<NAME>` with an uppercase binding name are the same 55 names. The symmetric difference is empty. No one-sided name remains, so none is waived. `env.c` and `env.brains` in `recovered-source/worker/src/agent/tools.ts` are fields of `ToolEnv`, not members of `interface Env`. No secret value is recorded.

## T012

No promotion reported an `error TS` line its parent did not report. No red mismatch test was added. The empty Env name difference gets no red test.

## T008 and T013

Each promotion lowered the worker `error TS` count and added no new line. The count is 0 at `9f3a2c311f1d80bf51db638a26d10fa38464d49c`.

| Commit | Task | Worker `error TS` lines |
|---|---|---|
| `387f2c8b1662283ca74e657ec85f97068c011ab7` | baseline | 119 |
| `21e06d8ba610565c9f7cded5ca111a0ababfc454` | T018 | 119 |
| `c89008c484d812bf6793d475b06629e193cfa628` | T011 | 48 |
| `f0a06db50586b7e3d7c88e8cd111412ea222432e` | T004 | 11 |
| `02ee5b6fd2edc7978c7fbb8a012bce06a8d87c2f` | T005 | 4 |
| `b0f5ae8c5dbcff15607f78334caac3a31fc2dd03` | T006 | 1 |
| `9f3a2c311f1d80bf51db638a26d10fa38464d49c` | T007 | 0 |

## T014

`harness/runtime/whole-api-causes.test.ts` is not in this tree. The line 111 rule does not apply.

## T015

Main `190cd04877812c1d238c4468e98a8714086b457f` has no CI config. This branch adds none. Hands-on Worker smoke is N/A: the branch has no wrangler config.

## T016

From `387f2c8b1662283ca74e657ec85f97068c011ab7` to this head, `recovered-source` gains five files and modifies none. There is no schema change and no stored-data change.

## T024

The fresh-clone exit codes are the writer report for this head. They are not copied back into this commit, so the verified tree stays the closeout commit.
