// The organisation structure. buildOrg is pure and deterministic for a seed, so each isolate
// rebuilds it from the tenant's stored seed configuration (kept in TenantPolicy) and caches it.

import {
  buildOrg,
  type Ctx,
  type Org,
  PERSONAS,
  type Principal,
  ROLE_ORDER,
  type RoleId,
  TENANT_ID,
} from "@secondary/policy";
import type { SeedPrincipal, TenantConfig } from "./tenant-policy.ts";

const CACHE_LIMIT = 8;
const cache = new Map<string, Org>();

export function getOrg(config: TenantConfig): Org {
  const key = JSON.stringify([config.tenantId, config.seed, config.personalOwners]);
  let org = cache.get(key);
  if (!org) {
    const built = buildOrg({ seed: config.seed, personalOwners: config.personalOwners });
    // The builder always stamps the synthetic tenant. Re-stamp so a principal's tenant must match.
    org = built.tenantId === config.tenantId ? built : { ...built, tenantId: config.tenantId };
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, org);
  }
  return org;
}

export const isRoleId = (v: unknown): v is RoleId =>
  typeof v === "string" && (ROLE_ORDER as readonly string[]).includes(v);

/**
 * M2: a dev persona is bound to the signed-in email, so two testers who both pick "consultant" are
 * two principals with separate Personal Brains. The seeded persona addresses (`<role>@...`) keep the
 * canonical id `u_<role>`, because the synthetic items name those ids as their authors.
 */
export async function personaId(roleId: RoleId, email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  if (e.split("@")[0] === roleId) return PERSONAS[roleId].id;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e));
  const h = Array.from(new Uint8Array(d).slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${PERSONAS[roleId].id}_${h}`;
}

/** The synthetic persona for a role, as a principal of the tenant, signed in as `email`. */
export const personaPrincipal = (
  roleId: RoleId,
  tenantId: string,
  email: string,
  id: string = PERSONAS[roleId].id,
): Principal => ({
  ...PERSONAS[roleId],
  id,
  tenantId,
  email,
  memberships: PERSONAS[roleId].memberships.map((m) => ({ ...m })),
});

export const seedPrincipals = (emailDomain: string): SeedPrincipal[] =>
  ROLE_ORDER.map((r) => ({
    id: PERSONAS[r].id,
    email: `${r}@${emailDomain}`,
    roleIds: [r],
    memberships: PERSONAS[r].memberships.map((m) => ({ ...m })),
  }));

export const makeCtx = (now: number, ndaGrants: string[], elevatedUntil: number | null): Ctx => ({
  now,
  ...(ndaGrants.length ? { ndaGrants } : {}),
  ...(elevatedUntil !== null ? { elevatedUntil } : {}),
});

export { TENANT_ID };
