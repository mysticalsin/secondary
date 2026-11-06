// Who may be named: the people the directory knows who hold a right on a brain's node (review for
// the Review desk, contribute for gaps), minus the people in `except`. The policy decides, then the
// stored brain role narrows it (a stored role never widens). Same rule as the review notices.

import { type Action, canDo, type Principal, roleAllows } from "@secondary/policy";
import { govClient } from "../admin/client.ts";
import type { workspaceStub } from "../stubs.ts";
import { type C, sess } from "../ux/util.ts";

export interface Person {
  id: string;
  /** The part of the address before the @, used to mention a person. */
  handle: string;
  /** Display name from the address ("ada.lovelace" becomes "Ada Lovelace"). */
  name: string;
}

const nameOf = (handle: string): string =>
  handle
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || handle;

export async function eligiblePeople(
  c: C,
  node: { nodeId: string; stub: ReturnType<typeof workspaceStub> },
  need: { actions: readonly Action[]; role: "review" | "contribute" },
  except: readonly string[],
): Promise<Person[]> {
  const s = sess(c);
  const org = s.org;
  if (!org) return [];
  const roles = new Set(
    [...org.roles.values()]
      .filter((r) => r.grants.some((g) => need.actions.some((a) => g.actions.includes(a))))
      .map((r) => r.id),
  );
  const gov = govClient(c.env, s.tenantId);
  const [people, ndas] = await Promise.all([gov.principals(), gov.ndaGrants(s.ctx.now, null)]);
  const out: Person[] = [];
  for (const p of people) {
    if (except.includes(p.id) || !p.roleIds.some((r) => roles.has(r))) continue;
    const who: Principal = {
      id: p.id,
      email: p.email,
      tenantId: s.tenantId,
      roleIds: p.roleIds,
      memberships: [],
    };
    const ctx = {
      now: s.ctx.now,
      ndaGrants: ndas.filter((n) => n.principalId === p.id && n.active).map((n) => n.accountId),
    };
    if (!need.actions.some((a) => canDo(who, org, node.nodeId, a, ctx).allowed)) continue;
    // The stored brain role only narrows.
    if (!roleAllows(await node.stub.brainRoleOf([p.id]), need.role)) continue;
    const handle = (p.email.split("@")[0] ?? p.id).toLowerCase();
    out.push({ id: p.id, handle, name: nameOf(handle) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Deliver an in-app notice. Best effort: a failed notice never fails the action it reports. */
export async function notify(
  c: C,
  to: readonly string[],
  kind: string,
  title: string,
  ref: string,
): Promise<void> {
  const s = sess(c);
  const ids = [...new Set(to)].filter((id) => id !== s.principal.id);
  if (!ids.length) return;
  try {
    await govClient(c.env, s.tenantId).deliver(ids, kind, title, ref, s.ctx.now);
  } catch {
    // The audit receipt is the record.
  }
}
