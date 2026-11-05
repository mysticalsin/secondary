# Runbook: key rotation

Secrets are set with `wrangler secret put <NAME> --env <staging|prod>` (no `--env` for dev). Values are never written to files or chat. Rotate on a schedule (at least yearly), on staff change, and immediately on suspected exposure.

| Secret | Where | Effect of rotating |
|---|---|---|
| `INTERNAL_HMAC_KEY` | api, mcp, ops (same value) | Signed calls fail until all three have the new value. Do all three in one sitting; MCP and ops calls fail in between, which is safe (fail closed). |
| `AUDIT_KEY_API`, `AUDIT_KEY_MCP`, `AUDIT_KEY_READ`, `AUDIT_KEY_ERASE` | audit plus its one or two callers | The caller gets 401 from audit until updated; the API refuses mutations while audit is unavailable. Put the new value on the caller first only if the audit worker accepts both; it does not, so update audit then the caller back to back. |
| `PSEUDONYM_KEY` | api | Existing pseudonyms stay as they are, but the same person would map to a new pseudonym later. Rotate only after a decision; erasures are refused while it is unset. |
| `BACKUP_KEY` | ops | See below. |
| `OPS_ADMIN_KEY` | ops | Guards list, backup and restore. Rotate freely; update the key vault. |
| `SEED_TOKEN` | api, dev only | Dev only. |
| Entra client secret, Anthropic key, Access `ACCESS_AUD` | per workstream | Owned by the ID and AI workstreams. |

## BACKUP_KEY rotation (no snapshot is lost)

1. Generate the new key (`openssl rand -base64 32`) and store it in the key vault.
2. Put the old value into `BACKUP_KEY_PREVIOUS` on the ops worker, then the new value into `BACKUP_KEY`. New snapshots use the new key; old ones still open through the previous key.
3. Run `scripts/restore.sh <env> backup`, then a `dry-run` on an old key and a new key to prove both open.
4. After 35 days all old snapshots are pruned. Then delete `BACKUP_KEY_PREVIOUS` (`wrangler secret delete BACKUP_KEY_PREVIOUS --env <env>`) and the old vault entry.

## Order for a full rotation after an incident

1. Switch `mcp` off (INCIDENT.md).
2. Rotate `INTERNAL_HMAC_KEY`, the audit keys, `OPS_ADMIN_KEY`.
3. Rotate Entra and Anthropic secrets with their owners.
4. Verify `GET /v1/ready` and one signed round trip (a backup run: `scripts/restore.sh <env> backup`).
5. Switch `mcp` back on (two people in prod).

Scripted first-time setup: `scripts/deploy.sh <env>` sets any missing secret and refuses to overwrite one that exists.
