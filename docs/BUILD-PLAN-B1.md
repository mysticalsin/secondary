# Build B1: Secondary on Cloudflare, end to end (synthetic data, dev environment)

Date: 2026-11-04. Planned by: Claude Opus. Executed by: Sonnet agents. Sponsor: Tony.
Sponsor direction: build the whole thing on Cloudflare (platform, security, interface, end to end). The UI follows the Mantu brand (Brand DNA visual identity plus the TOTO OS Mantu Edition look), not SkillTree.

## Decisions taken by this direction

- D4 hosting: **Cloudflare** (sponsor, 2026-11-04). Real data still waits for the activation gate (ROADMAP section 6).
- Data: synthetic fixtures only (D10).

## Architecture

```
Browser (React SPA, Mantu brand)  ──>  Cloudflare Access (SSO gate; Entra federation when IT registers the app)
        │  same origin
        ▼
workers/api (Hono, TypeScript)  ── verifies Access JWT ─> principal
   ├─ /v1/me              who am I, roles, "what you can see and do"
   ├─ /v1/map?lens=       admitted view, built server-side by packages/policy
   ├─ /v1/nodes/:id       node detail, items, backlinks, canDo per action
   ├─ /v1/actions         comment, contribute, edit, review, approve (exact revision, two-person)
   ├─ /v1/search          scoped search (FTS5 inside workspace DOs, fan-out only to admitted scopes)
   ├─ /v1/review          review queue
   └─ /v1/admin/seed      dev-only, service-token gated, loads synthetic fixtures
   Bindings:
   ├─ TENANT_POLICY  Durable Object per tenant (SQLite): roles, grants, memberships, revocation epoch
   ├─ WORKSPACE      Durable Object per workspace (global, department, circle, account): records, revisions, FTS5, outbox
   ├─ BLOBS          R2 bucket, jurisdiction eu: immutable content by sha256
   ├─ AUDIT          service binding to workers/audit (append-only, own R2 bucket eu)
   └─ ASSETS         static assets for apps/web
```

- **Policy:** `packages/policy` is the single decision point (grants as data: scope x actions x conditions). The API calls it for every read and action. The UI never decides access; it renders what the API returns.
- **Dev personas:** while there is no Entra group mapping, a dev-only persona switch maps the signed-in Access user to a synthetic role. It is enabled only when `ENVIRONMENT=dev`, it is shown in a visible banner, and a test asserts it is off in prod config.
- **Security baseline:** CSP and security headers; `Cache-Control: no-store` on authenticated responses; no secrets in code (wrangler secrets); CORS closed (same origin); audit receipt for each action; cross-tenant and cross-account canary tests; binding inventory test (the global-serving path holds no private bindings).

## Repo layout

```
apps/web            React 18 + Vite, Mantu brand, Today / Map / Accounts / Review / Governance / Admin
workers/api         Hono API worker + Durable Objects
workers/audit       append-only audit worker
packages/policy     pure TS policy engine + 25+ policy tests (ported from prototype)
packages/contracts  JSON Schemas v1.2 + ajv tests
packages/fixtures   existing synthetic generator (+ Mantu org structure: 12 governances, 433 use cases, 28 countries)
```

## Phases

1. Scaffold (1 agent): workspaces, wrangler configs, root scripts, CI.
2. Parallel (4 agents): policy engine, API + DOs + seed, web UI, contracts.
3. Integration (1 agent): wire UI to API, end-to-end local run with `wrangler dev`, Playwright smoke.
4. Review (Opus): security review of auth, policy and bindings.
5. Deploy to dev (after sponsor confirms account and Access): workers.dev or a dev route, Access application, seed synthetic data, read back.

## Done means

Local: all tests pass, `wrangler dev` serves the app, canary suite passes. Deployed: URL behind Access, synthetic data seeded and read back, policy checks pass against the live API, binding inventory recorded.
