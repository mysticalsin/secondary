#!/usr/bin/env bash
# Restore Durable Objects from encrypted snapshots through the ops worker of one environment.
#   scripts/restore.sh <env> list [prefix]        list snapshots (prefix example: 2026-11-05/tenant_x/)
#   scripts/restore.sh <env> backup               take a snapshot now
#   scripts/restore.sh <env> dry-run <key>        decrypt and count rows, change nothing
#   scripts/restore.sh <env> restore <key>        replace the Durable Object with the snapshot
# Needs OPS_URL (the ops worker origin) and OPS_ADMIN_KEY in the environment; the key is never printed.
# Restore works only where the ops and api workers have RESTORE_ENABLED=yes (dev and staging by default;
# see docs/runbooks/RESTORE.md for the temporary prod switch).
set -euo pipefail
set +x
die() { echo "error: $*" >&2; exit 1; }

ENVN="${1:-}"; CMD="${2:-}"; ARG="${3:-}"
case "$ENVN" in dev|staging|prod) ;; *) die "usage: scripts/restore.sh <dev|staging|prod> <list|backup|dry-run|restore> [key]" ;; esac
[ -n "${OPS_URL:-}" ] || die "set OPS_URL to the ops worker origin, for example https://secondary-ops-$ENVN.<account>.workers.dev"
OPS_ADMIN_KEY="${OPS_ADMIN_KEY:-}"; [ "${#OPS_ADMIN_KEY}" -ge 32 ] || die "set OPS_ADMIN_KEY (32+ chars)"
if [ "$ENVN" = "prod" ] && [ "$CMD" = "restore" ] && [ "${CONFIRM_PROD:-}" != "yes" ]; then
  die "restoring prod needs CONFIRM_PROD=yes"
fi

call() { # method path [json]
  local args=(-sS --fail-with-body -X "$1" -H "X-Ops-Key: ${OPS_ADMIN_KEY}" -H "Content-Type: application/json" "${OPS_URL%/}$2")
  if [ -n "${3:-}" ]; then args+=(--data "$3"); fi
  curl "${args[@]}"; echo
}
key_json() { # key dryRun
  KEY="$1" DRY="$2" node -e 'process.stdout.write(JSON.stringify({ key: process.env.KEY, dryRun: process.env.DRY === "true" }))'
}

case "$CMD" in
  list) call GET "/snapshots?prefix=${ARG}" ;;
  backup) call POST "/backup" "{}" ;;
  dry-run) [ -n "$ARG" ] || die "need a snapshot key"; call POST "/restore" "$(key_json "$ARG" true)" ;;
  restore) [ -n "$ARG" ] || die "need a snapshot key"; call POST "/restore" "$(key_json "$ARG" false)" ;;
  *) die "unknown command: $CMD" ;;
esac
