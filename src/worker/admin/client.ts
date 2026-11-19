// Typed access to the governance store inside TenantPolicy, and the tenant role overlay that makes
// roles data: the policy engine reads `org.roles`, so the API swaps in the tenant's role table.

import type { Org, Role } from "@secondary/policy";
import { tenantStub } from "../stubs.ts";
import type { GovMethod, GovStore } from "./store.ts";

export type GovClient = {
  [K in GovMethod]: (...a: Parameters<GovStore[K]>) => Promise<Awaited<ReturnType<GovStore[K]>>>;
};

/** `gov.propose(...)` becomes one RPC to the tenant's Durable Object. */
export function govClient(env: Env, tenantId: string): GovClient {
  const stub = tenantStub(env, tenantId);
  return new Proxy({} as GovClient, {
    get:
      (_t, method: string) =>
      async (...args: unknown[]) =>
        stub.gov(method, args),
  });
}

interface Cached {
  version: number;
  roles: Map<string, Role>;
  byOrg: WeakMap<Org, Org>;
}
const cache = new Map<string, Cached>();
const CACHE_LIMIT = 32;

/**
 * The organisation with this tenant's roles. The role table is refetched only when its version
 * moves, and the resulting Org object is stable per version so the engine's view cache keeps working.
 */
export async function tenantOrg(
  env: Env,
  tenantId: string,
  org: Org,
  rolesVersion: number,
): Promise<Org> {
  let c = cache.get(tenantId);
  if (!c || c.version !== rolesVersion) {
    const { roles, version } = await govClient(env, tenantId).listRoles();
    if (cache.size >= CACHE_LIMIT) cache.clear();
    c = { version, roles: new Map(roles.map((r) => [r.id, r])), byOrg: new WeakMap() };
    cache.set(tenantId, c);
  }
  let out = c.byOrg.get(org);
  if (!out) {
    out = { ...org, roles: c.roles };
    c.byOrg.set(org, out);
  }
  return out;
}
