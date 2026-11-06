// Pure rules of the Insights aggregation: determinism, dense bucketing, score shapes.

import { describe, expect, it } from "vitest";
import {
  buildActivity,
  buildConstellation,
  buildFlow,
  confidenceScore,
  evidenceScore,
  freshnessScore,
  type PageIn,
  radiusOf,
  seedOf,
  ZONE,
} from "../src/brains/insights.ts";
import type { InsightRaw } from "../src/brains/store.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5);
const page = (n: number, type = "topic", age = n % 200): PageIn => ({
  id: `p${n}`,
  type,
  title: `Page ${n}`,
  summary: "",
  markdown: `# Page ${n}\n\n## Summary\n- Line {src:s${n % 5}}\n- Another\n`,
  createdAt: NOW - (age + 30) * DAY,
  updatedAt: NOW - age * DAY,
});
const labelOf = (t: string) => t;
const base = {
  brainId: "c_x",
  labelOf,
  mode: "freshness" as const,
  q: "",
  now: NOW,
  freshnessDays: 180,
};

describe("constellation", () => {
  it("is a pure function of its input: same pages, same dots, same seed", () => {
    const pages = Array.from({ length: 120 }, (_, n) => page(n, n % 3 ? "topic" : "method"));
    const a = buildConstellation({ ...base, pages, cap: 400 });
    const b = buildConstellation({ ...base, pages: [...pages].reverse(), cap: 400 });
    expect(b).toEqual(a);
    expect(seedOf("x")).toBe(seedOf("x"));
    expect(seedOf("x")).not.toBe(seedOf("y"));
  });

  it("buckets a dense brain: no more dots than the cap allows, k pages per dot, totals kept", () => {
    const pages = Array.from({ length: 1_500 }, (_, n) => page(n, ["a", "b", "c", "d"][n % 4]));
    const c = buildConstellation({ ...base, pages, cap: 400 });
    expect(c.legend.perDot).toBe(4);
    expect(c.dots.length).toBeLessThanOrEqual(400 + 4 + 5);
    expect(c.dots.reduce((n, d) => n + d.k, 0)).toBe(1_500);
    expect(c.legend.total).toBe(1_500);
    expect(c.dots.every((d) => d.k === 1 || d.pageId === null)).toBe(true);
    // Bucketed dots are never named; the five named pages keep a dot of their own.
    expect(c.dots.filter((d) => d.k > 1).some((d) => d.label || d.title)).toBe(false);
    const named = c.dots.filter((d) => d.highlight);
    expect(named).toHaveLength(5);
    expect(named.every((d) => d.k === 1 && d.label && d.pageId)).toBe(true);
  });

  it("names at most five single pages and the radius falls as the score rises", () => {
    const pages = Array.from({ length: 40 }, (_, n) => page(n, "topic", n * 2));
    const c = buildConstellation({ ...base, pages, cap: 400 });
    expect(c.dots.filter((d) => d.highlight)).toHaveLength(5);
    const sorted = [...c.dots].sort((a, z) => z.score - a.score);
    for (let n = 1; n < sorted.length; n++)
      expect((sorted[n] as (typeof sorted)[0]).r).toBeGreaterThanOrEqual(
        (sorted[n - 1] as (typeof sorted)[0]).r,
      );
    expect(radiusOf(100)).toBe(0);
    expect(radiusOf(40)).toBe(1);
    expect(radiusOf(ZONE)).toBeLessThan(radiusOf(50));
  });

  it("with a query the matching page is nearer the centre than the rest", () => {
    const pages = [
      page(1),
      page(2),
      { ...page(3), title: "Pricing method", markdown: "# Pricing method\n\n- Pricing steps\n" },
    ];
    const c = buildConstellation({ ...base, mode: "relevance", q: "pricing", pages, cap: 400 });
    const hit = c.dots.find((d) => d.pageId === "p3");
    expect(hit?.score).toBeGreaterThanOrEqual(ZONE);
    expect(c.dots.filter((d) => d.pageId !== "p3").every((d) => d.score < ZONE)).toBe(true);
  });
});

describe("scores", () => {
  it("freshness falls with age, evidence is the cited share of lines", () => {
    expect(freshnessScore(page(1, "t", 0), NOW, 180)).toBe(100);
    expect(freshnessScore(page(1, "t", 270), NOW, 180)).toBe(0);
    expect(evidenceScore(page(1))).toBe(50);
    expect(evidenceScore({ ...page(1), markdown: "# T\n" })).toBe(0);
  });

  it("confidence weighs verified facts, and an uncited page is the least trusted", () => {
    const facts: InsightRaw["facts"] = [
      { sourceIds: ["s1"], verified: true, confidence: 1 },
      { sourceIds: ["s1"], verified: false, confidence: 1 },
    ];
    expect(confidenceScore(page(1), facts)).toBe(75);
    expect(confidenceScore(page(1), [])).toBe(50);
    expect(confidenceScore({ ...page(1), markdown: "# T\n- x" }, facts)).toBe(30);
  });
});

describe("flow and activity", () => {
  const raw = (over: Partial<InsightRaw> = {}): InsightRaw => ({
    revisions: [],
    proposals: [],
    ingested: [],
    promotions: 0,
    facts: [],
    sourceKinds: {},
    provenance: {},
    ...over,
  });
  const prop = (n: number, status: string, titleSources: string[] = []) => ({
    id: `c${n}`,
    kind: "wiki_ingest",
    status,
    createdAt: NOW - 5 * DAY,
    decidedAt: NOW - 3 * DAY,
    origin: "human",
    rationale: "",
    sources: [],
    titleSources,
    reviewed: status !== "candidate",
  });

  it("drops a proposal whose title would show an unreadable source", () => {
    const r = raw({ proposals: [prop(1, "approved"), prop(2, "approved", ["secret"])] });
    const f = buildFlow({ raw: r, readable: new Set(), window: "30d", promotes: false, now: NOW });
    expect(f.stages.map((s) => s.count)).toEqual([1, 1, 1, 1]);
    expect(f.publishRate).toBe(100);
    expect(f.medianDaysToReview).toBe(2);
    expect(f.seenAllRate).toBe(100);
    const ok = buildFlow({
      raw: r,
      readable: new Set(["secret"]),
      window: "30d",
      promotes: true,
      now: NOW,
    });
    expect(ok.stages.at(-1)?.key).toBe("promoted");
    expect(ok.stages[1]?.count).toBe(2);
  });

  it("an empty brain has no rate and no median", () => {
    const f = buildFlow({
      raw: raw(),
      readable: new Set(),
      window: "30d",
      promotes: false,
      now: NOW,
    });
    expect(f).toMatchObject({ publishRate: null, medianDaysToReview: null, seenAllRate: null });
  });

  it("activity counts only the pages it is given, by day, in order", () => {
    const ev = [
      { pageId: "a", at: NOW - DAY },
      { pageId: "a", at: NOW - DAY },
      { pageId: "b", at: NOW - 2 * DAY },
      { pageId: "hidden", at: NOW },
    ];
    const act = buildActivity(ev, new Set(["a", "b"]), NOW);
    expect(act.days).toEqual([
      { date: "2026-11-03", count: 1 },
      { date: "2026-11-04", count: 2 },
    ]);
  });
});
