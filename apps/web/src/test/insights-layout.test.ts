import { describe, expect, it } from "vitest";
import {
  buildGrid,
  CANVAS,
  layoutActivity,
  layoutBeeswarm,
  layoutConstellation,
  layoutFunnel,
  nearest,
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
