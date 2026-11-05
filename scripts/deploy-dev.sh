#!/usr/bin/env bash
# Deploy the dev environment: audit, then api, then mcp. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN
# and CLOUDFLARE_ACCOUNT_ID) in the environment. Idempotent: resources and secrets are created only when missing.
# Secret values are generated in memory, piped straight into `wrangler secret put` and never printed.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

wr() { corepack pnpm exec wrangler "$@"; }
in_worker() { local w="$1"; shift; (cd "$ROOT/workers/$w" && wr "$@"); }
die() { echo "error: $*" >&2; exit 1; }

API=secondary-api-dev
MCP=secondary-mcp-dev
AUDIT=secondary-audit-dev
KV_TITLE="${MCP}-OAUTH_KV"

# ---- build ----
echo "==> build"
corepack pnpm install --frozen-lockfile
corepack pnpm -r build

# ---- R2 buckets (EU jurisdiction) ----
for b in secondary-blobs-dev secondary-audit-dev; do
  if wr r2 bucket list --jurisdiction eu 2>/dev/null | grep -Eq "^name:[[:space:]]+${b}\$"; then
    echo "==> R2 bucket $b exists"
  else
    echo "==> create R2 bucket $b (eu)"
    wr r2 bucket create "$b" --jurisdiction eu
  fi
done

# ---- KV namespace for the mcp OAuth provider ----
MCP_CFG="$ROOT/workers/mcp/wrangler.jsonc"
if grep -Eq '"binding":[[:space:]]*"OAUTH_KV"[[:space:]]*,[[:space:]]*"id"' "$MCP_CFG"; then
  echo "==> KV OAUTH_KV id already in workers/mcp/wrangler.jsonc"
else
  KV_ID="$(in_worker mcp kv namespace list 2>/dev/null | KV_TITLE="$KV_TITLE" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const m = JSON.parse(s).find((n) => n.title === process.env.KV_TITLE);
      if (m) process.stdout.write(m.id);
    });')"
  if [ -z "$KV_ID" ]; then
    echo "==> create KV namespace $KV_TITLE"
    KV_ID="$(in_worker mcp kv namespace create OAUTH_KV 2>&1 | grep -Eo '[0-9a-f]{32}' | head -n1)"
  fi
  [ -n "$KV_ID" ] || die "could not determine the OAUTH_KV namespace id"
  KV_ID="$KV_ID" node -e '
    const fs = require("fs"); const p = process.argv[1];
    const s = fs.readFileSync(p, "utf8");
    const t = s.replace(/\{ "binding": "OAUTH_KV" \}/, `{ "binding": "OAUTH_KV", "id": "${process.env.KV_ID}" }`);
    if (t === s) { console.error("OAUTH_KV binding not found in " + p); process.exit(1); }
    fs.writeFileSync(p, t);' "$MCP_CFG"
  echo "==> wrote the OAUTH_KV id into workers/mcp/wrangler.jsonc (a namespace id, not a secret): commit that change"
fi

# ---- deploy: audit, api, mcp (service bindings need the target to exist) ----
deploy() {
  local w="$1" out
  echo "==> deploy $w"
  out="$(in_worker "$w" deploy 2>&1 | tee /dev/stderr)"
  DEPLOY_OUT="$out"
}
deploy audit
deploy api
API_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
deploy mcp
MCP_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"

# ---- secrets (only when missing) ----
has_secret() { # worker name
  in_worker "$1" secret list --format json 2>/dev/null | grep -Eq "\"name\":[[:space:]]*\"$2\""
}
new_value() { openssl rand -base64 32; }

# A secret that lives on one worker only.
single_secret() { # worker name
  if has_secret "$1" "$2"; then echo "==> $1: $2 already set"; return; fi
  echo "==> $1: set $2"
  new_value | in_worker "$1" secret put "$2" >/dev/null
}

# A secret shared by several workers: one value, same on all of them. All-or-nothing.
shared_secret() { # name worker...
  local name="$1"; shift
  local missing=() present=() w
  for w in "$@"; do
    if has_secret "$w" "$name"; then present+=("$w"); else missing+=("$w"); fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then echo "==> $name already set on: $*"; return; fi
  if [ "${#present[@]}" -gt 0 ]; then
    die "$name is set on [${present[*]}] but not on [${missing[*]}]; delete it first (wrangler secret delete $name) on the worker that has it, then re-run"
  fi
  echo "==> set $name on: $*"
  local value
  value="$(new_value)"
  for w in "$@"; do printf '%s' "$value" | in_worker "$w" secret put "$name" >/dev/null; done
  unset value
}

shared_secret INTERNAL_HMAC_KEY api mcp
shared_secret AUDIT_KEY_API audit api
shared_secret AUDIT_KEY_MCP audit mcp
shared_secret AUDIT_KEY_READ audit api
single_secret api SEED_TOKEN

echo
echo "Dev deployed."
echo "  api: ${API_URL:-<see wrangler output above>}"
echo "  mcp: ${MCP_URL:-<see wrangler output above>}"
echo "Next: create the two Cloudflare Access apps, then run scripts/set-access.sh <team-domain> <api-aud> <mcp-aud>."
