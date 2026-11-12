# Data model: Worker typecheck zero

No database table, schema, or stored row changes. The entities are files and counts.

## Promoted module

| Field | Rule |
|---|---|
| Destination | The git path in the contract. One path, one blob |
| Blob | The source blob id in the contract. The committed file is that blob minus the first N lines |
| N | 8, 7, 13, and 5. No blank line follows the comment in any of the four |
| Order | `env.d.ts` first (N=9, tail hash `a8e2ea493e635421b1acfb0ad5e7557ed39c4d73`, then the two import replacements), then types.ts, then the agent-ui barrel, then view-plan.ts, then view-plan.validator.d.ts |
| Location count | One git path on the branch. A barrel re-export is not another path. The five siblings keep their current blobs |
| Provenance | Commit message records `db3e8548`, the full blob id, N, and the removed header verbatim. The committed file does not contain that comment |
| Manifest | One entry in `reconstructed-manifest.json` in the same commit. Fields are path, `db3e8548`, the full source blob, N, the sha256 of the committed file, and spec-named byte edits |

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

## Reconstructed manifest entry

| Field | Rule |
|---|---|
| File | `reconstructed-manifest.json` at the repository root. `candidate-manifest.json` is not edited |
| List | `files`. Empty on T018. One new object on T011 and on T004 through T007 |
| path | The git path of the promoted file |
| sourceCommit | `db3e8548` |
| sourceBlob | The full promoted blob id |
| n | The header length for that blob |
| sha256 | SHA-256 hex of the committed file bytes. The contract table names each digest |
| byteEdits | `{ "before", "after" }` pairs. Empty except the two `env.d.ts` import lines |
| Tree | The recovered-source walk equals the union of the two path sets. The sets do not overlap |

## Finding

A finding names the Env property or the code read, and says which side is missing. It does not include a secret value, a token, or a key.
