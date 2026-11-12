# Data model: Worker typecheck zero

No database table, schema, or stored row changes. The entities are files and counts.

## Promoted module

| Field | Rule |
|---|---|
| Destination | The git path in the contract. One path, one blob |
| Blob | The git object id in the contract. `git hash-object` of that path equals the object, including the blob's existing `NEW RECONSTRUCTION` comment |
| Order | types.ts, then the agent-ui barrel, then view-plan.ts, then view-plan.validator.d.ts |
| Location count | One git path on the branch. A barrel re-export is not another path. The five siblings keep their current blobs |
| Provenance | Commit message names `db3e8548` plus the blob id. The promotion adds no comment |

## Env name check

| Field | Rule |
|---|---|
| Source | Blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d`, for `interface Env` member names |
| Written file | `recovered-source/worker/src/env.d.ts` |
| Imports | `./tenant-policy.ts` and `./workspace.ts`. Not the blob's `./worker-root/worker/src/...` specifiers |
| Class lines | `tenant-policy.ts:152` exports `TenantPolicy`. `workspace.ts:172` exports `Workspace` |
| Compared to | Property names the Worker source reads as `env.<name>` |
| Stored value | None. Names only |
| Name finding | A name in only one of the two sets. Logged. Not a real mismatch. No behavior change |
| Real mismatch | A diagnostic the parent commit does not report |

## Typecheck count

| Field | Rule |
|---|---|
| Command | `npm run typecheck:worker` |
| Parent count | The `error TS` line count on the parent commit |
| Commit count | The `error TS` line count on this commit |
| Relation | Commit count is strictly less than parent count |
| End | 0 |

## Finding

A finding names the Env property or the code read, and says which side is missing. It does not include a secret value, a token, or a key.
