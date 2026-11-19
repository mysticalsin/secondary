import type { TenantPolicy } from "./tenant-policy.ts";
import type { Workspace } from "./workspace.ts";

declare global {
  interface Env {
    ASSETS: Fetcher;
    AUDIT: Fetcher;
    BLOBS: R2Bucket;
    CONNECTOR?: Fetcher;
    TENANT_POLICY: DurableObjectNamespace<TenantPolicy>;
    WORKSPACE: DurableObjectNamespace<Workspace>;

    ENVIRONMENT: string;
    DEFAULT_TENANT_ID: string;
    RATE_LIMIT_PER_MIN: string;

    ACCESS_AUD?: string;
    ACCESS_LINKED_EMAILS?: string;
    ACCESS_TEAM_DOMAIN?: string;
    AI_DAILY_TOKEN_BUDGET?: string;
    AI_ENABLED?: string;
    AI_MODEL?: string;
    AI_PROCESSOR_CONTRACT?: string;
    AI_TIMEOUT_MS?: string;
    AI_USER_DAILY_TOKEN_BUDGET?: string;
    ANTHROPIC_API_KEY?: string;
    AUDIT_KEY_API?: string;
    AUDIT_KEY_ERASE?: string;
    AUDIT_KEY_READ?: string;
    AUTH_MODE?: string;
    BRIEF_PROOF_KEY?: string;
    CONNECTOR_HMAC_KEY?: string;
    CONNECTOR_HMAC_KEY_PREVIOUS?: string;
    CONNECTOR_HMAC_KID?: string;
    CONNECTOR_HMAC_KID_PREVIOUS?: string;
    DEV_AUTH_BYPASS_EMAIL?: string;
    DO_JURISDICTION?: string;
    ENTRA_ALLOW_GUESTS?: string;
    ENTRA_CLIENT_ID?: string;
    ENTRA_CLIENT_SECRET?: string;
    ENTRA_TENANT_ID?: string;
    INTERNAL_HMAC_KEY?: string;
    INTERNAL_HMAC_KEY_PREVIOUS?: string;
    INTERNAL_HMAC_KID?: string;
    INTERNAL_HMAC_KID_PREVIOUS?: string;
    MCP_PUBLIC_URL?: string;
    OPS_HMAC_KEY?: string;
    OPS_HMAC_KEY_PREVIOUS?: string;
    OPS_HMAC_KID?: string;
    OPS_HMAC_KID_PREVIOUS?: string;
    PSEUDONYM_KEY?: string;
    RESTORE_ENABLED?: string;
    RETENTION_BRIEF_DAYS?: string;
    RETENTION_DRAFT_DAYS?: string;
    SCIM_TENANT_ID?: string;
    SCIM_TOKEN?: string;
    SEED_TOKEN?: string;
    TENANT_DOMAINS?: string;
    WIKI_ALARMS?: string;
    WIKI_SEARCH_PER_MIN?: string;
    WIKI_SEED?: string;
    WIKI_WRITE_PER_MIN?: string;
  }
}

export {};
