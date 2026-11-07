/**
 * NEW RECONSTRUCTION for secondary-connector-dev. Not recovered source.
 * Binding shapes follow recovered calls: SQLite Durable Object, Workflow, Queue, service fetch.
 * No secret values. Compatibility date was not recovered.
 */
import type { ConnectorState } from "./worker/src/state.ts";
import type { SyncParams } from "./worker/src/workflow.ts";

interface SyncMessage {
  tenantId: string;
  sourceId: string;
  reason: "cron" | "manual";
}

declare global {
  interface Env {
    CONNECTOR_STATE: DurableObjectNamespace<ConnectorState>;
    SOURCE_SYNC: Workflow<SyncParams>;
    SYNC_QUEUE: Queue<SyncMessage>;
    API: Fetcher;
    ENVIRONMENT: string;
    ACL_MAX_AGE_SECONDS?: string;
    CALENDAR_ENABLED?: string;
    CONNECTOR_ENABLED?: string;
    CONNECTOR_HMAC_KEY?: string;
    CONNECTOR_HMAC_KEY_PREVIOUS?: string;
    CONNECTOR_HMAC_KID?: string;
    CONNECTOR_HMAC_KID_PREVIOUS?: string;
    CONNECTOR_TENANTS?: string;
    DEFAULT_TENANT_ID?: string;
    DO_JURISDICTION?: string;
    GRAPH_CLIENT_ID?: string;
    GRAPH_CLIENT_SECRET?: string;
    GRAPH_TENANT_ID?: string;
  }
}
export {};
