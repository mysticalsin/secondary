/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * The API Worker imports `./types.ts` and that file was not in either source-map
 * intake. Connector `worker/src/types.ts` is a different module (source registry
 * records) and is not this file. Shapes below are the fields recovered call sites
 * read and write. Replace this file if a later intake contains the original.
 */
import type { Ctx, Org, Principal, RoleId } from "@secondary/policy";
import type { JWTVerifyGetKey } from "jose";
import type { EntraDeps } from "./auth/oidc.ts";
import type { SwitchState } from "./switches.ts";
import type { TenantConfig } from "./tenant-policy.ts";

export interface SessionInternal {
  clientId: string;
  tool: string;
  scope: string[];
  grantId?: string;
  host?: string;
}

export interface Session {
  principal: Principal;
  ctx: Ctx;
  persona: RoleId | null;
  tenantId: string;
  config: TenantConfig | null;
  epoch: number;
  internal: SessionInternal | null;
  switches: SwitchState;
  org: Org | null;
}

/** Test seams recovered routes already read. Absent members use the real runtime. */
export interface AppDeps {
  now?: () => number;
  jwks?: (team: string) => JWTVerifyGetKey;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  entra?: EntraDeps;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    requestId: string;
    session: Session;
  };
}
