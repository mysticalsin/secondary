# DPIA input: Secondary

Input for the data protection impact assessment. Facts as built (B2 operations workstream). The assessment, risk rating and legal basis belong to the DPO. Dev and staging hold synthetic data only. Real data is not loaded before a Mantu-owned Cloudflare account and a DPA are in place.

## 1. Purpose

Secondary is a company knowledge map for Mantu: a Company Map of departments, circles, accounts and governances, a review workflow, a private Personal Brain per person, and MCP access for LLM hosts, all under an admitted-view access model.

## 2. Data map

| Data | Where stored | Personal data | Retention | Notes |
|---|---|---|---|---|
| Directory: principal id, email, roles, memberships, NDA grants, elevations, revocation epoch, kill switches | Durable Object `TenantPolicy` (SQLite), EU jurisdiction | Yes (email, role) | While employed or under contract; erased on request | One object per tenant |
| Company items, comments, approvals, edit log, search index (labels) | Durable Object `Workspace`, one per scope, EU jurisdiction | Author ids, comment text | Company content kept; author id pseudonymised on erasure | Sensitivity flags (email, phone, health, family, HR) block contribution until acknowledged |
| Personal Brain: notes, drafts, briefs, saved views | Durable Object `Workspace` `personal:<id>`, EU jurisdiction | Yes, user generated | Drafts 90 days, briefs 30 days after the last change (vars `RETENTION_DRAFT_DAYS`, `RETENTION_BRIEF_DAYS`); notes until erasure | Owner only. Personal transcript segments are excluded from storage |
| Audit receipts: who, what, where, decision, request id, MCP client id | R2 `secondary-audit-<env>`, EU jurisdiction | Yes (principal id) | Kept for audit; principal id pseudonymised on erasure | Never content. Append only except the erasure route |
| Backups: encrypted JSONL snapshots of the objects above | R2 `secondary-backups-<env>`, EU jurisdiction | Yes, encrypted (AES-256-GCM) | 35 days | Key `BACKUP_KEY` held in the key vault |
| Blobs | R2 `secondary-blobs-<env>`, EU jurisdiction | Reserved for attachments | n/a | Unused by B1 and B2 routes except the readiness probe |
| OAuth provider state: client registrations, grants, token hashes | Workers KV `OAUTH_KV` (per environment) | Opaque ids, hashed tokens; props encrypted with a key only the token holder can unwrap | Token lifetime (1 hour access, 30 days refresh) | No Secondary content |
| Request logs: request id, principal hash, route pattern, status, latency | Workers Logs | Pseudonymous (hash of id) | Per Cloudflare log retention | Allowlisted fields only; no content, no emails, no tokens, no query strings |
| Sessions: Cloudflare Access JWT | Browser cookie, verified per request | Email in the token | Token lifetime | Not stored by Secondary |

## 3. Processors and sub-processors

| Processor | Role | Data | Basis for transfer |
|---|---|---|---|
| Cloudflare, Inc. | Hosting: Workers, Durable Objects, R2, KV, Access, logs | All of section 2 | DPA to be signed with the Mantu-owned account; EU jurisdiction on Durable Objects and R2 |
| Anthropic | AI processor (briefs), through the API with a key held as a secret; the feature is off without the key and has its own kill switch `ai` | Up to 8 excerpts per request, 12k-token ceiling, only for accounts whose contract constraint allows AI processing; personal transcript segments excluded | DPA and zero-retention terms to be confirmed by procurement |
| Microsoft | Entra ID (sign-in, groups, SCIM) and Graph (SharePoint, OneDrive, calendar, read only, Sites.Selected) | Identity attributes, content metadata and text read by the connector | Mantu's existing Microsoft agreement |
| Microsoft Azure DevOps | CI and deployment pipeline | Source code and synthetic fixtures only; secrets in variable groups | Mantu's existing agreement |
| LLM hosts using MCP (Claude, ChatGPT, Dust, others) | Receive what the signed-in person is already allowed to see, through scoped OAuth tokens | Content in the person's admitted view | Each host's own terms; the user consents per client, redirect hosts are allowlisted, `mcp` kill switch |

## 4. Residency notes (from the Cloudflare research)

- **D1 is not used.** There is no D1 database, so no EU restriction question arises there.
- **Durable Objects and R2 are created in the EU jurisdiction.** Code asks for `jurisdiction("eu")` on every object (`DO_JURISDICTION` is `eu` in staging and prod; only local dev turns it off), and every bucket is created with `--jurisdiction eu`. A test pins this. Jurisdiction restricts where the data is stored; it is not a guarantee about where code runs.
- **KV cannot be restricted to the EU.** It holds only OAuth provider state: hashed tokens, opaque ids, grant metadata and props encrypted with a key only the token holder can unwrap. No Secondary content, no emails in clear.
- **Workers logs and metrics may leave the EU.** Logs are therefore limited to an allowlist of ids and numbers (see the data map). Do not enable `tail` consumers, log pushes or analytics sinks without revisiting this.
- **Compute location.** Workers run near the caller, anywhere in Cloudflare's network. Durable Object code runs in the EU jurisdiction.
- **Backups** stay in EU R2 and are encrypted before they are written.

## 5. Data subject rights as built

- Access and portability: `GET /v1/admin/rights/export?principal=<id or email>` returns a JSON bundle (Personal Brain, authored company items, comments, approval and edit metadata, receipt metadata for the last 30 days). Platform admin only, audited.
- Erasure: `POST /v1/admin/rights/erase`, two different admins. Deletes the Personal Brain and its index entries, pseudonymises the person in company items, comments, approvals and audit receipts with a keyed hash (`PSEUDONYM_KEY`), removes the directory entry, revokes sessions. Company content is not deleted, because the company owns it; the author link is removed.
- Rectification: through the normal edit and review flow.
- Restriction and objection: kill switches per tenant feature; role removal per person.
- Limits to state in the DPIA: receipts older than 30 days are rewritten by erasure but cannot be listed through the audit read route (30 day window); backups hold the person's data for up to 35 days after erasure and are not rewritten (they age out; a restore must be followed by re-running the erasure).

## 6. Security measures

Access through Cloudflare Access plus verified JWT on every route; policy engine (`packages/policy`) on every read; fail closed on unknown principal, account or scope; two-person rule for release, restricted membership changes, erasure and (prod) re-enabling a kill switch; signed service-to-service calls (HMAC, 60 second window); security headers and CSP; request body limits; audit receipts with ids only; encrypted backups; separate dev, staging and prod with no shared bucket, KV or worker; dependency audit and SBOM in CI; secrets only in wrangler secrets and the key vault.

## 7. Open points for the DPO

1. Legal basis and the data protection notice for the Personal Brain.
2. DPA with Cloudflare, Anthropic and confirmation of the Microsoft terms.
3. Retention periods for notes and audit receipts.
4. Whether the 35 day backup tail after an erasure is acceptable or backups need crypto-shredding.
5. Whether Workers Logs retention and location are acceptable with the allowlisted fields.
