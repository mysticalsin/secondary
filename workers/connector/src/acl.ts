// Read-time permission check. The api asks "may this user still read this source item?" and the
// answer is fail closed: anything other than a fresh, positive confirmation hides the item.
//
// App-only Sites.Selected can list a drive item's permissions but cannot resolve group membership
// (that needs GroupMember.Read.All). So only these grants confirm access: a direct user grant, or an
// invitation to the user's email. Group grants, sharing links and inherited-only group access do NOT
// confirm. That is deliberately conservative; a delegated check replaces it once Entra delegated
// tokens exist (see docs/runbooks/GRAPH-SITES-SELECTED.md).

import { GraphGoneError, GraphHttpError, type GraphLike } from "./graph.ts";
import { userKey } from "./ids.ts";
import { type AclState, NOT_CONFIRMED, type Store } from "./types.ts";

export const DEFAULT_ACL_MAX_AGE_SECONDS = 900;

export interface AclDeps {
  store: Store;
  /** null when the Graph client is disabled. */
  graph: GraphLike | null;
  now: () => number;
  maxAgeSeconds: number;
  /** Kill switch (CONNECTOR_ENABLED). */
  enabled: boolean;
  /** Keys the per-user cache (CONNECTOR_HMAC_KEY). Without it nothing is confirmed. */
  userKeySecret: string | undefined;
  log?: (event: string, ids: Record<string, string | number>) => void;
}

export interface AclResult {
  allowed: boolean;
  reason?: typeof NOT_CONFIRMED;
}

export function parseMaxAge(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_ACL_MAX_AGE_SECONDS;
  return Math.min(n, 86_400);
}

interface Identity {
  user?: { email?: string; userPrincipalName?: string };
}
interface Permission {
  roles?: string[];
  grantedToV2?: Identity;
  grantedToIdentitiesV2?: Identity[];
  invitation?: { email?: string };
}
interface PermissionPage {
  value?: Permission[];
  "@odata.nextLink"?: string;
}

/** True when a permission entry names this user directly and carries at least one role. */
export function grantsUser(p: Permission, email: string): boolean {
  if (!p.roles?.length) return false;
  const want = email.trim().toLowerCase();
  const names = (i?: Identity) =>
    [i?.user?.email, i?.user?.userPrincipalName].filter((x): x is string => typeof x === "string");
  const all = [...names(p.grantedToV2), ...(p.grantedToIdentitiesV2 ?? []).flatMap(names)];
  if (p.invitation?.email) all.push(p.invitation.email);
  return all.some((n) => n.trim().toLowerCase() === want);
}

async function fetchPermissions(graph: GraphLike, drive: string, item: string) {
  let url: string | undefined =
    `/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}/permissions`;
  const out: Permission[] = [];
  for (let i = 0; url && i < 5; i++) {
    const page: PermissionPage = await graph.getJson<PermissionPage>(url);
    out.push(...(page.value ?? []));
    url = page["@odata.nextLink"];
  }
  return out;
}

export async function checkAccess(
  deps: AclDeps,
  user: { email: string },
  itemIds: string[],
): Promise<Record<string, AclResult>> {
  const out: Record<string, AclResult> = {};
  const deny: AclResult = { allowed: false, reason: NOT_CONFIRMED };
  const key = deps.userKeySecret ? await userKey(deps.userKeySecret, user.email) : null;
  for (const itemId of itemIds.slice(0, 50)) {
    out[itemId] = deny;
    if (!deps.enabled || key === null) continue;
    const rec = await deps.store.getRecord(itemId);
    if (rec?.kind !== "file") continue;
    const src = await deps.store.getSource(rec.sourceId);
    if (!src?.enabled) continue;

    const now = deps.now();
    // The source's own setting (Settings, Sources) wins over the worker default.
    const maxAgeMs = (src.settings?.aclMaxAgeSeconds ?? deps.maxAgeSeconds) * 1000;
    const cached = await deps.store.getAcl(itemId, key);
    if (cached && now - cached.checkedAt <= maxAgeMs && cached.checkedAt <= now) {
      out[itemId] = cached.allowed ? { allowed: true } : deny;
      continue;
    }
    // Missing or stale: ask Graph. No Graph, or any failure, means not confirmed.
    if (!deps.graph) {
      await markState(deps, itemId, rec.aclState === "current" ? "stale" : "unknown");
      continue;
    }
    try {
      const perms = await fetchPermissions(deps.graph, src.driveId, rec.driveItemId);
      const allowed = perms.some((p) => grantsUser(p, user.email));
      await deps.store.putAcl(itemId, key, { allowed, checkedAt: now });
      await markState(deps, itemId, "current", now);
      out[itemId] = allowed ? { allowed: true } : deny;
    } catch (e) {
      if (e instanceof GraphHttpError && (e.status === 404 || e.status === 403)) {
        // The item or our access to it is gone.
        await deps.store.putAcl(itemId, key, { allowed: false, checkedAt: now });
        await markState(deps, itemId, "revoked", now);
      } else {
        // Throttled, 5xx, network, auth, gone: not confirmed. Never cache a failure as an answer.
        await markState(deps, itemId, rec.aclState === "current" ? "stale" : "unknown");
        if (!(e instanceof GraphGoneError)) deps.log?.("acl.error", { itemId });
      }
    }
  }
  return out;
}

async function markState(deps: AclDeps, itemId: string, state: AclState, at?: number) {
  const rec = await deps.store.getRecord(itemId);
  if (!rec) return;
  await deps.store.putRecord({
    ...rec,
    aclState: state,
    aclCheckedAt: at ?? rec.aclCheckedAt,
  });
}
