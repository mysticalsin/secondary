// Synthetic-org seeding. The dev seed endpoint forces a reseed; the dev auto-seed (ENVIRONMENT=dev only,
// see auth.ts) loads the org once, guarded by the `seeded_at` row inside the TenantPolicy Durable Object.

import { DEFAULT_SEED } from "@secondary/policy";
import { getOrg, seedPrincipals } from "./org.ts";
import { scopeOfNode } from "./scope.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";
import type { SeedRow } from "./workspace.ts";

export type SeedOptions = { tenantId: string; seed?: number; emailDomain?: string; now: number };
export type SeedSummary = {
  tenantId: string;
  seed: number;
  nodes: number;
  workspaces: number;
  principals: number;
};

/**
 * Seed a tenant's directory and workspaces. `force` replaces whatever exists (the admin endpoint).
 * Without `force` the TenantPolicy object decides atomically: only the first caller seeds and later
 * callers get null. A caller that loses a race may briefly see workspaces still filling.
 */
export async function seedTenant(
  env: Env,
  o: SeedOptions,
  force: boolean,
): Promise<SeedSummary | null> {
  const seed = o.seed ?? DEFAULT_SEED;
  const principals = seedPrincipals(o.emailDomain ?? "example.invalid");
  const config = { tenantId: o.tenantId, seed, personalOwners: principals.map((p) => p.id) };
  const org = getOrg(config);
  const byScope = new Map<string, SeedRow[]>();
  for (const n of org.nodes.values()) {
    const scope = scopeOfNode(n);
    if (!scope) continue;
    const row: SeedRow = {
      id: n.id,
      label: n.label,
      kind: n.kind,
      plane: n.plane,
      status: n.leaf?.status ?? "",
      revision: n.leaf?.revision ?? 0,
      authorId: n.leaf?.authorId ?? null,
      tags: n.leaf?.tags ?? [],
      reviewedBy2: n.leaf?.reviewedBy2 ?? false,
    };
    byScope.set(scope, [...(byScope.get(scope) ?? []), row]);
  }
  const tenant = tenantStub(env, o.tenantId);
  if (force) await tenant.seed(config, principals, o.now);
  else if ((await tenant.seedOnce(config, principals, o.now)) === null) return null;
  await Promise.all(
    [...byScope].map(async ([scope, rows]) => {
      const ws = workspaceStub(env, o.tenantId, scope);
      for (let i = 0; i < rows.length; i += 250)
        await ws.seed(rows.slice(i, i + 250), i === 0, o.now);
    }),
  );
  return {
    tenantId: o.tenantId,
    seed,
    nodes: org.nodes.size,
    workspaces: byScope.size,
    principals: principals.length,
  };
}
