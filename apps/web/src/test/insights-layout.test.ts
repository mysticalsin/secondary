import { describe, expect, it } from "vitest";
import {
  buildGrid,
  CANVAS,
  layoutActivity,
  layoutBeeswarm,
  layoutConstellation,
  layoutFunnel,
  nearest,
  PILL_H,
  type PillIn,
  placePills,
  radiusOfScore,
  rng,
} from "../insights/layout";
import type { Dot } from "../insights/types";

const dots = (n: number, sectors = ["a", "b", "c", "d"]): Dot[] => {
  const r = rng(7);
  return Array.from({ length: n }, (_, i) => {
    const score = Math.round(38 + 62 * r() ** 2.2);
    return {
      pageId: `p${i}`,
      sector: sectors[i % sectors.length] as string,
      r: radiusOfScore(score),
      score,
      k: 1,
      inZone: score >= 70,
    };
  });
};

describe("constellation layout", () => {
  it("is deterministic: same dots and seed, same pixels; another seed moves them", () => {
    const d = dots(600);
    const a = layoutConstellation(d, ["a", "b", "c", "d"], [50, 70, 85], 42);
    const b = layoutConstellation(d, ["a", "b", "c", "d"], [50, 70, 85], 42);
    const c = layoutConstellation(d, ["a", "b", "c", "d"], [50, 70, 85], 43);
    expect(b).toEqual(a);
    expect(c.placed).not.toEqual(a.placed);
  });

  it("keeps every dot inside the outer ring, outside the centre badge, and in its sector", () => {
    const d = dots(900);
    const g = layoutConstellation(d, ["a", "b", "c", "d"], [50, 70, 85], 1);
    expect(g.placed).toHaveLength(900);
    for (const p of g.placed) {
      const dist = Math.hypot(p.x - CANVAS.cx, p.y - CANVAS.cy);
      expect(dist).toBeGreaterThanOrEqual(CANVAS.inner - 1);
      expect(dist).toBeLessThanOrEqual(CANVAS.R + 1);
      const ang = Math.atan2(p.y - CANVAS.cy, p.x - CANVAS.cx);
      const span = (Math.PI * 2) / 4;
      const start = -Math.PI / 2 - span / 2 + p.sector * span;
      const rel = (((ang - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      expect(rel).toBeLessThanOrEqual(span + 0.01);
    }
  });

  it("dots with a better score sit nearer the centre on average", () => {
    const d = dots(700);
    const g = layoutConstellation(d, ["a", "b", "c", "d"], [50, 70, 85], 5);
    const dist = (i: number) =>
      Math.hypot((g.placed[i]?.x ?? 0) - CANVAS.cx, (g.placed[i]?.y ?? 0) - CANVAS.cy);
    const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
    const zone = d.flatMap((x, i) => (x.inZone ? [dist(i)] : []));
    const rest = d.flatMap((x, i) => (x.inZone ? [] : [dist(i)]));
    expect(mean(zone)).toBeLessThan(mean(rest) - 40);
  });

  it("places no two dots on the same spot", () => {
    const g = layoutConstellation(dots(640), ["a", "b", "c", "d"], [50, 70, 85], 9);
    const seen = new Set(g.placed.map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(640);
  });

  it("handles one sector, no dots and a dense brain", () => {
    expect(layoutConstellation([], [], [50], 1).placed).toEqual([]);
    expect(layoutConstellation(dots(1500, ["a"]), ["a"], [50], 1).placed).toHaveLength(1500);
  });

  it("finds the dot under the pointer with a grid, not a scan", () => {
    const g = layoutConstellation(dots(1500), ["a", "b", "c", "d"], [50, 70, 85], 3);
    const grid = buildGrid(g.placed);
    const target = g.placed[777] as (typeof g.placed)[0];
    expect(nearest(grid, g.placed, target.x + 1, target.y - 1, 6)).toBe(777);
    expect(nearest(grid, g.placed, -50, -50, 6)).toBe(-1);
  });
});

describe("beeswarm layout", () => {
  it("stacks dots in columns, centred, inside the box, without overlap", () => {
    const r = rng(3);
    const scores = Array.from({ length: 800 }, () => Math.round(55 + r() * 40));
    const s = layoutBeeswarm(scores, { w: 560, h: 200 });
    expect(s.dots).toHaveLength(800);
    for (const d of s.dots) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(560);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(200);
    }
    expect(new Set(s.dots.map((d) => `${d.x},${d.y}`)).size).toBe(800);
    expect(layoutBeeswarm(scores, { w: 560, h: 200 }).dots).toEqual(s.dots);
    expect(s.lo).toBe(50);
    expect(s.x(100)).toBeGreaterThan(s.x(60));
  });
});

describe("activity and funnel layout", () => {
  it("lays days out in weeks, Monday first, with month starts", () => {
    const a = layoutActivity([{ date: "2026-11-03", count: 4 }], "2026-05-06", "2026-11-05");
    expect(a.cells[0]?.row).toBe(2); // 2026-05-06 is a Wednesday
    expect(a.cells.find((c) => c.date === "2026-11-03")?.count).toBe(4);
    expect(a.max).toBe(4);
    expect(a.months.length).toBeGreaterThanOrEqual(6);
    expect(a.cols).toBeGreaterThanOrEqual(26);
  });

  it("scales the funnel by count with a minimum width", () => {
    const bars = layoutFunnel(
      [
        { key: "a", count: 120 },
        { key: "b", count: 37 },
        { key: "c", count: 0 },
      ],
      { w: 500, bar: 40, gap: 20 },
    );
    expect(bars[0]?.w).toBe(500);
    expect(bars[1]?.w).toBeLessThan(500);
    expect(bars[2]?.w).toBeCloseTo(100);
    expect(bars[1]?.y).toBe(60);
  });
});

describe("name pills", () => {
  const opts = { w: CANVAS.w, h: CANVAS.h, cx: CANVAS.cx, cy: CANVAS.cy, centreR: 34 };
  const box = (p: { l: number; y: number; w: number }) => ({
    l: p.l,
    r: p.l + p.w,
    t: p.y - PILL_H / 2,
    b: p.y + PILL_H / 2,
  });
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const near = (b: ReturnType<typeof box>, x: number, y: number, r: number) => {
    const cx = Math.max(b.l, Math.min(x, b.r));
    const cy = Math.max(b.t, Math.min(y, b.b));
    return (cx - x) ** 2 + (cy - y) ** 2 < r * r;
  };

  const scenes: PillIn[][] = [
    // Five nodes close together near the centre: the worst case for collisions.
    [
      { id: 1, x: 300, y: 250, w: 200, priority: 5 },
      { id: 2, x: 330, y: 300, w: 220, priority: 4 },
      { id: 3, x: 410, y: 270, w: 190, priority: 3 },
      { id: 4, x: 380, y: 330, w: 150, priority: 2 },
      { id: 5, x: 290, y: 310, w: 210, priority: 1 },
    ],
    // Nodes at the canvas edge.
    [
      { id: 1, x: 60, y: 40, w: 230, priority: 3 },
      { id: 2, x: 690, y: 520, w: 230, priority: 2 },
      { id: 3, x: 40, y: 280, w: 230, priority: 1 },
    ],
  ];

  it("no pill touches a node, the centre badge, a collection name, another pill or the canvas edge", () => {
    const avoid = [
      { l: 150, r: 300, t: 40, b: 70 },
      { l: 560, r: 700, t: 250, b: 280 },
    ];
    for (const nodes of scenes) {
      const out = placePills(nodes, { ...opts, avoid });
      expect(out).toHaveLength(nodes.length);
      for (const p of out) {
        const b = box(p);
        expect(b.l).toBeGreaterThanOrEqual(4);
        expect(b.r).toBeLessThanOrEqual(CANVAS.w - 4);
        expect(b.t).toBeGreaterThanOrEqual(4);
        expect(b.b).toBeLessThanOrEqual(CANVAS.h - 4);
        expect(near(b, CANVAS.cx, CANVAS.cy, 34)).toBe(false);
        for (const a of avoid) expect(overlap(b, a)).toBe(false);
        for (const n of nodes) if (n.id !== p.id) expect(near(b, n.x, n.y, 15)).toBe(false);
        for (const q of out) if (q.id !== p.id) expect(overlap(b, box(q))).toBe(false);
      }
    }
  });

  it("a pill that is not beside its node gets a leader line, and a close one does not", () => {
    const [alone] = placePills([{ id: 1, x: 500, y: 200, w: 180, priority: 1 }], {
      ...opts,
      avoid: [],
    });
    expect(alone?.leader).toBeNull();
    const crowd = placePills(scenes[0] as PillIn[], { ...opts, avoid: [] });
    expect(crowd.some((p) => p.leader !== null)).toBe(true);
    for (const p of crowd) if (p.leader) expect(Number.isFinite(p.leader.x2)).toBe(true);
  });

  it("is deterministic", () => {
    const a = placePills(scenes[0] as PillIn[], { ...opts, avoid: [] });
    const b = placePills(scenes[0] as PillIn[], { ...opts, avoid: [] });
    expect(b).toEqual(a);
  });
});

describe("the in-zone halo", () => {
  it("keeps grey dots out of the zone ring and purple dots inside it", () => {
    const rings = [50, 70, 85];
    const r = rng(3);
    const d: Dot[] = Array.from({ length: 640 }, (_, i) => {
      const score = Math.round(38 + 62 * r() ** 1.6);
      return {
        pageId: `p${i}`,
        sector: ["a", "b", "c", "d", "e"][i % 5] as string,
        r: radiusOfScore(score),
        score,
        k: 1,
        inZone: score >= 85,
      };
    });
    const g = layoutConstellation(d, ["a", "b", "c", "d", "e"], rings, 9);
    const zoneR = g.ringR[2] as number;
    for (const p of g.placed) {
      const dist = Math.hypot(p.x - CANVAS.cx, p.y - CANVAS.cy);
      if (d[p.i]?.inZone) expect(dist).toBeLessThanOrEqual(zoneR + 1);
      else expect(dist).toBeGreaterThan(zoneR + 2);
    }
  });
});
