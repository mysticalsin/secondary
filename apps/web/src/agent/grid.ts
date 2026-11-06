// The 12-column grid of pinned views as pure functions: no DOM, no React. Rows are unbounded
// (y up to 200 in the contract), items are {id, x, y, w, h} in grid cells.

export const COLS = 12;
export const MAX_ROW = 200;
export const MAX_H = 12;

export interface Cell {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Keep one cell inside the grid with at least 1x1 and at most 12 wide and 12 high. */
export function clampCell(c: Cell): Cell {
  const w = clamp(Math.round(c.w), 1, COLS);
  const h = clamp(Math.round(c.h), 1, MAX_H);
  return {
    ...c,
    w,
    h,
    x: clamp(Math.round(c.x), 0, COLS - w),
    y: clamp(Math.round(c.y), 0, MAX_ROW),
  };
}

export const overlaps = (a: Cell, b: Cell): boolean =>
  a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const byPosition = (a: Cell, b: Cell): number => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);

/** Pull every cell up as far as it can go without crossing another. Stable: reading order wins. */
export function compact(cells: readonly Cell[]): Cell[] {
  const out: Cell[] = [];
  for (const c of [...cells].sort(byPosition)) {
    let y = c.y;
    while (y > 0 && !out.some((o) => overlaps({ ...c, y: y - 1 }, o))) y--;
    out.push({ ...c, y });
  }
  return cells.map((c) => out.find((o) => o.id === c.id) as Cell);
}

/**
 * Put `moved` where it was asked to go (clamped). Anything it now overlaps is pushed down just far
 * enough, and what that pushes is pushed in turn. Then the grid is compacted upward so no hole stays,
 * except that the moved cell keeps its row. Returns a collision-free layout.
 */
export function place(cells: readonly Cell[], moved: Cell): Cell[] {
  const target = clampCell(moved);
  const rest = cells.filter((c) => c.id !== target.id).map((c) => ({ ...c }));
  // Fixed cell is `target`; the others settle below it in reading order.
  const settled: Cell[] = [target];
  for (const c of rest.sort(byPosition)) {
    let y = c.y;
    // Walk down until clear of every settled cell.
    for (let guard = 0; guard < MAX_ROW * 2; guard++) {
      const hit = settled.find((s) => overlaps({ ...c, y }, s));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    settled.push({ ...c, y });
  }
  const order = new Map(cells.map((c, i) => [c.id, i]));
  const fixed = target.id;
  // Compact everyone but the target upward (the target stays put, others slide into holes).
  const compacted: Cell[] = [];
  const pool = settled.filter((c) => c.id !== fixed).sort(byPosition);
  const anchors: Cell[] = [target];
  for (const c of pool) {
    let y = c.y;
    while (y > 0 && !anchors.some((o) => overlaps({ ...c, y: y - 1 }, o))) y--;
    const done = { ...c, y };
    anchors.push(done);
    compacted.push(done);
  }
  const all = [target, ...compacted];
  all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return all;
}

/** Where a new cell goes: the first free spot, scanning rows from the top. */
export function firstFree(cells: readonly Cell[], w: number, h: number): { x: number; y: number } {
  const ww = clamp(w, 1, COLS);
  for (let y = 0; y <= MAX_ROW; y++) {
    for (let x = 0; x + ww <= COLS; x++) {
      const probe: Cell = { id: "__new", x, y, w: ww, h };
      if (!cells.some((c) => overlaps(probe, c))) return { x, y };
    }
  }
  return { x: 0, y: MAX_ROW };
}

export type Dir = "left" | "right" | "up" | "down";
const STEP: Record<Dir, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Arrow key: move by one cell. */
export function moveBy(cells: readonly Cell[], id: string, dir: Dir): Cell[] {
  const c = cells.find((x) => x.id === id);
  if (!c) return [...cells];
  const [dx, dy] = STEP[dir];
  return place(cells, { ...c, x: c.x + dx, y: c.y + dy });
}

/** Shift and arrow: grow or shrink by one cell (right and down grow, left and up shrink). */
export function resizeBy(cells: readonly Cell[], id: string, dir: Dir): Cell[] {
  const c = cells.find((x) => x.id === id);
  if (!c) return [...cells];
  const [dx, dy] = STEP[dir];
  return place(cells, { ...c, w: c.w + dx, h: c.h + dy });
}

/** Pointer: a cell size or position in pixels to grid cells, given the grid's width and row height. */
export function cellOf(px: number, width: number, gap: number): number {
  const col = (width - gap * (COLS - 1)) / COLS;
  return Math.round(px / (col + gap));
}

/** The default size of a new pin: wide for a stack, as tall as its content suggests. */
export const DEFAULT_SIZE = { w: 6, h: 9 } as const;

/** Make any layout collision-free (reading order wins, later cells slide down) and compact. */
export function resolve(cells: readonly Cell[]): Cell[] {
  const placed: Cell[] = [];
  for (const c0 of [...cells].map(clampCell).sort(byPosition)) {
    let y = c0.y;
    for (let guard = 0; guard < MAX_ROW * 2; guard++) {
      const hit = placed.find((s) => overlaps({ ...c0, y }, s));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    placed.push({ ...c0, y });
  }
  const done = compact(placed);
  return cells.map((c) => done.find((d) => d.id === c.id) as Cell);
}

/** Layouts from the server may be missing (old pins): give each a free spot, then settle. */
export function withDefaults(
  views: readonly {
    id: string;
    layout?: { x: number; y: number; w: number; h: number } | undefined;
  }[],
): Cell[] {
  const cells: Cell[] = [];
  for (const v of views) {
    if (v.layout) cells.push(clampCell({ id: v.id, ...v.layout }));
  }
  for (const v of views) {
    if (!v.layout)
      cells.push({
        id: v.id,
        ...firstFree(cells, DEFAULT_SIZE.w, DEFAULT_SIZE.h),
        ...DEFAULT_SIZE,
      });
  }
  const done = resolve(cells);
  return views.map((v) => done.find((d) => d.id === v.id) as Cell);
}
