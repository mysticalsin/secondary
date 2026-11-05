# Runbook: key rotation

Secrets are set with `wrangler secret put <NAME> --env <staging|prod>` (no `--env` for dev). Values are never written to files or chat. Rotate on a schedule (at least yearly), on staff change, and immediately on suspected exposure.

| Secret | Where | Effect of rotating |
|---|---|---|
| `INTERNAL_HMAC_KEY` | api, mcp (same value) | Signs MCP -> api calls. Rotate with an overlap, see "HMAC keys" below. The MCP worker holds no other signing key. |
| `OPS_HMAC_KEY` | api, ops (same value) | Signs ops -> api calls (full export, restore, retention). Never set on mcp (M-01). Rotate with an overlap. |
| `CONNECTOR_HMAC_KEY` | api, connector (same value) | Signs api <-> connector calls in both directions. Rotate with an overlap. |
| `AUDIT_KEY_API`, `AUDIT_KEY_MCP`, `AUDIT_KEY_READ`, `AUDIT_KEY_ERASE` | audit plus its one or two callers | The caller gets 401 from audit until updated; the API refuses mutations while audit is unavailable. Put the new value on the caller first only if the audit worker accepts both; it does not, so update audit then the caller back to back. |
| `PSEUDONYM_KEY` | api | Existing pseudonyms stay as they are, but the same person would map to a new pseudonym later. Rotate only after a decision; erasures are refused while it is unset. |
| `BACKUP_KEY` | ops | See below. |
| `OPS_ADMIN_KEY` | ops | Guards list, backup and restore. Rotate freely; update the key vault. |
| `SEED_TOKEN` | api, dev only | Dev only. |
| Entra client secret, Anthropic key, Access `ACCESS_AUD` | per workstream | Owned by the ID and AI workstreams. |

## HMAC keys: rotation with an overlap (no lockstep deploy)

Every signed call carries a key id (`kid`) and a nonce, and the verifier remembers each nonce for two minutes (replay cache). A verifier accepts the current key and, during a rotation, the previous one, so senders can move one at a time.

1. On the verifier (api for `INTERNAL_HMAC_KEY` and `OPS_HMAC_KEY`, api and connector for `CONNECTOR_HMAC_KEY`) put the old value into `<NAME>_PREVIOUS` (key id `k0`, or set `<NAME>_KID_PREVIOUS`) and the new value into `<NAME>` with a new id in `<NAME>_KID` (for example `k2`).
2. Move the senders (mcp, ops, connector) to the new value and the new `<NAME>_KID`. Calls signed with either key verify during this step.
3. When every sender uses the new key, delete `<NAME>_PREVIOUS` from the verifier.
4. After the incident rotation below, skip the overlap: set only the new value everywhere. Calls fail closed in between.

Delete a leftover `INTERNAL_HMAC_KEY` from the ops worker (`wrangler secret delete INTERNAL_HMAC_KEY --env <env>`): ops no longer uses it.

## BACKUP_KEY rotation (no snapshot is lost)

1. Generate the new key (`openssl rand -base64 32`) and store it in the key vault.
2. Put the old value into `BACKUP_KEY_PREVIOUS` on the ops worker, then the new value into `BACKUP_KEY`. New snapshots use the new key; old ones still open through the previous key.
3. Run `scripts/restore.sh <env> backup`, then a `dry-run` on an old key and a new key to prove both open.
4. After 35 days all old snapshots are pruned. Then delete `BACKUP_KEY_PREVIOUS` (`wrangler secret delete BACKUP_KEY_PREVIOUS --env <env>`) and the old vault entry.

## Order for a full rotation after an incident

1. Switch `mcp` off (INCIDENT.md).
2. Rotate `INTERNAL_HMAC_KEY`, `OPS_HMAC_KEY`, `CONNECTOR_HMAC_KEY`, the audit keys, `OPS_ADMIN_KEY`.
3. Rotate Entra and Anthropic secrets with their owners.
4. Verify `GET /v1/ready` and one signed round trip (a backup run: `scripts/restore.sh <env> backup`).
5. Switch `mcp` back on (two people in prod).

Scripted first-time setup: `scripts/deploy.sh <env>` sets any missing secret and refuses to overwrite one that exists.
