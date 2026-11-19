#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# -gt 1 ]]; then
  echo "deploy.sh: unsupported arguments" >&2
  exit 2
fi
mode="deploy"
if [[ $# -eq 1 ]]; then
  if [[ "$1" != "--dry-run" ]]; then
    echo "deploy.sh: unsupported arguments" >&2
    exit 2
  fi
  mode="dry-run"
fi
node --experimental-strip-types deploy/guard.ts "$mode"
set +e
if [[ "$mode" == "dry-run" ]]; then
  export WRANGLER_SEND_METRICS=false
  ./node_modules/.bin/wrangler deploy --dry-run
  status=$?
else
  ./node_modules/.bin/wrangler deploy
  status=$?
fi
node --experimental-strip-types deploy/guard.ts cleanup
exit "$status"
