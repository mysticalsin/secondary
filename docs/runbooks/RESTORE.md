# Runbook: backup and restore

## What is backed up

The ops worker (`secondary-ops-<env>`) runs a cron at 02:17 UTC. For every tenant it snapshots the TenantPolicy object and every Workspace object (company scopes and each Personal Brain) through the API's signed export endpoint. Each snapshot is one R2 object in `secondary-backups-<env>` (EU jurisdiction), AES-256-GCM encrypted JSONL, key `<YYYY-MM-DD>/<tenant>/tenant.jsonl.enc` or `.../ws-<scope>.jsonl.enc`. Snapshots older than 35 days are deleted by the same cron. Empty objects are skipped.

Not in the snapshots: the audit log (it is its own append-only R2 bucket `secondary-audit-<env>`; protect it with bucket-level controls), the OAuth KV store (clients re-register, users re-consent), per-minute rate counters.

Tenants snapshotted are `DEFAULT_TENANT_ID` and every tenant named in `TENANT_DOMAINS`. A tenant that is in neither is not backed up: add it to the mapping first.

## Keys

`BACKUP_KEY` (secret on the ops worker) decrypts every snapshot. Keep a copy in the key vault. Without it the snapshots are unreadable by design. Rotation: KEY-ROTATION.md.

## Restore, step by step

Restore replaces the whole object with the snapshot, all or nothing. It also bumps the revocation epoch so every session is re-checked. Anything written after the snapshot is lost, so pick the right snapshot.

1. Decide scope: one Workspace, one Personal Brain, or the TenantPolicy (directory, roles, grants, switches).
2. Allow restore. Dev and staging have `RESTORE_ENABLED=yes` on both the ops and api workers. In prod it is `no`: set `RESTORE_ENABLED` to `yes` in the `env.prod.vars` of `workers/api/wrangler.jsonc` and `workers/ops/wrangler.jsonc` for the duration, deploy with the pipeline (approval applies), and set it back to `no` afterwards. Record both deploys in the incident log.
3. Export `OPS_URL` and `OPS_ADMIN_KEY` (from the key vault). Never paste the key into chat or a file.
4. List: `scripts/restore.sh <env> list 2026-11-05/<tenant>/`
5. Dry run (decrypts and counts rows, changes nothing): `scripts/restore.sh <env> dry-run <key>`
6. Restore: `scripts/restore.sh <env> restore <key>` (prod also needs `CONFIRM_PROD=yes`). Restore the TenantPolicy before its Workspaces only if roles were damaged; they are independent.
7. Verify: `GET /v1/ready`, then open the restored area as an affected user and read back the data. A restore is not done until the live result is read back.
8. Turn restore off again in prod (step 2 in reverse).

On demand snapshot before a risky change: `scripts/restore.sh <env> backup`.

## Errors

| Answer | Meaning |
|---|---|
| `restore_disabled` | `RESTORE_ENABLED` is not `yes` on the ops worker |
| `api_refused` | the API worker has restore off (its own flag), or the signature failed |
| `cannot_decrypt` | wrong `BACKUP_KEY`, the object was renamed (the key name is authenticated), or it is corrupt. Try `BACKUP_KEY_PREVIOUS` after a rotation |
| `invalid_snapshot` | the file is not a snapshot for this schema; nothing was changed |
| `not_found` | the key does not exist; check `list` |

## Test it

Restore into staging at least once a quarter: take a backup, change data, restore, read back. The automated round trip lives in `workers/api/test/ops-backup.test.ts`.
