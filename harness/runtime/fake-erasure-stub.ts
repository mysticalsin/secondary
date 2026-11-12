/**
 * Stand-in for tenantStub and workspaceStub while a test calls the real erase route.
 * The test installs one TenantPolicy. Workspace calls are recorded and do not touch performers.
 */

type ErasureTenant = object;

type WorkspaceResult = { items: number; comments: number; approvals: number; edits: number };

const slot = globalThis as {
  __erasureTenant?: ErasureTenant;
  __erasureCalls?: string[];
};

export function installErasureTenant(tenant: ErasureTenant): void {
  slot.__erasureTenant = tenant;
  slot.__erasureCalls = [];
}

export function erasureCalls(): readonly string[] {
  return slot.__erasureCalls ?? [];
}

export function tenantStub(): ErasureTenant {
  const tenant = slot.__erasureTenant;
  if (!tenant) throw new Error("erasure tenant was not installed");
  return tenant;
}

export function workspaceStub(_env: unknown, _tenantId: string, scope: string): {
  wipe: () => Promise<number>;
  pseudonymise: (principalId: string, pseudonym: string, aliases: string[]) => Promise<WorkspaceResult>;
} {
  const calls = slot.__erasureCalls ?? (slot.__erasureCalls = []);
  return {
    async wipe() {
      calls.push(`wipe:${scope}`);
      return 0;
    },
    async pseudonymise() {
      calls.push(`pseudonymise:${scope}`);
      return { items: 0, comments: 0, approvals: 0, edits: 0 };
    },
  };
}
