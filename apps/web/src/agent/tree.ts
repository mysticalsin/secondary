// The second check on the client. The server and the contract parser already drop what is not in
// the library; this pass re-checks any tree that arrives as JSON (saved and shared views) before it
// reaches the renderer: registered types only, props through their Zod schema, parents that may hold
// the child, bounded depth and size. `Locked` is the only type the server adds on its own.
import {
  type AgentNode,
  COMPONENTS,
  type ComponentName,
  LIMITS,
  LockedProps,
} from "@secondary/contracts/agent-ui";

interface Spec {
  props: { safeParse: (v: unknown) => { success: boolean } };
  holds?: readonly string[];
  slot?: "children" | "items";
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function sanitizeTree(raw: unknown): AgentNode | null {
  let nodes = 0;
  const walk = (v: unknown, parent: ComponentName | null, depth: number, path: string) => {
    if (!isObj(v) || typeof v.type !== "string") return null;
    if (depth > LIMITS.maxDepth || nodes >= LIMITS.maxNodes) return null;
    const id = typeof v.id === "string" && v.id.length <= 64 ? v.id : path;
    const props = isObj(v.props) ? v.props : {};
    const kids = Array.isArray(v.children) ? v.children : [];
    if (v.type === "Locked") {
      // A placeholder carries a reason and nothing else: no title, id or text can ride along.
      const r = LockedProps.safeParse({
        reason: props.reason === "removed" ? "removed" : "no_access",
      });
      if (!r.success) return null;
      nodes++;
      return { id, type: "Locked", props: r.data, children: [] } satisfies AgentNode;
    }
    if (!Object.hasOwn(COMPONENTS, v.type)) return null;
    const type = v.type as ComponentName;
    const spec = COMPONENTS[type] as Spec;
    if (parent && !(COMPONENTS[parent] as Spec).holds?.includes(type)) return null;
    nodes++;
    const slot = spec.slot;
    const ok = spec.props.safeParse(slot ? { ...props, [slot]: kids.map(() => 0) } : props);
    if (!ok.success) return null;
    const children: AgentNode[] = [];
    if (slot) {
      for (const [n, k] of kids.entries()) {
        const c = walk(k, type, depth + 1, `${id}.${n}`);
        if (c) children.push(c);
      }
      if (!children.length && type !== "Stack" && type !== "Grid") return null;
    } else if (kids.length) return null;
    // Locked is allowed anywhere a card is (the server put it there), so check parents for it too.
    const clean: Record<string, unknown> = { ...props };
    if (slot) delete clean[slot];
    return { id, type, props: clean, children } satisfies AgentNode;
  };
  return walk(raw, null, 0, "root");
}
