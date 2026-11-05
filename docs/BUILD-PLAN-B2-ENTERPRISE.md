# Build B2: enterprise-ready Secondary

Date: 2026-11-05. Plan: Claude Opus. Execution: Sonnet agents in worktrees, then an Opus security review. Sponsor: Tony.
Goal: take B1 (live dev on Cloudflare, synthetic data) to an enterprise-ready product. That means real SSO, real connectors, real AI, a governance console, operations, compliance tooling and full UX, while keeping every PRD boundary.

## What "enterprise ready" means here (acceptance)

1. **Identity.**
   - Microsoft Entra ID SSO through direct OIDC (auth code + PKCE). The Mantu tenant is configured by values only.
   - Cloudflare Access stays an optional outer gate.
   - Entra groups map to roles through an admin-managed table.
   - SCIM 2.0 provisioning endpoint (Users, Groups) for Entra. Deprovisioning revokes sessions within 60 s (revocation epoch).
   - Short sessions with re-check every 5 minutes.
2. **Authorization.**
   - Everything goes through `packages/policy`.
   - Admin console:
     - edit roles and grants as data;
     - memberships;
     - NDA named grants;
     - time-boxed elevation with a reason;
     - access-request workflow, where a steward approves and no auto-grant happens.
   - Any change to a restricted circle or account membership needs a second person.
3. **Connectors.**
   - Microsoft Graph SharePoint/OneDrive under `Sites.Selected`:
     - delta sync driven by Queues and Workflows;
     - read-time permission check;
     - a fail-closed ACL staleness bound;
     - SourceRecord lineage.
   - Calendar events for meeting briefs.
   - Contract tests against a recorded Graph mock. The live tenant is enabled by config only.
4. **AI processor.**
   - Claude through the Anthropic API, with the key held in a wrangler secret. If the key is absent the feature is disabled.
   - Briefs follow an evidence-first, cite-or-say-unknown rule. Limits: 8 excerpts, 12k-token ceiling, 1,500 output tokens.
   - Prompt-injection guards: tool-less generation, a separate system prompt, and treating retrieved text as data.
   - Transcript personal-segment exclusion (R-110).
   - An LLM GenUI planner sits behind the same ViewPlan schema.
   - The processor is disclosed in the UI.
5. **Operations.**
   - Separate `dev`, `staging` and `prod` wrangler environments.
   - CI for Azure DevOps: lint, typecheck, tests, e2e, deploy to staging on main, manual approval for prod.
   - Structured logs carrying IDs only, with no content or PII.
   - Health and readiness checks.
   - Durable Object to R2 snapshots on a cron, with a restore script.
   - Kill switches for each connector, the AI processor and MCP.
   - Runbooks for incident, restore, key rotation and offboarding.
6. **Privacy and rights.**
   - Data subject export and erasure across Personal Brain, contributions, derived indexes and audit, with audit pseudonymisation.
   - Retention jobs.
   - DPIA input pack: data map and processor list.
   - Customer contract-constraint record for each account, which gates AI processing.
7. **UX.**
   - Every flow is complete: personal note edit and versioning, review diff, account workspace management, admin console, access requests, notifications in-app.
   - FR and EN interface.
   - WCAG 2.2 AA pass.
   - Onboarding tour.
8. **Security.**
   - A second independent Opus review of B2.
   - Updated threat model.
   - Dependency audit and SBOM.
   - Security headers already in place.
   - MCP host allowlist kept.

## Workstreams (one agent each, separate worktrees)

| WS | Scope | Directories |
|---|---|---|
| ID | Entra OIDC, SCIM, group-to-role map, session and revocation | `workers/api/src/auth*`, `workers/api/src/scim*`, `packages/policy` (role map types) |
| GOV | admin console API and UI, access requests, elevation, NDA grants, two-person membership | `workers/api/src/admin*`, `apps/web/src/views/admin*` |
| CONN | Graph connector, Queues and Workflows, SourceRecord, ACL staleness | `workers/connector` (new), `packages/contracts` |
| AI | Anthropic processor, briefs, LLM planner, R-110 | `workers/api/src/ai*`, `apps/web/src/views/brief*` |
| OPS | environments, CI, snapshots and restore, kill switches, logs, runbooks, rights export and erase, retention | `workers/ops` (new), `scripts`, `docs/runbooks`, `.azure-pipelines` |
| UX | complete flows, i18n FR/EN, a11y, onboarding | `apps/web` (excluding the admin views) |

Integration agent merges after. Then an Opus security review. Then a staging deploy and live verification.

## What needs Tony or IT (cannot be done by agents)

- Entra app registration in the Mantu tenant (client ID, tenant ID, redirect URI), plus a client secret set by Tony through `wrangler secret put`.
- Graph `Sites.Selected` admin consent and the per-site grant.
- Anthropic API key, set by Tony through `wrangler secret put`.
- A Mantu-owned Cloudflare account and a DPA before real data. Dev and staging stay on synthetic data until then.
