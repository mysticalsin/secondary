/**
 * Stand-in for the tenant Durable Object while the real auth routes run.
 * The test installs the object. The route calls it the same way it calls tenantStub.
 */

export type LoginTenant = {
  loginStatePut(
    stateHash: string,
    nonce: string,
    verifier: string,
    returnTo: string | null,
    now: number,
    ipHash?: string,
  ): void;
  loginStateTake(
    stateHash: string,
    now: number,
  ): Promise<{ nonce: string; verifier: string; returnTo: string | null } | null> | {
    nonce: string;
    verifier: string;
    returnTo: string | null;
  } | null;
  sessionCreate(
    idHash: string,
    who: unknown,
    groups: string[],
    now: number,
    managed: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  sessionDelete(hash: string): Promise<void> | void;
};

let current: LoginTenant | undefined;

export function installLoginTenant(tenant: LoginTenant): void {
  current = tenant;
}

export const tenantStub = (): LoginTenant => {
  if (!current) throw new Error("login tenant is not installed");
  return current;
};
