#!/usr/bin/env bash
# Usage: scripts/set-access.sh <team-domain> <api-aud> <mcp-aud>
# Writes ACCESS_TEAM_DOMAIN and ACCESS_AUD into workers/api and workers/mcp wrangler.jsonc (public values, not
# secrets; commit them) and redeploys both workers.
set -euo pipefail
set +x

[ "$#" -eq 3 ] || { echo "usage: $0 <team-domain> <api-aud> <mcp-aud>" >&2; exit 2; }
TEAM="$1"; API_AUD="$2"; MCP_AUD="$3"
[[ "$TEAM" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || { echo "error: team domain must look like <team>.cloudflareaccess.com" >&2; exit 2; }
[[ "$API_AUD" =~ ^[A-Za-z0-9]+$ && "$MCP_AUD" =~ ^[A-Za-z0-9]+$ ]] || { echo "error: AUD tags are alphanumeric" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set_vars() { # worker aud
  TEAM="$TEAM" AUD="$2" node -e '
    const fs = require("fs"); const p = process.argv[1];
    let s = fs.readFileSync(p, "utf8");
    const a = s.replace(/("ACCESS_TEAM_DOMAIN":\s*)"[^"]*"/, `$1"${process.env.TEAM}"`)
               .replace(/("ACCESS_AUD":\s*)"[^"]*"/, `$1"${process.env.AUD}"`);
    if (!a.includes(process.env.TEAM) || !a.includes(process.env.AUD)) { console.error("vars not found in " + p); process.exit(1); }
    fs.writeFileSync(p, a);' "$ROOT/workers/$1/wrangler.jsonc"
}
set_vars api "$API_AUD"
set_vars mcp "$MCP_AUD"

[ -f apps/web/dist/index.html ] || corepack pnpm --filter @secondary/web build
for w in api mcp; do
  echo "==> redeploy $w"
  (cd "$ROOT/workers/$w" && corepack pnpm exec wrangler deploy)
done
echo "Access vars set for api and mcp. Commit workers/api/wrangler.jsonc and workers/mcp/wrangler.jsonc."
