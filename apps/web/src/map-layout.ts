import { hierarchy, pack } from "d3-hierarchy";
import { arc as d3arc } from "d3-shape";
import type { Hub, MapNode, MapView } from "./types";

export interface PNode {
  id: string;
  label: string;
  node: MapNode;
  hubId: string;
  /** 0 hub, 1 circle/country/theme item, 2 leaf */
  depth: 0 | 1 | 2;
  x: number;
  y: number;
  r: number;
  angle: number;
  isHub: boolean;
}

export interface Band {
  label: string;
  path: string;
  lx: number;
  ly: number;
}

export interface Layout {
  items: PNode[];
  bands: Band[];
  extent: number;
  byId: Map<string, PNode>;
  coreR: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GROUP_ORDER = ["Business line", "Corporate function"];

export function hubAsNode(h: Hub): MapNode {
  return {
    id: h.id,
    label: h.label,
    kind: h.kind,
    plane: "GLOBAL",
    access: h.access,
    counts: h.counts,
    freshnessDays: null,
    signals: {
      open: !!h.counts && h.counts.open > 0,
      star: !!h.counts && h.counts.stars > 0,
      gap: false,
    },
  };
}

export function sortedHubs(view: MapView): Hub[] {
  return [...view.hubs].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group ?? "");
    const gb = GROUP_ORDER.indexOf(b.group ?? "");
    return (ga < 0 ? 9 : ga) - (gb < 0 ? 9 : gb);
  });
}

function placeFlat(
  items: MapNode[],
  aCenter: number,
  aWidth: number,
  r0: number,
  dotR: number,
  hubId: string,
  depth: 1 | 2,
  out: PNode[],
): number {
  const step = dotR * 2 + 3;
  let idx = 0;
  let r = r0;
  while (idx < items.length) {
    const cap = Math.max(1, Math.floor((aWidth * r) / step));
    const take = Math.min(cap, items.length - idx);
    for (let j = 0; j < take; j++) {
      const node = items[idx + j] as MapNode;
      const a = aCenter - aWidth / 2 + ((j + 0.5) * aWidth) / take;
      out.push({
        id: node.id,
        label: node.label,
        node,
        hubId,
        depth,
        angle: a,
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        r: dotR,
        isHub: false,
      });
    }
    idx += take;
    r += step;
  }
  return r;
}

const dotRadius = (n: MapNode, lo: number, hi: number, k: number) =>
  n.access === "locked" || !n.counts ? lo : clamp(lo + Math.sqrt(n.counts.items) * k, lo, hi);

export function ringLayout(view: MapView): Layout {
  const hubs = sortedHubs(view);
  const n = Math.max(1, hubs.length);
  const R = n <= 4 ? 230 : 260;
  const items: PNode[] = [];
  const slot = (Math.PI * 2) / n;
  const sector = Math.min(slot * 0.86, 1.25);
  let extent = R + 80;

  hubs.forEach((h, i) => {
    const a = -Math.PI / 2 + (i + 0.5) * slot;
    const hn = hubAsNode(h);
    const rh =
      h.access === "locked" || !h.counts ? 24 : clamp(20 + Math.sqrt(h.counts.items) * 0.5, 22, 40);
    items.push({
      id: h.id,
      label: h.label,
      node: hn,
      hubId: h.id,
      depth: 0,
      angle: a,
      x: Math.cos(a) * R,
      y: Math.sin(a) * R,
      r: rh,
      isHub: true,
    });
    const r0 = R + rh + 24;
    const kids = h.children;
    if (kids.length === 0) return;
    const flat = kids.every((c) => !c.children || c.children.length === 0);
    let maxR = r0;
    if (flat) {
      const depth: 1 | 2 = kids.length > 12 ? 2 : 1;
      const dotR = depth === 2 ? 3.4 : 6;
      const tmp: PNode[] = [];
      maxR = placeFlat(kids, a, sector, r0, dotR, h.id, depth, tmp);
      for (const t of tmp) {
        t.r = depth === 2 ? dotRadius(t.node, 2.6, 5, 0.22) : dotRadius(t.node, 6, 11, 0.5);
        items.push(t);
      }
    } else {
      const weights = kids.map((c) => 1 + (c.children?.length ?? 0));
      const total = weights.reduce((s, w) => s + w, 0);
      let cursor = a - sector / 2;
      kids.forEach((c, ci) => {
        const w = ((weights[ci] as number) / total) * sector;
        const center = cursor + w / 2;
        cursor += w;
        const cr = dotRadius(c, 7, 12, 0.5);
        items.push({
          id: c.id,
          label: c.label,
          node: c,
          hubId: h.id,
          depth: 1,
          angle: center,
          x: Math.cos(center) * r0,
          y: Math.sin(center) * r0,
          r: cr,
          isHub: false,
        });
        if (c.children?.length) {
          const tmp: PNode[] = [];
          const end = placeFlat(c.children, center, w, r0 + 24, 3.2, h.id, 2, tmp);
          maxR = Math.max(maxR, end);
          for (const t of tmp) {
            t.r = dotRadius(t.node, 2.6, 4.6, 0.2);
            items.push(t);
          }
        }
      });
    }
    extent = Math.max(extent, maxR + 30);
  });

  // group bands, only when hubs carry a group
  const bands: Band[] = [];
  const bandIn = 150;
  const bandOut = 156;
  let i = 0;
  while (i < hubs.length) {
    const g = (hubs[i] as Hub).group;
    let j = i;
    while (j + 1 < hubs.length && (hubs[j + 1] as Hub).group === g) j++;
    if (g) {
      const a0 = -Math.PI / 2 + i * slot + 0.05;
      const a1 = -Math.PI / 2 + (j + 1) * slot - 0.05;
      const gen = d3arc();
      const path =
        gen({
          innerRadius: bandIn,
          outerRadius: bandOut,
          startAngle: a0 + Math.PI / 2,
          endAngle: a1 + Math.PI / 2,
        }) ?? "";
      const mid = (a0 + a1) / 2;
      bands.push({
        label: g,
        path,
        lx: Math.cos(mid) * (bandIn - 16),
        ly: Math.sin(mid) * (bandIn - 16),
      });
    }
    i = j + 1;
  }
  const byId = new Map(items.map((p) => [p.id, p]));
  return { items, bands, extent, byId, coreR: 52 };
}

interface Tree {
  id: string;
  label: string;
  node: MapNode;
  value?: number;
  children?: Tree[];
}

export function clusterLayout(view: MapView): Layout {
  const leafVal = (n: MapNode) =>
    n.access === "locked" || !n.counts ? 6 : Math.max(2, n.counts.items);
  const toTree = (n: MapNode): Tree =>
    n.children && n.children.length
      ? { id: n.id, label: n.label, node: n, children: n.children.map(toTree) }
      : { id: n.id, label: n.label, node: n, value: leafVal(n) };
  const hubs = sortedHubs(view);
  const tree: Tree = {
    id: "root",
    label: "root",
    node: hubAsNode({
      id: "root",
      label: "root",
      kind: "department",
      access: "full",
      counts: null,
      children: [],
    }),
    children: hubs.map((h) =>
      h.children.length
        ? { id: h.id, label: h.label, node: hubAsNode(h), children: h.children.map(toTree) }
        : { id: h.id, label: h.label, node: hubAsNode(h), value: 40 },
    ),
  };
  const root = hierarchy(tree)
    .sum((d) => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const size = 960;
  const packed = pack<Tree>()
    .size([size, size])
    .padding((d) => (d.depth === 0 ? 12 : d.depth === 1 ? 5 : 2))(root);
  const items: PNode[] = [];
  let hubId = "";
  for (const d of packed.descendants()) {
    if (d.depth === 0) continue;
    if (d.depth === 1) hubId = d.data.id;
    const hubKids = d.depth === 2 ? (d.parent?.children?.length ?? 0) : 0;
    const depth: 0 | 1 | 2 =
      d.depth === 1 ? 0 : d.children ? 1 : d.depth === 2 && hubKids <= 12 ? 1 : 2;
    items.push({
      id: d.data.id,
      label: d.data.label,
      node: d.data.node,
      hubId: d.depth === 1 ? d.data.id : hubId,
      depth,
      x: d.x - size / 2,
      y: d.y - size / 2,
      r: d.r,
      angle: 0,
      isHub: d.depth === 1,
    });
  }
  return {
    items,
    bands: [],
    extent: size / 2 + 20,
    byId: new Map(items.map((p) => [p.id, p])),
    coreR: 0,
  };
}

export function flatten(view: MapView): { node: MapNode; hub: Hub; depth: 1 | 2 }[] {
  const out: { node: MapNode; hub: Hub; depth: 1 | 2 }[] = [];
  for (const h of sortedHubs(view)) {
    for (const c of h.children) {
      out.push({ node: c, hub: h, depth: 1 });
      for (const t of c.children ?? []) out.push({ node: t, hub: h, depth: 2 });
    }
  }
  return out;
}
