# Runbook: backup and restore

## What is backed up

The ops worker (`secondary-ops-<env>`) runs a cron at 02:17 UTC. For every tenant it snapshots the TenantPolicy object and every Workspace object (company scopes and each Personal Brain) through the API's signed export endpoint. Each snapshot is one R2 object in `secondary-backups-<env>` (EU jurisdiction), AES-256-GCM encrypted JSONL, key `<YYYY-MM-DD>/<tenant>/tenant.jsonl.enc` or `.../ws-<scope>.jsonl.enc`. Snapshots older than 35 days are deleted by the same cron. Empty objects are skipped.

Not in the snapshots: the audit log (it is its own append-only R2 bucket `secondary-audit-<env>`; protect it with bucket-level controls), the OAuth KV store (clients re-register, users re-consent), per-minute rate counters.

Tenants snapshotted are `DEFAULT_TENANT_ID` and every tenant named in `TENANT_DOMAINS`. A tenant that is in neither is not backed up: add it to the mapping first.

## Keys

`BACKUP_KEY` (secret on the ops worker) decrypts every snapshot. Keep a copy in the key vault. Without it the snapshots are unreadable by design. Rotation: KEY-ROTATION.md.

## Restore, step by step

Restore replaces the whole object with the snapshot, all or nothing. It also bumps the revocation epoch so every session is re-checked. Anything written after the snapshot is lost, so pick the right snapshot. People erased since the snapshot was taken are erased again right after the restore: each erasure leaves a tombstone (principal id, pseudonym, addresses) in the tenant's own object for 90 days, outside every snapshot and backup, and a restore of a directory or a workspace applies the list again (the response carries `erasuresReapplied`).

1. Decide scope: one Workspace, one Personal Brain, or the TenantPolicy (directory, roles, grants, switches).
2. Allow restore. Only dev has `RESTORE_ENABLED=yes` by default. Staging and prod are `no` on both the ops and api workers: set `RESTORE_ENABLED` to `yes` in the `env.staging.vars` or `env.prod.vars` of `workers/api/wrangler.jsonc` and `workers/ops/wrangler.jsonc` for the duration, deploy with the pipeline (approval applies in prod), and set it back to `no` afterwards. Record both deploys in the incident log.
3. Export `OPS_URL` and `OPS_ADMIN_KEY` (from the key vault). In staging and prod the ops worker is behind Cloudflare Access: also export `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (an Access service token). Never paste the keys into chat or a file.
4. List: `scripts/restore.sh <env> list 2026-11-05/<tenant>/`
5. Dry run (decrypts and counts rows, changes nothing): `scripts/restore.sh <env> dry-run <key>`
6. Restore: `scripts/restore.sh <env> restore <key>` (prod also needs `CONFIRM_PROD=yes`). Restore the TenantPolicy before its Workspaces only if roles were damaged; they are independent. Outside dev this takes two people (M-02): the first call answers 202 `pending` and changes nothing (receipt `ops_restore_request`), then a different person, signed in to Access with their own identity or service token, runs the same command for the same snapshot within 24 hours. The same person asking again gets 409 `same_person`. The confirming call writes `ops_restore` (naming who asked first) and `ops_restore_done`. A confirmation is used once.
   Leavers, revoked NDA grants and memberships, role removals and kill switch changes made since the snapshot are replayed from the tenant's security journal right after a directory restore (it lives outside snapshots and backups, 90 days), and the revocation epoch only moves up. Grants given since the snapshot are not replayed: an administrator grants them again.
7. Verify: `GET /v1/ready`, then open the restored area as an affected user and read back the data. A restore is not done until the live result is read back.
8. Turn restore off again in prod (step 2 in reverse).

On demand snapshot before a risky change: `scripts/restore.sh <env> backup`.

## Errors

| Answer | Meaning |
|---|---|
| `restore_disabled` | `RESTORE_ENABLED` is not `yes` on the ops worker |
| `same_person` | the same Access identity asked twice; a different person must confirm (M-02) |
| `actor_required` | outside dev the restore needs an Access identity (the ops worker passes it) |
| `api_refused` | the API worker has restore off (its own flag), or the signature failed |
| `wrong_environment` | the snapshot was written by another environment; a restore never crosses environments |
| `cannot_decrypt` | wrong `BACKUP_KEY`, the object was renamed (the key name is authenticated), or it is corrupt. Try `BACKUP_KEY_PREVIOUS` after a rotation |
| `invalid_snapshot` | the file is not a snapshot for this schema; nothing was changed |
| `not_found` | the key does not exist; check `list` |

## Test it

Restore into staging at least once a quarter: take a backup, change data, restore, read back. The automated round trip lives in `workers/api/test/ops-backup.test.ts`.
