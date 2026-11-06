// Radial layout of the local graph. Pure: the centre in the middle, the first ring evenly spaced,
// each second-ring node near the first-ring node it hangs from. No randomness, so a page draws the
// same way every time.
import type { GraphNode } from "./types";

export const W = 340;
export const H = 288;
const CX = W / 2;
const CY = H / 2;
const RX1 = 80;
const RY1 = 76;
const RX2 = 130;
const RY2 = 112;

export interface Placed extends GraphNode {
  x: number;
  y: number;
  /** Angle in radians, from the centre. */
  a: number;
}

export function layoutGraph(
  nodes: GraphNode[],
  edges: { from: string; to: string }[],
): { placed: Placed[]; lines: { x1: number; y1: number; x2: number; y2: number; k: string }[] } {
  const centre = nodes.find((n) => n.hop === 0);
  if (!centre) return { placed: [], lines: [] };
  const ring1 = nodes.filter((n) => n.hop === 1);
  const ring2 = nodes.filter((n) => n.hop === 2);
  const placed = new Map<string, Placed>();
  placed.set(centre.key, { ...centre, x: CX, y: CY, a: 0 });
  // Start at the top and go clockwise; an ellipse keeps labels clear of the card edges.
  ring1.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, ring1.length)) * Math.PI * 2;
    placed.set(n.key, { ...n, x: CX + Math.cos(a) * RX1, y: CY + Math.sin(a) * RY1, a });
  });
  const parentOf = (key: string): Placed | undefined => {
    for (const e of edges) {
      const other = e.from === key ? e.to : e.to === key ? e.from : null;
      const p = other ? placed.get(other) : undefined;
      if (p && p.hop === 1) return p;
    }
    return undefined;
  };
  const taken = new Map<string, number>();
  ring2.forEach((n, i) => {
    const p = parentOf(n.key);
    const base = p ? p.a : -Math.PI / 2 + (i / Math.max(1, ring2.length)) * Math.PI * 2;
    const k = p ? p.key : "free";
    const slot = taken.get(k) ?? 0;
    taken.set(k, slot + 1);
    // Fan out around the parent's direction: 0, +, -, ++, --
    const off = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 0.22;
    const a = base + off;
    placed.set(n.key, {
      ...n,
      x: CX + Math.cos(a) * RX2,
      y: CY + Math.sin(a) * RY2,
      a,
    });
  });
  const lines = edges.flatMap((e) => {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    return a && b ? [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, k: `${e.from}>${e.to}` }] : [];
  });
  return { placed: [...placed.values()], lines };
}

/** A title cut to fit a label, on a word edge when it can. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
