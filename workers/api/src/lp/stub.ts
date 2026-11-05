import { inJurisdiction } from "../stubs.ts";
import type { LandingPages } from "./store.ts";

/** The tenant's page store, created in the EU like every other object. */
export const lpStub = (env: Env, tenantId: string): DurableObjectStub<LandingPages> => {
  const ns = inJurisdiction(env, env.LP);
  return ns.get(ns.idFromName(tenantId));
};
