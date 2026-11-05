// Durable Object access. Every object is created in the EU jurisdiction and is named per tenant,
// so two tenants never share an object even when their scope ids are equal.
//
// workerd (wrangler dev and the test runner) does not implement jurisdictions, so local runs set
// DO_JURISDICTION=off in .dev.vars. Anything other than "off" means EU, and "off" is honoured only
// when ENVIRONMENT is "dev" (the binding inventory test pins the committed value to "eu").

import type { TenantPolicy } from "./tenant-policy.ts";
import type { Workspace } from "./workspace.ts";

type JurisdictionEnv = { ENVIRONMENT: string; DO_JURISDICTION?: string };

export function inJurisdiction<T extends Rpc.DurableObjectBranded | undefined>(
  env: JurisdictionEnv,
  ns: DurableObjectNamespace<T>,
): DurableObjectNamespace<T> {
  const off = env.DO_JURISDICTION === "off" && env.ENVIRONMENT === "dev";
  return off ? ns : ns.jurisdiction("eu");
}

export const tenantStub = (env: Env, tenantId: string): DurableObjectStub<TenantPolicy> => {
  const ns = inJurisdiction(env, env.TENANT_POLICY);
  return ns.get(ns.idFromName(tenantId));
};

export const workspaceStub = (
  env: Env,
  tenantId: string,
  scopeId: string,
): DurableObjectStub<Workspace> => {
  const ns = inJurisdiction(env, env.WORKSPACE);
  return ns.get(ns.idFromName(`${tenantId}:${scopeId}`));
};
