# Contract: v24 bindings

Names and types only. No plain-text values and no secret values.

| Name | Type | Target |
|---|---|---|
| ACCESS_AUD | plain-text setting | name only |
| ACCESS_TEAM_DOMAIN | plain-text setting | name only |
| ASSETS | assets | upload directory `deploy/.staged`, SPA not-found handling, `run_worker_first` true, `base_path` `/` |
| AUDIT | service | `secondary-audit-dev` |
| AUDIT_KEY_API | secret | name only |
| AUDIT_KEY_ERASE | secret | name only |
| AUDIT_KEY_READ | secret | name only |
| BLOBS | R2 bucket | `secondary-blobs-dev`, jurisdiction `eu` |
| BRIEF_PROOF_KEY | secret | name only |
| CONNECTOR | service | `secondary-connector-dev` |
| CONNECTOR_HMAC_KEY | secret | name only |
| DEFAULT_TENANT_ID | plain-text setting | name only |
| DO_JURISDICTION | plain-text setting | name only |
| ENVIRONMENT | plain-text setting | name only |
| INTERNAL_HMAC_KEY | secret | name only |
| MCP_PUBLIC_URL | plain-text setting | name only |
| OPS_HMAC_KEY | secret | name only |
| PSEUDONYM_KEY | secret | name only |
| RATE_LIMIT_PER_MIN | plain-text setting | name only |
| RESTORE_ENABLED | plain-text setting | name only |
| RETENTION_BRIEF_DAYS | plain-text setting | name only |
| RETENTION_DRAFT_DAYS | plain-text setting | name only |
| SEED_TOKEN | secret | name only |
| TENANT_DOMAINS | plain-text setting | name only |
| TENANT_POLICY | Durable Object namespace | class `TenantPolicy` |
| WORKSPACE | Durable Object namespace | class `Workspace` |

Runtime settings that are not bindings: `compatibility_date` `2026-10-01`, compatibility flag `nodejs_compat`, `workers_dev` true, `preview_urls` false, `logpush` false, `keep_vars` true. No `observability` object, no `routes`, no `account_id`.

Migration: one tag, `v3`. `new_sqlite_classes`: `TenantPolicy`, `Workspace`.
