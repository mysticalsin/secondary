// Maps policy nodes to Workspace Durable Objects. One Workspace per scope:
// personal:<ownerId>, global, and one per department, circle, account or region id.

import type { NodeKind, ScopeRef } from "@secondary/policy";

const GLOBAL_KINDS = new Set<NodeKind>([
  "core",
  "coretopic",
  "theme",
  "themedept",
  "themeitem",
  "governance",
  "cluster",
  "usecase",
]);
const PERSONAL_KINDS = new Set<NodeKind>(["personal", "personalitem"]);

export const personalScope = (ownerId: string): string => `personal:${ownerId}`;

/** The workspace scope id that stores a node. Fail closed: an unplaceable node has no scope. */
export function scopeOfNode(n: ScopeRef & { kind: NodeKind }): string | null {
  if (PERSONAL_KINDS.has(n.kind)) return n.ownerId ? personalScope(n.ownerId) : null;
  if (GLOBAL_KINDS.has(n.kind)) return "global";
  if (n.account) return n.account;
  if (n.kind === "circle" || n.kind === "topic") return n.circle ?? null;
  if (n.kind === "department") return n.dept ?? null;
  if (n.kind === "region" || n.kind === "country") return n.region ?? null;
  return null;
}

/** Candidate ids carry their target node: cand:<targetNodeId>:<8 hex>. */
export const candidateId = (targetNodeId: string, rand: string): string =>
  `cand:${targetNodeId}:${rand}`;
export function parseCandidateId(id: string): { targetNodeId: string } | null {
  const m = /^cand:([a-z0-9][a-z0-9_.:-]*):([0-9a-f]{8})$/.exec(id);
  return m ? { targetNodeId: m[1] as string } : null;
}
