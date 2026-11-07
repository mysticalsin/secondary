// Personal Brain: one per user, visible to its owner only.
// No role, grant, elevation or NDA grant ever admits it. The engine never calls the grant
// matcher for these nodes (see engine.ts), and scope_type 'personal' never matches.

import { type Hasher, pick, synthLeaf } from "./seed.ts";
import type { Action, Decision, NodeKind, OrgNode, Principal, ScopeRef } from "./types.ts";

const KINDS = new Set<NodeKind>(["personal", "personalitem"]);

export const isPersonalKind = (kind: NodeKind): boolean => KINDS.has(kind);

/** What an owner may do in their own Personal Brain. Contribute creates a candidate copy elsewhere. */
export const OWNER_ACTIONS: readonly Action[] = [
  "view_structure",
  "view_content",
  "comment",
  "edit",
  "contribute",
];

const ITEM_TYPES = ["Note", "Private brief", "Saved view", "Draft"];
const ITEM_TOPICS = [
  "Account prep",
  "Open questions",
  "Reading list",
  "Meeting follow-ups",
  "Ideas",
];

export const personalRootId = (ownerId: string): string => `pb:${ownerId}`;

export function buildPersonalBrain(h: Hasher, ownerId: string): OrgNode[] {
  const rootId = personalRootId(ownerId);
  const base: ScopeRef = { ownerId };
  const items: OrgNode[] = [0, 1, 2].map((i) => {
    const id = `${rootId}:${i + 1}`;
    const label = `${pick(ITEM_TYPES, h(id))}: ${pick(ITEM_TOPICS, h(`${id}t`) >>> 3)}`;
    return {
      ...base,
      id,
      label,
      kind: "personalitem",
      plane: "PERSONAL_HOSTED",
      parentId: rootId,
      childIds: [],
      facts: { Owner: "You", Visibility: "Only you" },
      leaf: synthLeaf(h, id, label, {
        plane: "PERSONAL_HOSTED",
        group: "My Secondary",
        type: pick(ITEM_TYPES, h(id)),
        status: "draft",
        fresh: true,
        star: false,
        open: false,
        authorId: ownerId,
      }),
    };
  });
  const root: OrgNode = {
    ...base,
    id: rootId,
    label: "My Secondary",
    kind: "personal",
    plane: "PERSONAL_HOSTED",
    parentId: null,
    childIds: items.map((n) => n.id),
    facts: { Owner: "You", Visibility: "Only you" },
    leaf: null,
  };
  return [root, ...items];
}

export function decidePersonal(
  principal: Principal,
  node: { ownerId?: string },
  action: Action,
): Decision {
  if (node.ownerId === undefined || node.ownerId !== principal.id) {
    return { allowed: false, reason: "Not in your view" };
  }
  if (OWNER_ACTIONS.includes(action)) {
    return { allowed: true, reason: "Your Personal Brain" };
  }
  return { allowed: false, reason: "Not available in your Personal Brain" };
}
