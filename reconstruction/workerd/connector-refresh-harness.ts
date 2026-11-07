/**
 * NEW RECONSTRUCTION test harness. Not a recovered route.
 * Calls the recovered sync function and, when the binding exists, the recovered Workflow class.
 * The Graph client here is a test double that fails. It is not a Graph implementation.
 */
import { GraphAuthError } from "../connector/worker/src/graph.ts";
import { ConnectorState, stateStub } from "../connector/worker/src/state.ts";
import { syncSource } from "../connector/worker/src/sync.ts";
import type { SourceDef } from "../connector/worker/src/types.ts";
import { SourceSyncWorkflow } from "../connector/worker/src/workflow.ts";

export { ConnectorState, SourceSyncWorkflow };

interface HarnessEnv {
  CONNECTOR_STATE: DurableObjectNamespace<ConnectorState>;
  SOURCE_SYNC?: {
    create(opts: { id: string; params: { tenantId: string; sourceId: string } }): Promise<{ id: string }>;
  };
  DO_JURISDICTION?: string;
  ENVIRONMENT: string;
}

const source = (id: string, now: number): SourceDef => ({
  id,
  provider: "sharepoint_drive",
  siteId: null,
  driveId: "drive_local_test",
  folderPath: "",
  scope: {
    kind: "circle",
    scopeId: "circle.local",
    gateNodeId: "gate.local",
    plane: "TEAM_RESTRICTED",
    classification: "internal_confidential",
    ownerRef: "owner_local",
  },
  enabled: true,
  createdAt: now,
});

export default {
  async fetch(request: Request, env: HarnessEnv): Promise<Response> {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId") ?? "";
    const sourceId = url.searchParams.get("sourceId") ?? "";
    if (url.pathname === "/harness/workflow") {
      if (!env.SOURCE_SYNC) return Response.json({ gap: "workflow_binding_absent" });
      try {
        const instance = await env.SOURCE_SYNC.create({
          id: `local-${crypto.randomUUID()}`,
          params: { tenantId, sourceId },
        });
        return Response.json({ created: true, id: instance.id });
      } catch (e) {
        return Response.json({
          gap: "workflow_not_executed",
          name: e instanceof Error ? e.name : "error",
        });
      }
    }
    if (url.pathname !== "/harness/refresh") return Response.json({ error: "not_found" }, { status: 404 });
    const store = stateStub(env as Env, tenantId);
    await store.putSource(source(sourceId, Date.now()));
    const outcome = await syncSource(
      {
        store,
        graph: {
          getJson: () => Promise.reject(new GraphAuthError()),
          getBytes: () => Promise.reject(new GraphAuthError()),
        },
        api: {
          upsert: () => Promise.reject(new Error("workspace_write_blocked")),
          remove: () => Promise.reject(new Error("workspace_write_blocked")),
          purge: () => Promise.reject(new Error("workspace_write_blocked")),
        },
        now: () => Date.now(),
      },
      tenantId,
      sourceId,
    );
    const cursor = await store.getCursor(sourceId);
    return Response.json({
      outcome,
      lastError: cursor.lastError,
      lastSyncAt: cursor.lastSyncAt,
      ready: false,
    });
  },
};
