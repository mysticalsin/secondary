#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname -- "$0")"
if [[ $# -gt 1 ]]; then
  echo "deploy.sh: unsupported arguments" >&2
  exit 2
fi
mode="dry-run"
if [[ $# -eq 1 ]]; then
  if [[ "$1" == "--dry-run" ]]; then
    mode="dry-run"
  elif [[ "$1" == "--apply" ]]; then
    mode="apply"
  else
    echo "deploy.sh: unsupported arguments" >&2
    exit 2
  fi
fi
if [[ "$mode" == "apply" ]]; then
  if [[ -n "${NODE_TEST_CONTEXT:-}" || "${NODE_ENV:-}" == "test" ]]; then
    echo "deploy.sh: apply-under-test" >&2
    exit 2
  fi
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node --experimental-strip-types deploy/guard.ts deploy "$tmp"
set +e
export WRANGLER_SEND_METRICS=false
if [[ "$mode" == "dry-run" ]]; then
  ./node_modules/.bin/wrangler deploy --dry-run --assets "$tmp" --config wrangler.jsonc
  status=$?
else
  ./node_modules/.bin/wrangler deploy --assets "$tmp" --config wrangler.jsonc
  status=$?
fi
exit "$status"
