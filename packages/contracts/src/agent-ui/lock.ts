// Re-resolving a plan for one viewer. A plan holds ids, never data, so a shared or saved plan is safe
// to hand to anyone; what each viewer sees is decided when it is opened. This function is the server's
// half: every card that touches a brain the viewer may not read becomes a `Locked` placeholder with no
// title, no brain id and no text from the plan, so a lower-privilege viewer gets less, never more.

import type { AgentNode } from "./view.ts";

/** The brain ids a node names: its own `brain`, `a` and `b` props, and those of its buttons' values. */
export function brainRefs(n: AgentNode): string[] {
  const out: string[] = [];
  const grab = (o: Record<string, unknown> | undefined) => {
    for (const k of ["brain", "a", "b"]) {
      const v = o?.[k];
      if (typeof v === "string") out.push(v);
    }
  };
  grab(n.props);
  grab(n.props.values as Record<string, unknown> | undefined);
  for (const c of n.children) out.push(...brainRefs(c));
  return out;
}

export interface LockResult {
  tree: AgentNode | null;
  /** How many cards were replaced. */
  locked: number;
}

const locked = (id: string): AgentNode => ({
  id,
  type: "Locked",
  props: { reason: "no_access" },
  children: [],
});

/**
 * `canRead` says whether the viewer may open a brain at read level. Unreadable references are
 * removed from buttons, and any card (or loose component) that holds one is replaced whole.
 */
export function lockTree(
  root: AgentNode | null,
  canRead: (brainId: string) => boolean,
): LockResult {
  let count = 0;
  const ok = (n: AgentNode) => brainRefs(n).every(canRead);
  const walk = (n: AgentNode): AgentNode | null => {
    if (n.type === "Stack" || n.type === "Grid")
      return { ...n, children: n.children.map(walk).filter((c): c is AgentNode => c !== null) };
    if (n.type === "Buttons") {
      const items = n.children.filter(ok);
      return items.length ? { ...n, children: items } : null;
    }
    if (!ok(n)) {
      count++;
      return locked(n.id);
    }
    return n;
  };
  return { tree: root ? walk(root) : null, locked: count };
}
