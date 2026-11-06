// My Agent: the pure parts. Grid math, device settings, the SSE reader, the tree check and the
// dictionary.
import { describe, expect, it, vi } from "vitest";
import {
  type Cell,
  clampCell,
  compact,
  firstFree,
  moveBy,
  overlaps,
  place,
  resizeBy,
  resolve,
  withDefaults,
} from "../agent/grid";
import {
  clearHistory,
  DEFAULTS,
  normalizeSettings,
  readHistory,
  readSettings,
  writeHistory,
  writeSettings,
} from "../agent/settings";
import { dispatch, errorKey, SseParser } from "../agent/stream";
import { sanitizeTree } from "../agent/tree";
import { ApiError } from "../api";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v6En, v6Fr } from "../i18n/v6";

const c = (id: string, x: number, y: number, w = 4, h = 3): Cell => ({ id, x, y, w, h });
const noOverlap = (cells: Cell[]) => cells.every((a) => cells.every((b) => !overlaps(a, b)));

describe("grid math", () => {
  it("clamps a cell inside twelve columns", () => {
    expect(clampCell(c("a", 10, -3, 6, 0))).toEqual({ id: "a", x: 6, y: 0, w: 6, h: 1 });
    expect(clampCell(c("a", 0, 0, 99, 99))).toMatchObject({ w: 12, h: 12, x: 0 });
  });

  it("detects overlap but never against itself or a neighbour that only touches", () => {
    expect(overlaps(c("a", 0, 0), c("b", 3, 2))).toBe(true);
    expect(overlaps(c("a", 0, 0), c("b", 4, 0))).toBe(false);
    expect(overlaps(c("a", 0, 0), c("a", 0, 0))).toBe(false);
  });

  it("pushes what is in the way down and leaves no collision", () => {
    const start = [c("a", 0, 0), c("b", 4, 0), c("c", 8, 0)];
    const next = place(start, c("c", 0, 0));
    expect(noOverlap(next)).toBe(true);
    expect(next.find((x) => x.id === "c")).toMatchObject({ x: 0, y: 0 });
    expect(next.find((x) => x.id === "a")?.y).toBeGreaterThanOrEqual(3);
  });

  it("compacts holes upward in reading order", () => {
    const out = compact([c("a", 0, 0), c("b", 0, 9), c("c", 6, 7)]);
    expect(out.find((x) => x.id === "b")?.y).toBe(3);
    expect(out.find((x) => x.id === "c")?.y).toBe(0);
    expect(noOverlap(out)).toBe(true);
  });

  it("finds the first free spot", () => {
    expect(firstFree([], 6, 5)).toEqual({ x: 0, y: 0 });
    expect(firstFree([c("a", 0, 0, 6, 5)], 6, 5)).toEqual({ x: 6, y: 0 });
    expect(firstFree([c("a", 0, 0, 6, 5), c("b", 6, 0, 6, 5)], 6, 5)).toEqual({ x: 0, y: 5 });
  });

  it("moves and resizes by one cell with the arrow keys, staying in the grid", () => {
    const g = [c("a", 0, 0)];
    expect(moveBy(g, "a", "left")[0]).toMatchObject({ x: 0 });
    expect(moveBy(g, "a", "right")[0]).toMatchObject({ x: 1 });
    expect(moveBy([c("a", 8, 0)], "a", "right")[0]).toMatchObject({ x: 8 });
    expect(resizeBy(g, "a", "right")[0]).toMatchObject({ w: 5 });
    expect(resizeBy(g, "a", "up")[0]).toMatchObject({ h: 2 });
    expect(resizeBy([c("a", 0, 0, 1, 1)], "a", "left")[0]).toMatchObject({ w: 1 });
  });

  it("resolves a broken layout and gives old pins without a layout a place", () => {
    const out = resolve([c("a", 0, 0), c("b", 1, 1), c("c", 0, 0)]);
    expect(noOverlap(out)).toBe(true);
    const d = withDefaults([
      { id: "x", layout: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "y" },
      { id: "z" },
    ]);
    expect(d.map((x) => x.id)).toEqual(["x", "y", "z"]);
    expect(noOverlap(d)).toBe(true);
  });

  it("stays collision free for random moves", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let g = withDefaults(Array.from({ length: 6 }, (_, i) => ({ id: `v${i}` })));
    for (let i = 0; i < 200; i++) {
      const id = `v${Math.floor(rnd() * 6)}`;
      const cur = g.find((x) => x.id === id) as Cell;
      g = place(g, {
        ...cur,
        x: Math.floor(rnd() * 12),
        y: Math.floor(rnd() * 20),
        w: 1 + Math.floor(rnd() * 8),
        h: 1 + Math.floor(rnd() * 5),
      });
      expect(noOverlap(g)).toBe(true);
      expect(g.every((x) => x.x >= 0 && x.x + x.w <= 12)).toBe(true);
    }
  });
});

describe("device settings and history", () => {
  it("falls back to defaults for missing, broken and unknown values", () => {
    window.localStorage.clear();
    expect(readSettings()).toEqual(DEFAULTS);
    window.localStorage.setItem("secondary.agent.settings", "{nope");
    expect(readSettings()).toEqual(DEFAULTS);
    expect(
      normalizeSettings({ density: "huge", theme: "light", lang: "fr", tokens: "yes" }),
    ).toEqual({ density: "comfortable", theme: "light", lang: "fr", tokens: false });
  });

  it("writes patches and survives a store that throws", () => {
    window.localStorage.clear();
    expect(writeSettings({ tokens: true, density: "compact" })).toMatchObject({
      tokens: true,
      density: "compact",
    });
    expect(readSettings().tokens).toBe(true);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSettings()).toEqual(DEFAULTS);
    expect(() => writeSettings({ theme: "light" })).not.toThrow();
    expect(readHistory()).toEqual([]);
    expect(() => writeHistory([])).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it("keeps history per persona, drops broken entries, caps it and clears it", () => {
    window.localStorage.clear();
    window.localStorage.setItem("secondary.persona", "ceo");
    const e = (n: number) => ({ id: `h${n}`, label: `q${n}`, program: "root = Stack([a])", at: n });
    writeHistory(Array.from({ length: 30 }, (_, i) => e(i)));
    expect(readHistory()).toHaveLength(20);
    window.localStorage.setItem("secondary.persona", "consultant");
    expect(readHistory()).toEqual([]);
    window.localStorage.setItem("secondary.persona", "ceo");
    window.localStorage.setItem("secondary.agent.history.ceo", JSON.stringify([{ nope: 1 }, e(1)]));
    expect(readHistory()).toHaveLength(1);
    clearHistory();
    expect(readHistory()).toEqual([]);
  });
});

describe("SSE reader", () => {
  it("reassembles events split anywhere and ignores comments", () => {
    const p = new SseParser();
    const text =
      ': hi\r\nevent: line\r\ndata: {"text":"a"}\r\n\r\nevent: done\ndata: {"turnId":"t","lines":1}\n\n';
    const got = [];
    for (const ch of text) got.push(...p.push(ch));
    expect(got.map((g) => g.event)).toEqual(["line", "done"]);
  });

  it("hands each event to its handler and ignores bad payloads", () => {
    const h = { onLine: vi.fn(), onMeta: vi.fn(), onError: vi.fn(), onUsage: vi.fn() };
    dispatch({ event: "line", data: '{"text":"x = Funnel(\\"a\\")"}' }, h);
    dispatch({ event: "line", data: "not json" }, h);
    dispatch(
      { event: "meta", data: '{"turnId":"t","mode":"deterministic","reason":"ai_disabled"}' },
      h,
    );
    dispatch({ event: "meta", data: '{"turnId":"t","mode":"wild"}' }, h);
    dispatch({ event: "error", data: '{"code":"rate_limited"}' }, h);
    expect(h.onLine).toHaveBeenCalledTimes(1);
    expect(h.onMeta).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith("rate_limited");
  });

  it("maps refusals to plain wording keys", () => {
    expect(errorKey(new ApiError(429, "x"))).toBe("v6.error.rate_limited");
    expect(errorKey(new ApiError(403, "x"))).toBe("v6.error.forbidden");
    expect(errorKey(new ApiError(400, "x"))).toBe("v6.error.invalid");
    expect(errorKey("anything")).toBe("v6.error.generic");
  });
});

describe("tree check on the client", () => {
  it("keeps registered nodes and drops everything else", () => {
    const tree = {
      id: "root",
      type: "Stack",
      props: {},
      children: [
        { id: "a", type: "Funnel", props: { brain: "c_bid" }, children: [] },
        { id: "b", type: "Script", props: { src: "x" }, children: [] },
        { id: "c", type: "Funnel", props: { brain: "c_bid", onClick: "alert(1)" }, children: [] },
        { id: "d", type: "Funnel", props: { brain: "../etc" }, children: [] },
        {
          id: "e",
          type: "Locked",
          props: { reason: "no_access", title: "Secret brain" },
          children: [],
        },
      ],
    };
    const out = sanitizeTree(tree);
    expect(out?.children.map((x) => x.type)).toEqual(["Funnel", "Locked"]);
    // A placeholder carries a reason only: nothing from the plan rides along.
    expect(out?.children[1]?.props).toEqual({ reason: "no_access" });
    expect(
      sanitizeTree({
        id: "x",
        type: "Button",
        props: { label: "Delete", action: "focus" },
        children: [],
      }),
    ).toBeNull();
    expect(sanitizeTree("<script>")).toBeNull();
  });
});

describe("v6 dictionary", () => {
  const keys = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("v6."));
  const E = en as Record<string, string>;
  const F = fr as Record<string, string>;
  const SAME = new Set([
    "v6.page.title",
    "v6.callout.tone.info",
    "v6.act.ask",
    "v6.thread",
    "v6.t.pages",
    "v6.t.page",
    "v6.col.type",
  ]);
  it("defines the same keys in English and French", () => {
    expect(keys(F).sort()).toEqual(keys(E).sort());
    expect(keys(E).length).toBe(Object.keys(v6En).length);
    expect(Object.keys(v6Fr).sort()).toEqual(Object.keys(v6En).sort());
  });
  it("translates every French value except the listed same-word cases", () => {
    expect(keys(E).filter((k) => E[k] === F[k] && !SAME.has(k))).toEqual([]);
  });
  it("keeps the same {placeholders} in both languages and no em dashes", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys(E)) {
      expect(vars(F[k] ?? ""), k).toEqual(vars(E[k] ?? ""));
      expect(`${E[k]}${F[k]}`.includes("—"), k).toBe(false);
    }
  });
});
