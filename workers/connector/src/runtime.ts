// Builds the dependencies of sync and ACL checks from the worker env.

import { type AclDeps, parseMaxAge } from "./acl.ts";
import { apiSink } from "./api-client.ts";
import { type GraphLike, graphFromEnv } from "./graph.ts";
import { TENANT_ID } from "./ids.ts";
import { stateStub } from "./state.ts";
import { type SyncDeps, syncSource } from "./sync.ts";

export const isEnabled = (env: Env): boolean => env.CONNECTOR_ENABLED === "true";

export const log = (event: string, ids: Record<string, string | number>): void => {
  // IDs and counters only. Never content, names, emails or URLs.
  console.log(JSON.stringify({ event, ...ids }));
};

export function tenantsOf(env: Env): string[] {
  let list: unknown = [env.DEFAULT_TENANT_ID];
  if (env.CONNECTOR_TENANTS?.trim()) {
    try {
      list = JSON.parse(env.CONNECTOR_TENANTS);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list)
    ? list.filter((t): t is string => typeof t === "string" && TENANT_ID.test(t))
    : [];
}

export function syncDeps(env: Env, tenantId: string, graph: GraphLike): SyncDeps {
  return { store: stateStub(env, tenantId), graph, api: apiSink(env), now: Date.now, log };
}

export function aclDeps(env: Env, tenantId: string): AclDeps {
  return {
    store: stateStub(env, tenantId),
    graph: isEnabled(env) ? graphFromEnv(env) : null,
    now: Date.now,
    maxAgeSeconds: parseMaxAge(env.ACL_MAX_AGE_SECONDS),
    enabled: isEnabled(env),
    userKeySecret: env.CONNECTOR_HMAC_KEY,
    log,
  };
}

/** One sync run for a source, used by the Workflow and by the manual trigger. */
export async function runSync(env: Env, tenantId: string, sourceId: string, maxPages?: number) {
  if (!isEnabled(env)) return { status: "skipped", reason: "disabled" } as const;
  const graph = graphFromEnv(env);
  if (!graph) return { status: "skipped", reason: "disabled" } as const;
  return syncSource({ ...syncDeps(env, tenantId, graph), maxPages }, tenantId, sourceId);
}
