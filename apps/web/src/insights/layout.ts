// Deterministic geometry for the Insights charts. Pure: the same data and seed give the same
// pixels, so a screenshot is stable and a test can compare positions. No randomness outside the
// seeded generator below.

import type { Dot } from "./types";

/** A small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;

// ---------- constellation ----------

export interface Placed {
  /** Index into the dots array the layout was given. */
  i: number;
  x: number;
  y: number;
  sector: number;
  band: number;
}

export interface SectorLabel {
  id: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** Mid angle of the sector, radians. */
  angle: number;
}

export interface Geometry {
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  inner: number;
  pitch: number;
  /** Radius of each ring score (same order as `rings`). */
  ringR: number[];
  placed: Placed[];
  labels: SectorLabel[];
}

export const CANVAS = { w: 720, h: 560, cx: 360, cy: 280, R: 224, inner: 34, pitch: 8.2 } as const;

/** Radius (px) of a 0..1 relative radius. */
export const rho = (r: number, R: number = CANVAS.R, inner: number = CANVAS.inner): number =>
  inner + r * (R - inner - 4);

/** The relative radius of a score, as the server computes it for a dot. */
export const radiusOfScore = (score: number): number =>
  Math.sqrt(Math.max(0, Math.min(1, (100 - score) / 60)));

export function layoutConstellation(
  dots: readonly Dot[],
  sectorIds: readonly string[],
  rings: readonly number[],
  seed: number,
  pitchOverride?: number,
): Geometry {
  const { w, h, cx, cy, R, inner } = CANVAS;
  const pitch = pitchOverride ?? CANVAS.pitch;
  const nSec = Math.max(1, sectorIds.length);
  const span = TAU / nSec;
  const start = -Math.PI / 2 - span / 2;
  const bandCount = Math.floor((R - inner - 4) / pitch) + 1;
  const bandRho = (j: number) => inner + j * pitch;
  const cap = (j: number) => Math.max(1, Math.floor((span * bandRho(j) * 0.92) / pitch));
  const sectorIndex = new Map(sectorIds.map((s, n) => [s, n]));

  // 1. Each dot goes to the band its radius asks for, or the nearest band with room.
  const order = dots.map((d, i) => ({ d, i })).sort((a, z) => a.d.r - z.d.r || a.i - z.i);
  const used = Array.from({ length: nSec }, () => new Array<number>(bandCount).fill(0));
  const cells = new Map<string, number[]>();
  const bandOf = new Array<number>(dots.length).fill(0);
  for (const { d, i } of order) {
    const s = sectorIndex.get(d.sector) ?? 0;
    const row = used[s] as number[];
    const want = Math.max(0, Math.min(bandCount - 1, Math.round((rho(d.r) - inner) / pitch)));
    let j = want;
    if ((row[want] as number) >= cap(want)) {
      j = -1;
      for (let step = 1; step < bandCount && j < 0; step++) {
        const out = want + step;
        const inn = want - step;
        if (out < bandCount && (row[out] as number) < cap(out)) j = out;
        else if (inn >= 0 && (row[inn] as number) < cap(inn)) j = inn;
      }
      if (j < 0) j = want;
    }
    row[j] = (row[j] as number) + 1;
    bandOf[i] = j;
    const key = `${s}:${j}`;
    cells.set(key, [...(cells.get(key) ?? []), i]);
  }

  // 2. Inside a band the dots take a seeded subset of the band's evenly spaced slots.
  const placed: Placed[] = new Array(dots.length);
  for (const [key, members] of cells) {
    const [sRaw, jRaw] = key.split(":");
    const s = Number(sRaw);
    const j = Number(jRaw);
    const c = cap(j);
    const rand = rng(seed ^ Math.imul(s + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca6b));
    // Evenly spaced slots with a small seeded wobble: a band thins out, it does not clump.
    const take: number[] = [];
    if (members.length >= c) for (let n = 0; n < c; n++) take.push(n);
    else {
      let last = -1;
      // A random phase per band, so the thinned bands do not line up into radial stripes.
      const phase = 0.15 + rand() * 0.7;
      for (let n = 0; n < members.length; n++) {
        const want = Math.floor(((n + phase + (rand() - 0.5) * 0.3) * c) / members.length);
        const slot = Math.min(c - (members.length - n), Math.max(last + 1, want));
        take.push(slot);
        last = slot;
      }
    }
    const a0 = start + s * span + span * 0.04;
    const rr = bandRho(j);
    members.forEach((i, n) => {
      const slot = take[n] as number;
      const stagger = j % 2 ? 0.5 : 0;
      const a = a0 + ((slot + 0.5 + stagger * 0.5) / c) * span * 0.92;
      placed[i] = {
        i,
        x: round(cx + rr * Math.cos(a)),
        y: round(cy + rr * Math.sin(a)),
        sector: s,
        band: j,
      };
    });
  }

  const labels: SectorLabel[] = sectorIds.map((id, n) => {
    const angle = start + n * span + span / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      id,
      angle,
      x: round(cx + (R + 18) * cos),
      y: round(cy + (R + 18) * sin + (Math.abs(sin) > 0.8 ? (sin > 0 ? 12 : -4) : 4)),
      anchor: cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle",
    };
  });
  return {
    w,
    h,
    cx,
    cy,
    R,
    inner,
    pitch,
    ringR: rings.map((s) => round(rho(radiusOfScore(s)))),
    placed,
    labels,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

// ---------- hit testing ----------

export interface Grid {
  cell: number;
  cells: Map<number, number[]>;
  cols: number;
}

export function buildGrid(points: readonly { x: number; y: number }[], cell = 16, w = 700): Grid {
  const cols = Math.ceil(w / cell) + 2;
  const cells = new Map<number, number[]>();
  points.forEach((p, i) => {
    const k = Math.floor(p.y / cell) * cols + Math.floor(p.x / cell);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  });
  return { cell, cells, cols };
}

/** The index of the point nearest (x, y) within `max` pixels, or -1. Looks at the 3 x 3 cells around. */
export function nearest(
  g: Grid,
  points: readonly { x: number; y: number }[],
  x: number,
  y: number,
  max: number,
): number {
  const cx = Math.floor(x / g.cell);
  const cy = Math.floor(y / g.cell);
  let best = -1;
  let bestD = max * max;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const list = g.cells.get((cy + dy) * g.cols + (cx + dx));
      if (!list) continue;
      for (const i of list) {
        const p = points[i] as { x: number; y: number };
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  return best;
}

// ---------- beeswarm ----------

export interface Swarm {
  lo: number;
  hi: number;
  r: number;
  pitch: number;
  dots: { i: number; x: number; y: number }[];
  /** x of a score. */
  x: (score: number) => number;
}

/**
 * Dots stacked in columns by score, centred on the middle line, as in the reference. The dot radius
 * shrinks until the tallest column fits the height.
 */
export function layoutBeeswarm(
  scores: readonly number[],
  o: { w: number; h: number; pad?: number; r?: number },
): Swarm {
  const pad = o.pad ?? 8;
  // The axis starts where nearly all pages are (the 3rd percentile, rounded down); outliers sit on its edge.
  const sorted = [...scores].sort((a, z) => a - z);
  const min = sorted[Math.floor(sorted.length * 0.03)] ?? 50;
  const lo = Math.min(50, Math.max(0, Math.floor(min / 10) * 10));
  const hi = 100;
  const x = (s: number) =>
    pad + ((Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo)) * (o.w - 2 * pad);
  let r = o.r ?? 3.3;
  let out: Swarm["dots"] = [];
  let pitch = 2 * r + 1.2;
  for (let guard = 0; guard < 24; guard++) {
    pitch = 2 * r + 1.2;
    // Columns are wider apart than the dots in a column, as in the reference.
    const xp = pitch * 1.45;
    const cols = new Map<number, number[]>();
    const wob = rng(0x5eed);
    scores.forEach((s, i) => {
      // Scores are whole numbers; a seeded half-point wobble stops the columns from beating against them.
      const c = Math.round((x(s + (wob() - 0.5)) - pad) / xp);
      const list = cols.get(c);
      if (list) list.push(i);
      else cols.set(c, [i]);
    });
    const tallest = Math.max(1, ...[...cols.values()].map((l) => l.length));
    if (tallest * pitch > o.h - 4 && r > 1.6) {
      r = Math.max(1.6, r - 0.2);
      continue;
    }
    out = [];
    for (const [c, members] of cols) {
      members.sort((a, z) => a - z);
      members.forEach((i, n) => {
        const step = Math.ceil(n / 2) * (n % 2 ? 1 : -1);
        out.push({ i, x: round(pad + c * xp), y: round(o.h / 2 + step * pitch) });
      });
    }
    break;
  }
  out.sort((a, z) => a.i - z.i);
  return { lo, hi, r, pitch, dots: out, x };
}

// ---------- activity grid ----------

export interface ActivityCell {
  col: number;
  row: number;
  date: string;
  count: number;
}

const DAY = 86_400_000;
const parse = (d: string): number => Date.parse(`${d}T00:00:00Z`);

/** Weeks as columns, weekdays (Monday first) as rows. */
export function layoutActivity(
  days: readonly { date: string; count: number }[],
  from: string,
  to: string,
): { cells: ActivityCell[]; cols: number; months: { col: number; month: number }[]; max: number } {
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const start = parse(from);
  const end = parse(to);
  const weekday = (t: number) => (new Date(t).getUTCDay() + 6) % 7;
  const origin = start - weekday(start) * DAY;
  const cells: ActivityCell[] = [];
  const months: { col: number; month: number }[] = [];
  let lastMonth = -1;
  for (let t = start; t <= end; t += DAY) {
    const col = Math.floor((t - origin) / (7 * DAY));
    const date = new Date(t).toISOString().slice(0, 10);
    cells.push({ col, row: weekday(t), date, count: counts.get(date) ?? 0 });
    const m = new Date(t).getUTCMonth();
    if (m !== lastMonth && weekday(t) <= 3) {
      months.push({ col, month: m });
      lastMonth = m;
    }
  }
  const cols = cells.length ? (cells[cells.length - 1] as ActivityCell).col + 1 : 0;
  return { cells, cols, months, max: Math.max(1, ...cells.map((c) => c.count)) };
}

// ---------- funnel ----------

export interface FunnelBar {
  key: string;
  count: number;
  x: number;
  w: number;
  y: number;
  h: number;
}

/** Bars centred on the middle; width follows the count, never below `min` of the full width. */
export function layoutFunnel(
  counts: readonly { key: string; count: number }[],
  o: { w: number; bar: number; gap: number; min?: number },
): FunnelBar[] {
  const max = Math.max(1, ...counts.map((c) => c.count));
  const min = o.min ?? 0.2;
  return counts.map((c, n) => {
    const frac = Math.max(min, (c.count / max) ** 0.7);
    const w = o.w * frac;
    return { key: c.key, count: c.count, x: (o.w - w) / 2, w, y: n * (o.bar + o.gap), h: o.bar };
  });
}

// ---------- timeline ----------

export function timeDomain(
  bars: readonly { start: string; end: string }[],
  now: string,
): { from: number; to: number } {
  const to = parse(now);
  const from = bars.length ? Math.min(...bars.map((b) => parse(b.start))) : to - 365 * DAY;
  return { from: Math.min(from, to - 180 * DAY), to };
}

export const dayNumber = parse;
