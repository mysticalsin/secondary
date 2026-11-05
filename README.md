# Secondary

Secondary is a code name (trademark check pending) for an account-scoped second brain for consulting account teams.
It keeps each customer account in its own boundary, with subspaces for general, contacts and restricted commercial material.
Every read goes through a single policy decision point that denies by default.
Slice 1 runs on synthetic data only and targets one internal Amaris account team.
B1 runs on Cloudflare (sponsor decision D4), synthetic data only, dev environment, nothing deployed.

Docs and spec (read-only from this repo, not copied here):
`/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/SecondBrain Amaris/docs/phase-1/`
Start with `ROADMAP.md` and `CHALLENGE_REPORT.md`.

## Run

Requires Node from `.nvmrc` and pnpm (see `packageManager` in `package.json`; `corepack enable` does it).

```sh
pnpm install
pnpm test        # vitest, all packages
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm --filter @secondary/fixtures generate:sample   # writes packages/fixtures/out and sample
```

## Run everything locally (multi-worker)

`corepack pnpm dev:all` builds the web app and runs three `wrangler dev` processes whose service bindings
resolve through wrangler's local dev registry, exactly as in a deploy:

| Process | URL                       | What                                                                                                                                     |
| ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| api     | http://localhost:8787     | web app (static assets) and `/v1/*`. Local sign-in is `DEV_AUTH_BYPASS_EMAIL` (localhost only); the header persona switch picks the role |
| mcp     | http://localhost:8788/mcp | remote MCP server, `/authorize`, `/token`, `/register`. Dev sign-in headers work on localhost only                                       |
| audit   | service binding only      | append-only audit log (own port 8789 for the dev registry, never used directly)                                                          |

```sh
corepack pnpm dev:all -- --seed     # start, then load the synthetic org (POST /v1/admin/seed)
corepack pnpm dev:all -- --no-build # skip the web build
```

Local-only secrets (`SEED_TOKEN`, `INTERNAL_HMAC_KEY`, `AUDIT_KEY_API`, `AUDIT_KEY_MCP`, `AUDIT_KEY_READ`) are generated once into
`.dev/secrets.json` and written to each worker's `.dev.vars`; both are git-ignored. `workers/api` and `workers/mcp` share
`INTERNAL_HMAC_KEY` (signed internal calls), and the audit worker's three keys decide who may append or read.

```sh
corepack pnpm e2e        # Playwright smoke against the stack (starts it when :8787 is down); needs: pnpm exec playwright install chromium
corepack pnpm e2e:mcp    # scripted MCP host: register, OAuth with PKCE, whoami, search, render_view
```

Web only: `corepack pnpm --filter @secondary/web dev:mock` (mock data, no API) or `dev` (Vite proxy to the api on :8787).

## Deploy (dev)

Dev only, synthetic data, nothing is deployed until you run these. Needs `wrangler login` (or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`) and `openssl`.

```sh
scripts/deploy-dev.sh                                           # build, create missing resources and secrets, deploy
scripts/set-access.sh <team>.cloudflareaccess.com <api-aud> <mcp-aud>   # after creating the two Access apps
```

`deploy-dev.sh` is idempotent. It builds everything, creates the EU R2 buckets `secondary-blobs-dev` and `secondary-audit-dev`
and the mcp `OAUTH_KV` namespace when missing (the KV id is written into `workers/mcp/wrangler.jsonc`: commit it), deploys audit,
api, then mcp, and sets these secrets only when absent: `INTERNAL_HMAC_KEY` (api and mcp, same value), `AUDIT_KEY_API`
(audit and api), `AUDIT_KEY_MCP` (audit and mcp), `AUDIT_KEY_READ` (audit and api) and `SEED_TOKEN` (api). Values come from
`openssl rand -base64 32`, go straight into `wrangler secret put` and are never printed. Secrets are set after the deploys
because a secret needs an existing worker; until then the workers fail closed. It prints the api and mcp workers.dev URLs.
To rotate a shared secret, delete it on every worker (`wrangler secret delete`) and re-run.

`set-access.sh` writes `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (public values) into the api and mcp `wrangler.jsonc` and redeploys both.

In dev the first authenticated API request seeds the synthetic org once (guarded by a `seeded_at` row in the TenantPolicy
Durable Object). Nothing seeds outside `ENVIRONMENT=dev`. `POST /v1/admin/seed` stays dev-only and needs Access plus `SEED_TOKEN`; it forces a reseed.

## Layout

- `apps/web`: React 18 + Vite, Mantu look (`docs/DESIGN-WEB.md`). Talks only to `/v1/*`; mock mode behind `VITE_MOCK=1`.
- `workers/api`, `workers/audit`, `workers/mcp`: Hono API with Durable Objects, append-only audit, remote MCP server.
- `packages/policy`, `packages/contracts`: the policy engine and the shared schemas and audit receipt contract.
- `e2e`: Playwright smoke tests and the scripted MCP client.

- `packages/fixtures`: seeded synthetic data generator (tenants, accounts, people, docs, meetings, canary tokens, hostile docs).
- `_relay/HANDOFF.md`: current state and next steps for the next agent or human.
