#!/usr/bin/env bash
# Deploy one environment: audit, api, connector, mcp, ops. Usage: scripts/deploy.sh <dev|staging|prod>
# Needs `wrangler login` (or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID) in the environment.
# Prod needs CONFIRM_PROD=yes and BACKUP_KEY (from the key vault) in the environment.
# Idempotent: resources and secrets are created only when missing. Secret values are generated in
# memory, piped straight into `wrangler secret put` and never printed.
set -euo pipefail
set +x

die() { echo "error: $*" >&2; exit 1; }

TARGET="${1:-}"
case "$TARGET" in
  dev|staging|prod) ;;
  *) die "usage: scripts/deploy.sh <dev|staging|prod>" ;;
esac
# Guard first, before anything is built or touched.
if [ "$TARGET" = "prod" ] && [ "${CONFIRM_PROD:-}" != "yes" ]; then
  die "prod needs CONFIRM_PROD=yes (and a manual approval in the pipeline)"
fi
BACKUP_KEY="${BACKUP_KEY:-}"
if [ "$TARGET" = "prod" ] && [ "${#BACKUP_KEY}" -lt 32 ]; then
  die "prod needs BACKUP_KEY (32+ chars, from the key vault) in the environment: a generated key nobody can read back would make the backups unrecoverable"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# dev is the top level of each wrangler.jsonc; staging and prod are `env` blocks.
if [ "$TARGET" = "dev" ]; then ENV_ARGS=(); else ENV_ARGS=(--env "$TARGET"); fi
SFX="$TARGET"

# wrangler is installed per worker package, not at the root.
in_worker() { local w="$1"; shift; (cd "$ROOT/workers/$w" && corepack pnpm exec wrangler "$@"); }
wr() { in_worker api "$@"; }

API="secondary-api-$SFX"
MCP="secondary-mcp-$SFX"
AUDIT="secondary-audit-$SFX"
OPS="secondary-ops-$SFX"
CONNECTOR="secondary-connector-$SFX"
SYNC_QUEUE="secondary-sync-$SFX"
KV_TITLE="${MCP}-OAUTH_KV"

# ---- build ----
echo "==> build ($TARGET)"
corepack pnpm install --frozen-lockfile
corepack pnpm -r build

# ---- R2 buckets (EU jurisdiction) ----
for b in "secondary-blobs-$SFX" "secondary-audit-$SFX" "secondary-backups-$SFX"; do
  if wr r2 bucket list --jurisdiction eu 2>/dev/null | grep -Eq "^name:[[:space:]]+${b}\$"; then
    echo "==> R2 bucket $b exists"
  else
    echo "==> create R2 bucket $b (eu)"
    wr r2 bucket create "$b" --jurisdiction eu
  fi
done

# ---- KV namespace for the mcp OAuth provider (its own per environment) ----
MCP_CFG="$ROOT/workers/mcp/wrangler.jsonc"
KV_TOKEN="__KV_OAUTH_$(printf '%s' "$TARGET" | tr '[:lower:]' '[:upper:]')__"
need_kv=0
if [ "$TARGET" = "dev" ]; then
  grep -Eq '"binding":[[:space:]]*"OAUTH_KV"[[:space:]]*,[[:space:]]*"id"' "$MCP_CFG" || need_kv=1
else
  grep -q "$KV_TOKEN" "$MCP_CFG" && need_kv=1
fi
if [ "$need_kv" = "0" ]; then
  echo "==> KV OAUTH_KV id already in workers/mcp/wrangler.jsonc"
else
  KV_ID="$(in_worker mcp kv namespace list 2>/dev/null | KV_TITLE="$KV_TITLE" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const m = JSON.parse(s).find((n) => n.title === process.env.KV_TITLE);
      if (m) process.stdout.write(m.id);
    });')"
  if [ -z "$KV_ID" ]; then
    echo "==> create KV namespace $KV_TITLE"
    KV_ID="$(in_worker mcp kv namespace create OAUTH_KV "${ENV_ARGS[@]}" 2>&1 | grep -Eo '[0-9a-f]{32}' | head -n1)"
  fi
  [ -n "$KV_ID" ] || die "could not determine the OAUTH_KV namespace id"
  KV_ID="$KV_ID" KV_TOKEN="$KV_TOKEN" TARGET="$TARGET" node -e '
    const fs = require("fs"); const p = process.argv[1];
    const s = fs.readFileSync(p, "utf8");
    const t = process.env.TARGET === "dev"
      ? s.replace(/\{ "binding": "OAUTH_KV" \}/, `{ "binding": "OAUTH_KV", "id": "${process.env.KV_ID}" }`)
      : s.replace(process.env.KV_TOKEN, process.env.KV_ID);
    if (t === s) { console.error("OAUTH_KV binding not found in " + p); process.exit(1); }
    fs.writeFileSync(p, t);' "$MCP_CFG"
  echo "==> wrote the OAUTH_KV id into workers/mcp/wrangler.jsonc (a namespace id, not a secret): commit that change"
fi

# ---- queues (wrangler deploy does not create them; the Workflow is created by the connector deploy) ----
if wr queues list 2>/dev/null | grep -Fq "$SYNC_QUEUE"; then
  echo "==> queue $SYNC_QUEUE exists"
else
  echo "==> create queue $SYNC_QUEUE"
  wr queues create "$SYNC_QUEUE"
fi

# ---- deploy: audit, api, connector, mcp, ops (service bindings need the target to exist) ----
# The api binds CONNECTOR and the connector binds API, so neither can go first. A first deploy uploads
# a 503 placeholder under the connector's name, then the api (which binds the placeholder), then the
# real connector (which binds the real api). Later deploys skip the placeholder: the worker exists.
deploy() {
  local w="$1" out
  echo "==> deploy $w ($TARGET)"
  out="$(in_worker "$w" deploy "${ENV_ARGS[@]}" 2>&1 | tee /dev/stderr)"
  DEPLOY_OUT="$out"
}
worker_exists() { in_worker api deployments list --name "$1" >/dev/null 2>&1; }
ensure_placeholder() {
  if worker_exists "$1"; then echo "==> worker $1 exists"; return; fi
  echo "==> upload placeholder worker $1 (replaced by the real deploy below)"
  in_worker api deploy --config "$ROOT/scripts/placeholder-worker/wrangler.jsonc" --name "$1"
}
deploy audit
ensure_placeholder "$CONNECTOR"
deploy api
API_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
deploy connector
deploy mcp
MCP_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
deploy ops

# ---- secrets (only when missing) ----
has_secret() { # worker name
  in_worker "$1" secret list "${ENV_ARGS[@]}" --format json 2>/dev/null | grep -Eq "\"name\":[[:space:]]*\"$2\""
}
new_value() { openssl rand -base64 32; }

single_secret() { # worker name
  if has_secret "$1" "$2"; then echo "==> $1: $2 already set"; return; fi
  echo "==> $1: set $2"
  new_value | in_worker "$1" secret put "$2" "${ENV_ARGS[@]}" >/dev/null
}

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
  for w in "$@"; do printf '%s' "$value" | in_worker "$w" secret put "$name" "${ENV_ARGS[@]}" >/dev/null; done
  unset value
}

shared_secret INTERNAL_HMAC_KEY api mcp ops
# Signs api -> connector and connector -> api calls: the same value on both.
shared_secret CONNECTOR_HMAC_KEY api connector
shared_secret AUDIT_KEY_API audit api
shared_secret AUDIT_KEY_MCP audit mcp
shared_secret AUDIT_KEY_READ audit api
shared_secret AUDIT_KEY_ERASE audit api
single_secret api PSEUDONYM_KEY
single_secret ops OPS_ADMIN_KEY
if [ "$TARGET" = "dev" ]; then single_secret api SEED_TOKEN; fi

# BACKUP_KEY: prod takes the vault value from the environment; elsewhere it is generated.
if has_secret ops BACKUP_KEY; then
  echo "==> ops: BACKUP_KEY already set"
elif [ "$TARGET" = "prod" ]; then
  echo "==> ops: set BACKUP_KEY from the environment"
  printf '%s' "$BACKUP_KEY" | in_worker ops secret put BACKUP_KEY "${ENV_ARGS[@]}" >/dev/null
else
  single_secret ops BACKUP_KEY
fi

echo
echo "$TARGET deployed."
echo "Secrets this script does not set, because a person must supply or read them (wrangler secret put <NAME> --name <worker>):"
echo "  connector: GRAPH_CLIENT_SECRET   api: ENTRA_CLIENT_SECRET, SCIM_TOKEN, ANTHROPIC_API_KEY"
echo "  Each feature stays off until its secret exists: Graph sync, Entra sign-in, SCIM, the AI processor."
echo "  api: ${API_URL:-<see wrangler output above>}"
echo "  mcp: ${MCP_URL:-<see wrangler output above>}"
echo "Check: curl <api-url>/v1/ready should answer {\"ready\":true,...}."
echo "Next: create the Cloudflare Access apps, then run scripts/set-access.sh <team-domain> <api-aud> <mcp-aud>."
