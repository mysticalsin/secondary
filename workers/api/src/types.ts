import type { Ctx, Org, Principal, RoleId } from "@secondary/policy";
import type { JWTVerifyGetKey } from "jose";
import type { TenantConfig } from "./tenant-policy.ts";

export interface Session {
  principal: Principal;
  ctx: Ctx;
  /** The demo persona in effect (dev only), else null. */
  persona: RoleId | null;
  tenantId: string;
  config: TenantConfig | null;
  epoch: number;
  /** Set when the request came from workers/mcp over the service binding. */
  internal: { clientId: string; tool: string; scope: string[] } | null;
  /** null until the tenant is seeded. */
  org: Org | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { session: Session; requestId: string };
};

/** Test seams. Production uses the defaults. */
export interface AppDeps {
  /** Key resolver for the Access JWT. Default: remote JWKS from the team domain's certs URL. */
  jwks?: (teamDomain: string) => JWTVerifyGetKey;
  now?: () => number;
}
