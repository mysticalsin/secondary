// Typed access to the brain rules store inside TenantPolicy: `rules.list()` is one RPC to the tenant's object.

import { tenantStub } from "../stubs.ts";
import type { RulesMethod, RulesStore } from "./store.ts";

export type RulesClient = {
  [K in RulesMethod]: (
    ...a: Parameters<RulesStore[K]>
  ) => Promise<Awaited<ReturnType<RulesStore[K]>>>;
};

export function rulesClient(env: Env, tenantId: string): RulesClient {
  const stub = tenantStub(env, tenantId);
  return new Proxy({} as RulesClient, {
    get:
      (_t, method: string) =>
      async (...args: unknown[]) =>
        stub.rules(method, args),
  });
}
