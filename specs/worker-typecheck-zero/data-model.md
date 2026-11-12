# Data model: Worker typecheck zero

No database table, schema, or stored row changes. The entities are files and counts.

## Promoted module

| Field | Rule |
|---|---|
| Destination | One of the four paths in the contract |
| Blob | The git object id in the contract. The file bytes match that object |
| Order | types.ts, then agent-ui/index.ts, then view-plan.ts, then view-plan.validator.d.ts |
| Location count | One path on the branch after the commit that adds it |
| Provenance | Commit message only. Not a comment in the file |

## Env name check

| Field | Rule |
|---|---|
| Source | Blob `841f0dbc97ac0c6d5caaf83bf25b1609a08bdb2d` |
| Compared to | Property names the Worker source reads on `Env` |
| Stored value | None. Names only |
| Mismatch | A finding. Not a silent edit |
| Import paths inside the blob | They point at `reconstruction/worker-root/...`. That is a mismatch to log. No tsconfig path may repair it |

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
