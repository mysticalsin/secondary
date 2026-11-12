# Contract: promoted modules

One path per type means this table: one git path and one source blob per module. A name re-exported through the agent-ui barrel is not a second path. The committed file is the source blob minus its leading provenance comment. N is the number of lines removed. None of these four blobs has a blank line after that comment.

QA, for each row:

- `git cat-file -p <blob> | tail -n +<N+1> | git hash-object --stdin` equals `git rev-parse HEAD:<git path>`.
- `git cat-file -p <blob> | head -n <N>` contains only comment lines and blank lines.

`packages` is the tracked symlink to `recovered-source/shared/packages` (blob `79a67f92b7f877ab356884d89c0d307bdf2a9e83`). `git rev-parse HEAD:packages/...` is not a check. The import path below is the same file as the git path.

| Order | Git path | Import path, same file | Source blob | N |
|---|---|---|---|---|
| 1 | `recovered-source/worker/src/types.ts` | `recovered-source/worker/src/types.ts` | `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` | 8 |
| 2 | `recovered-source/shared/packages/contracts/src/agent-ui/index.ts` | `packages/contracts/src/agent-ui/index.ts` | `ed80553761da2db13495c6eb250a438d7ef54327` | 7 |
| 3 | `recovered-source/shared/packages/contracts/src/view-plan.ts` | `packages/contracts/src/view-plan.ts` | `d4b092167f4e1875d0254c98499a979cbd305dd6` | 13 |
| 4 | `recovered-source/worker/src/generated/view-plan.validator.d.ts` | `recovered-source/worker/src/generated/view-plan.validator.d.ts` | `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c` | 5 |

The barrel re-exports `./schemas.ts`, `./library.ts`, `./view.ts`, `./lock.ts`, and `./planner.ts`. T005 does not promote them. They stay at these blobs:

| Sibling, under `recovered-source/shared/packages/contracts/src/agent-ui/` | Blob, unchanged by T005 |
|---|---|
| `schemas.ts` | `3676979bf3ef060c63fb6d5c80ffaa561e140508` |
| `library.ts` | `405d7b636c03bc33e661e8c67aaa68ea42933b25` |
| `view.ts` | `2facce60ffe96b2475c93ffa0e51d1fbd6a660b3` |
| `lock.ts` | `3c6dd1f623748116c28caaf7c0e64cfe1ef46019` |
| `planner.ts` | `98cb0da3fe5ddced279b0c96c30724667dcbb6a9` |

Not promoted from `db3e8548` even though those paths exist there:

| Path at `db3e8548` | Blob there | Do not use |
|---|---|---|
| `reconstruction/packages/contracts/src/view-plan.ts` | `82bac154e813b9fa59c2f93e871127e0c37c3b8e` | Use `d4b092167f4e1875d0254c98499a979cbd305dd6` |
| `reconstruction/worker-root/worker/src/generated/view-plan.validator.d.ts` | `a403845f6cd562a3b2488e0e736aa57aaf57cbd2` | Use `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c` |

The reconstruction sibling paths at `db3e8548` are symlinks to the recovered files above. Do not copy those symlink blobs.

Constitution II applies as written. The committed file does not contain the leading comment. The commit message records `db3e8548`, the full source blob id, N, and the removed header verbatim. The verbatim headers are in T004–T007.

## Env

| Item | Value |
|---|---|
| Blob | `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` |
| Written file | `recovered-source/worker/src/env.d.ts` |
| Imports | `import type { TenantPolicy } from "./tenant-policy.ts";` and `import type { Workspace } from "./workspace.ts";` |
| Class exports | `recovered-source/worker/src/tenant-policy.ts:152` `export class TenantPolicy extends DurableObject<Env> {`; `recovered-source/worker/src/workspace.ts:172` `export class Workspace extends BrainBase {` |
| Not copied | `./worker-root/worker/src/tenant-policy.ts` and `./worker-root/worker/src/workspace.ts`. No `reconstruction/` path |
| Hash | `git hash-object` of the written file is not required to equal the blob, because the two import lines differ |
| Names | `interface Env` member names match the blob. A name in only one of the blob and the worker `env.<name>` reads is a finding, not a real mismatch |
| Output | A finding list. Names only. No secret values |

## Gates after every implementation commit

| Check | Expected |
|---|---|
| `npm test` | 403 passed, 0 failed, except one still-red real-mismatch test this spec required |
| `npm run typecheck` | 0 errors |
| `npm run typecheck:worker` | Fewer `error TS` lines than the parent commit |
| `harness/runtime/whole-api-causes.test.ts` line 111 | Checked only when that file is in the tree. This branch does not contain it |

## Remaining codes

Cited from `1e8f67c:harness/runtime/whole-api-causes.test.ts`. `:114`–`:117` are the four records after TS7016. TS7016 is `:113`.

| Code | Citation | Cleared by |
|---|---|---|
| TS7053 | `:114`, `PERSONAS[s.persona]` in `admin/routes.ts` (line 910 in that record, line 914 on this branch) | T004 |
| TS2366 | `:115`, `agent/tools.ts:260` | T005 |
| TS7006 | `:116`, `ai/planner.ts:38` | T006 |
| TS7006 | `:116`, `ux/notify.ts:45` | T004 |
| TS7006 | `:116`, `auth/config.ts:54` | T011 |
| TS2322 | `:117`, `stubs.ts:33` and `:42` | T011 |
| TS7016 | `:113`, `genui.ts:10` | T007 |
| TS2304 | `:111`, count 68, no `Env` | T011 |
| TS2307 | `:112`, count 43, missing `types.ts`, the agent-ui barrel, and `view-plan.ts` | T004, T005, and T006 |
