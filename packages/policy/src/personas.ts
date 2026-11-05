import { ROLE_ORDER, type RoleId } from "./roles.ts";
import type { Principal } from "./types.ts";

export const TENANT_ID = "tenant_mantu_synthetic";

const MEMBERSHIPS: Record<RoleId, Principal["memberships"]> = {
  ceo: [],
  head_bid: [{ scope_type: "circle", scope_id: "c_bid" }],
  acme_lead: [
    { scope_type: "circle", scope_id: "c_sales" },
    { scope_type: "account", scope_id: "a_acme" },
  ],
  consultant: [
    { scope_type: "circle", scope_id: "c_delivery" },
    { scope_type: "circle", scope_id: "c_eng" },
  ],
  reviewer: [],
  platform_admin: [],
  auditor: [],
};

/** Synthetic principal for a role. Ids are stable: item authors refer to them. */
export function persona(roleId: RoleId): Principal {
  return {
    id: `u_${roleId}`,
    email: `${roleId}@example.invalid`,
    tenantId: TENANT_ID,
    roleIds: [roleId],
    memberships: MEMBERSHIPS[roleId].map((m) => ({ ...m })),
  };
}

export const PERSONAS: Readonly<Record<RoleId, Principal>> = Object.fromEntries(
  ROLE_ORDER.map((r) => [r, persona(r)]),
) as Record<RoleId, Principal>;
