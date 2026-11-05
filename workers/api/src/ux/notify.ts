// In-app notifications for the review flow. They go through the governance inbox (`deliver`), so
// the bell and the Inbox already show them. Delivery is best effort: a failed notice never fails
// the contribution or the decision it reports. Titles name the scope, never the content.

import { canDo, type Principal } from "@secondary/policy";
import { govClient } from "../admin/client.ts";
import { type C, sess } from "./util.ts";

export type ReviewEvent =
  | "review_requested"
  | "review_second_approval"
  | "review_changes_requested"
  | "review_approved"
  | "review_released";

async function deliver(
  c: C,
  to: readonly string[],
  kind: ReviewEvent,
  title: string,
  ref: string,
): Promise<void> {
  const s = sess(c);
  const ids = [...new Set(to)].filter((id) => id !== s.principal.id);
  if (ids.length === 0) return;
  try {
    await govClient(c.env, s.tenantId).deliver(ids, kind, title, ref, s.ctx.now);
  } catch {
    // Best effort: the inbox is a convenience, the audit receipt is the record.
  }
}

/** Everyone who may review or approve a release on the target node, except the people in `except`. */
async function reviewersOf(
  c: C,
  targetNodeId: string,
  except: readonly string[],
): Promise<string[]> {
  const s = sess(c);
  const org = s.org;
  if (!org) return [];
  const reviewRoles = new Set(
    [...org.roles.values()]
      .filter((r) =>
        r.grants.some((g) => g.actions.includes("review") || g.actions.includes("approve_release")),
      )
      .map((r) => r.id),
  );
  const gov = govClient(c.env, s.tenantId);
  const [people, ndas] = await Promise.all([gov.principals(), gov.ndaGrants(s.ctx.now, null)]);
  const out: string[] = [];
  for (const p of people) {
    if (except.includes(p.id) || !p.roleIds.some((r) => reviewRoles.has(r))) continue;
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
    if (
      canDo(who, org, targetNodeId, "review", ctx).allowed ||
      canDo(who, org, targetNodeId, "approve_release", ctx).allowed
    )
      out.push(p.id);
  }
  return out;
}

const label = (c: C, nodeId: string): string => {
  const n = sess(c).org?.nodes.get(nodeId);
  return n?.label ?? "a shared space";
};

/** A new contribution is waiting: tell the people who can review it. */
export async function notifyContributed(
  c: C,
  targetNodeId: string,
  candidateId: string,
  contributorId: string,
): Promise<void> {
  try {
    const to = await reviewersOf(c, targetNodeId, [contributorId]);
    await deliver(
      c,
      to,
      "review_requested",
      `A contribution to ${label(c, targetNodeId)} is waiting for review`,
      candidateId,
    );
  } catch {
    // Best effort, see above.
  }
}

/** A reviewer asked for changes: tell the contributor. */
export async function notifyChangesRequested(
  c: C,
  targetNodeId: string,
  candidateId: string,
  authorId: string | null,
): Promise<void> {
  if (!authorId) return;
  await deliver(
    c,
    [authorId],
    "review_changes_requested",
    `Changes were requested on your contribution to ${label(c, targetNodeId)}`,
    candidateId,
  );
}

/**
 * A reviewer approved. Released: tell the contributor it is live. Otherwise tell the contributor
 * it is approved and ask the other reviewers for the second approval.
 */
export async function notifyApproved(
  c: C,
  targetNodeId: string,
  candidateId: string,
  authorId: string | null,
  released: boolean,
): Promise<void> {
  const where = label(c, targetNodeId);
  const me = sess(c).principal.id;
  if (authorId)
    await deliver(
      c,
      [authorId],
      released ? "review_released" : "review_approved",
      released
        ? `Your contribution to ${where} was approved and released`
        : `Your contribution to ${where} has its first approval`,
      candidateId,
    );
  if (!released) {
    try {
      const to = await reviewersOf(c, targetNodeId, [me, ...(authorId ? [authorId] : [])]);
      await deliver(
        c,
        to,
        "review_second_approval",
        `A second approval is needed for a contribution to ${where}`,
        candidateId,
      );
    } catch {
      // Best effort, see above.
    }
  }
}
