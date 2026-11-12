/**
 * Stand-in for tenantStub and workspaceStub while a test calls the real erase route.
 * The test installs one TenantPolicy. Workspace calls are recorded and do not touch performers.
 */

type ErasureTenant = object;

type WorkspaceResult = { items: number; comments: number; approvals: number; edits: number };

type ErasureActor = { tenantId: string; principalId: string; scope: string; op: "wipe" | "pseudonymise" };

const slot = globalThis as {
  __erasureTenant?: ErasureTenant;
  __erasureCalls?: string[];
  __erasureActors?: ErasureActor[];
};

export function installErasureTenant(tenant: ErasureTenant): void {
  slot.__erasureTenant = tenant;
  slot.__erasureCalls = [];
  slot.__erasureActors = [];
}

export function erasureCalls(): readonly string[] {
  return slot.__erasureCalls ?? [];
}

export function erasureActors(): readonly ErasureActor[] {
  return slot.__erasureActors ?? [];
}

export function tenantStub(): ErasureTenant {
  const tenant = slot.__erasureTenant;
  if (!tenant) throw new Error("erasure tenant was not installed");
  return tenant;
}

export function workspaceStub(_env: unknown, tenantId: string, scope: string): {
  wipe: () => Promise<number>;
  pseudonymise: (principalId: string, pseudonym: string, aliases: string[]) => Promise<WorkspaceResult>;
} {
  const calls = slot.__erasureCalls ?? (slot.__erasureCalls = []);
  const actors = slot.__erasureActors ?? (slot.__erasureActors = []);
  return {
    async wipe() {
      calls.push(`wipe:${scope}`);
      actors.push({
        tenantId,
        principalId: scope.startsWith("personal:") ? scope.slice("personal:".length) : "",
        scope,
        op: "wipe",
      });
      return 0;
    },
    async pseudonymise(principalId: string) {
      calls.push(`pseudonymise:${scope}`);
      actors.push({ tenantId, principalId, scope, op: "pseudonymise" });
      return { items: 0, comments: 0, approvals: 0, edits: 0 };
    },
  };
}
