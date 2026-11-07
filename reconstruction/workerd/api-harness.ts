/**
 * NEW RECONSTRUCTION test harness. Not a recovered route and not an original Worker.
 * Re-exports the recovered API handler and calls recovered Durable Object methods.
 */
import app, { TenantPolicy, Workspace } from "../worker-root/worker/src/index.ts";

export { TenantPolicy, Workspace };

interface HarnessEnv {
  WORKSPACE: DurableObjectNamespace;
  TENANT_POLICY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: HarnessEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/harness/workspace") {
      const name = url.searchParams.get("name") ?? "";
      const ns = env.WORKSPACE;
      const stub = ns.get(ns.idFromName(name)) as DurableObjectStub<{
        listByKind(kind: string, limit: number): Promise<unknown[]>;
      }>;
      try {
        const rows = await stub.listByKind("note", 5);
        return Response.json({ count: Array.isArray(rows) ? rows.length : -1 });
      } catch (e) {
        return Response.json(
          { gap: "workspace_call_failed", name: e instanceof Error ? e.name : "error" },
          { status: 500 },
        );
      }
    }
    return app.fetch(request, env, ctx);
  },
};
