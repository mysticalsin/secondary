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
tmp=$(mktemp -d)
chmod 0700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
if [[ "$mode" == "deploy" ]]; then
  node --experimental-strip-types deploy/guard.ts deploy "$tmp"
else
  node --experimental-strip-types deploy/guard.ts dry-run
fi
set +e
export WRANGLER_SEND_METRICS=false
if [[ "$mode" == "dry-run" ]]; then
  ./node_modules/.bin/wrangler deploy --dry-run --assets "$tmp"
  status=$?
else
  ./node_modules/.bin/wrangler deploy --assets "$tmp"
  status=$?
fi
exit "$status"
