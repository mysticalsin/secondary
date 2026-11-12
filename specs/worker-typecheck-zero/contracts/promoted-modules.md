# Contract: promoted modules

QA checks this table against `git rev-parse HEAD:path` after each commit. The object id must equal the blob column. The path must be the only copy.

| Order | Destination | Blob |
|---|---|---|
| 1 | `recovered-source/worker/src/types.ts` | `e8a6cc08cd5cf4bdc4ab102a0c2c5d00ac430e9e` |
| 2 | `packages/contracts/src/agent-ui/index.ts` | `ed80553761da2db13495c6eb250a438d7ef54327` |
| 3 | `packages/contracts/src/view-plan.ts` | `d4b092167f4e1875d0254c98499a979cbd305dd6` |
| 4 | `recovered-source/worker/src/generated/view-plan.validator.d.ts` | `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c` |

Not promoted from `db3e8548` even though those paths exist there:

| Path at `db3e8548` | Blob there | Do not use |
|---|---|---|
| `reconstruction/packages/contracts/src/view-plan.ts` | `82bac154e813b9fa59c2f93e871127e0c37c3b8e` | Use `d4b092167f4e1875d0254c98499a979cbd305dd6` |
| `reconstruction/worker-root/worker/src/generated/view-plan.validator.d.ts` | `a403845f6cd562a3b2488e0e736aa57aaf57cbd2` | Use `5a3b92e373e2ba7c38cc43e9b217719b0f8db13c` |

## Env

| Item | Value |
|---|---|
| Blob | `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` |
| When | After the four promotions, and only if no wrangler config is on the branch |
| Output | A finding list. Names and mismatches. No secret values |

## Gates after every implementation commit

| Check | Expected |
|---|---|
| `npm test` | 403 passed, 0 failed, except one still-red mismatch test this spec required |
| `npm run typecheck` | 0 errors |
| `npm run typecheck:worker` | Fewer `error TS` lines than the parent commit |
| `harness/runtime/whole-api-causes.test.ts` | Absent, as at `387f2c8b`, or byte-identical if it was already present |
