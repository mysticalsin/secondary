// Pure aggregation for the v5 Brain Insights (docs/DESIGN-V5-BRAIN-INSIGHTS.md section 3). Input is
// what one caller may already read of one brain: no function here reads another brain, a policy view
// or storage. Output carries no page bodies, and titles only for pages in the input.

import { tokensOf } from "../wiki/text.ts";
import { DAY, type TemplateId } from "./model.ts";
import type { InsightRaw } from "./store.ts";

export const RINGS = [50, 70, 85] as const;
/** A page scoring this or more is "in the zone" of the constellation. */
export const ZONE = 70;
/** A page below this health score is due for review ("Review below 60%"). */
export const THRESHOLD = 60;
export const ACTIVITY_DAYS = 182;
export const DOT_CAP = 400;
export const MINI_DOT_CAP = 140;
export const HEALTH_CAP = 1_200;
const MAX_LABELS = 5;

export type Mode = "relevance" | "freshness";
export type ScoreKind = "freshness" | "confidence" | "evidence";
export const SCORE_KINDS: readonly ScoreKind[] = ["freshness", "confidence", "evidence"];
export const WINDOWS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type WindowKey = keyof typeof WINDOWS;
export type SourceKind = "sharepoint" | "meetings" | "agents" | "manual" | "import";

export interface PageIn {
  id: string;
  type: string;
  title: string;
  summary: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface Dot {
  /** The page id, or null when the dot stands for several pages. */
  pageId: string | null;
  sector: string;
  /** 0 centre to 1 edge. */
  r: number;
  score: number;
  /** Pages this dot stands for. */
  k: number;
  inZone: boolean;
  label?: string;
  highlight?: boolean;
}

export interface Constellation {
  mode: Mode;
  q: string;
  seed: number;
  sectors: { id: string; label: string; count: number }[];
  dots: Dot[];
  rings: number[];
  legend: { inZone: number; below: number; perDot: number; threshold: number; total: number };
}

export interface HealthPoint {
  pageId: string | null;
  title: string | null;
  score: number;
  scores: Record<ScoreKind, number>;
  source: SourceKind;
  k: number;
}

export interface CoverageRow {
  key: string;
  label: string;
  value: number;
  target: number;
  unit: "pages" | "lines";
  state: "ok" | "low" | "missing";
}

export interface TimelineBar {
  label: string;
  start: string;
  end: string;
  kind: string;
}

export interface Insights {
  brainId: string;
  name: string;
  generatedAt: string;
  window: WindowKey;
  constellation: Constellation;
  focus: {
    kind: "brain" | "page";
    pageId: string | null;
    title: string;
    type: string;
    coverage: CoverageRow[];
    timeline: TimelineBar[];
    activity: { from: string; to: string; days: { date: string; count: number }[] };
    status: { value: "active" | "watch" | "dormant"; since: string | null } | null;
  };
  health: {
    scoreKind: ScoreKind;
    threshold: number;
    total: number;
    perPoint: number;
    points: HealthPoint[];
    above: Record<ScoreKind, number>;
    weekDelta: Record<ScoreKind, number>;
    sources: { kind: SourceKind; count: number }[];
  };
  flow: {
    window: WindowKey;
    stages: {
      key: "ingested" | "proposed" | "reviewed" | "published" | "promoted";
      count: number;
    }[];
    publishRate: number | null;
    medianDaysToReview: number | null;
    seenAllRate: number | null;
  };
  activity: { from: string; to: string; days: { date: string; count: number }[] };
  timeline: TimelineBar[];
}

// ---- small deterministic helpers ----

/** FNV-1a, 32 bits: the layout seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Score (0 to 100) to radius (0 centre to 1 edge): 85 sits near half way, 50 near the edge. */
export const radiusOf = (score: number): number =>
  Math.round(Math.sqrt(clamp((100 - score) / 60, 0, 1)) * 1000) / 1000;

const trim = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const SRC = /\{src:([^}\s]+)\}/g;
const citedIn = (md: string): string[] => [...md.matchAll(SRC)].map((m) => m[1] as string);
const LINK = /\[\[([a-z0-9][a-z0-9:-]*)\]\]/g;

/** Pages linking to each page of this brain (links to other brains do not count). */
function inboundOf(pages: PageIn[]): Map<string, number> {
  const ids = new Set(pages.map((p) => p.id));
  const out = new Map<string, number>();
  for (const p of pages)
    for (const m of p.markdown.matchAll(LINK)) {
      const t = m[1] as string;
      if (t !== p.id && ids.has(t)) out.set(t, (out.get(t) ?? 0) + 1);
    }
  return out;
}

// ---- scores ----

export function freshnessScore(p: PageIn, now: number, freshnessDays: number): number {
  const age = Math.max(0, now - p.updatedAt) / DAY;
  return Math.round(clamp(100 * (1 - age / (freshnessDays * 1.5))));
}

/** Share of content lines that carry a citation. A page that cites nothing scores 0. */
export function evidenceScore(p: PageIn): number {
  const lines = p.markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return 0;
  const cited = lines.filter((l) => l.includes("{src:")).length;
  return Math.round((cited / lines.length) * 100);
}

/**
 * Confidence: the verified share of the valid facts that rest on this page's sources, each fact
 * weighted by its stored confidence. A page with no such fact is unverified: cited 50, uncited 30.
 */
export function confidenceScore(p: PageIn, facts: InsightRaw["facts"]): number {
  const cited = new Set(citedIn(p.markdown));
  const mine = cited.size ? facts.filter((f) => f.sourceIds.some((s) => cited.has(s))) : [];
  if (!mine.length) return cited.size ? 50 : 30;
  const sum = mine.reduce((n, f) => n + (f.verified ? 1 : 0.5) * clamp(f.confidence, 0, 1), 0);
  return Math.round(clamp((sum / mine.length) * 100));
}

function relevanceScore(p: PageIn, tokens: string[], inbound: number): number {
  const centrality = Math.min(55, inbound * 12 + citedIn(p.markdown).length * 6);
  if (!tokens.length) return Math.round(40 + centrality);
  const title = p.title.toLowerCase();
  const summary = p.summary.toLowerCase();
  const body = p.markdown.toLowerCase();
  let hits = 0;
  for (const t of tokens)
    hits +=
      (title.includes(t) ? 3 : 0) + (summary.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0);
  // Any hit puts a page in the zone; more hits (title, summary, body, more words) move it inward.
  return Math.round(clamp(hits ? 40 + (60 * hits) / (6 * tokens.length) : 8 + centrality / 8));
}

// ---- constellation ----

export function buildConstellation(i: {
  brainId: string;
  pages: PageIn[];
  labelOf: (type: string) => string;
  mode: Mode;
  q: string;
  now: number;
  freshnessDays: number;
  cap: number;
}): Constellation {
  const tokens = tokensOf(i.q);
  const inbound = inboundOf(i.pages);
  const scored = i.pages.map((p) => ({
    p,
    score:
      i.mode === "freshness"
        ? freshnessScore(p, i.now, i.freshnessDays)
        : relevanceScore(p, tokens, inbound.get(p.id) ?? 0),
  }));
  const bySector = new Map<string, typeof scored>();
  for (const s of scored) {
    const list = bySector.get(s.p.type) ?? [];
    list.push(s);
    bySector.set(s.p.type, list);
  }
  const types = [...bySector.keys()].sort((a, z) => i.labelOf(a).localeCompare(i.labelOf(z)));
  const perDot = Math.max(1, Math.ceil(scored.length / i.cap));
  const dots: Dot[] = [];
  for (const type of types) {
    const list = (bySector.get(type) ?? []).sort(
      (a, z) => z.score - a.score || a.p.id.localeCompare(z.p.id),
    );
    for (let at = 0; at < list.length; at += perDot) {
      const chunk = list.slice(at, at + perDot);
      const score = Math.round(chunk.reduce((n, c) => n + c.score, 0) / chunk.length);
      dots.push({
        pageId: chunk.length === 1 ? (chunk[0] as (typeof chunk)[0]).p.id : null,
        sector: type,
        r: radiusOf(score),
        score,
        k: chunk.length,
        inZone: score >= ZONE,
      });
    }
  }
  // The best single pages are named. A name is a page title the caller may read.
  const named = scored
    .filter((s) => perDot === 1 && s.score >= 40)
    .sort((a, z) => z.score - a.score || a.p.id.localeCompare(z.p.id))
    .slice(0, MAX_LABELS);
  const byId = new Map(dots.filter((d) => d.pageId).map((d) => [d.pageId as string, d]));
  for (const n of named) {
    const d = byId.get(n.p.id);
    if (d) {
      d.highlight = true;
      d.label = trim(n.p.title, 40);
    }
  }
  const inZone = dots.reduce((n, d) => n + (d.inZone ? d.k : 0), 0);
  return {
    mode: i.mode,
    q: i.q,
    seed: seedOf(`${i.brainId}|${i.mode}|${tokens.join(" ")}`),
    sectors: types.map((type) => ({
      id: type,
      label: i.labelOf(type),
      count: (bySector.get(type) ?? []).length,
    })),
    dots,
    rings: [...RINGS],
    legend: {
      inZone,
      below: scored.length - inZone,
      perDot,
      threshold: ZONE,
      total: scored.length,
    },
  };
}

// ---- health ----

function sourceOf(p: PageIn, raw: InsightRaw, readable: ReadonlySet<string>): SourceKind {
  const prov = raw.provenance[p.id];
  if (p.type === "session_report" || prov === "agents") return "agents";
  if (prov === "import") return "import";
  const kinds = citedIn(p.markdown)
    .filter((id) => readable.has(id))
    .map((id) => raw.sourceKinds[id]);
  if (kinds.includes("sharepoint")) return "sharepoint";
  if (kinds.includes("meetings")) return "meetings";
  return "manual";
}

export function buildHealth(i: {
  pages: PageIn[];
  raw: InsightRaw;
  readable: ReadonlySet<string>;
  now: number;
  freshnessDays: number;
  scoreKind: ScoreKind;
}): Insights["health"] {
  const rows = i.pages.map((p) => {
    const scores: Record<ScoreKind, number> = {
      freshness: freshnessScore(p, i.now, i.freshnessDays),
      confidence: confidenceScore(p, i.raw.facts),
      evidence: evidenceScore(p),
    };
    return { p, scores, source: sourceOf(p, i.raw, i.readable) };
  });
  const above = { freshness: 0, confidence: 0, evidence: 0 };
  const weekDelta = { freshness: 0, confidence: 0, evidence: 0 };
  for (const r of rows)
    for (const k of SCORE_KINDS)
      if (r.scores[k] >= THRESHOLD) {
        above[k]++;
        if (i.now - r.p.updatedAt <= 7 * DAY) weekDelta[k]++;
      }
  const sourceCounts = new Map<SourceKind, number>();
  for (const r of rows) sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  const sorted = [...rows].sort(
    (a, z) => a.scores[i.scoreKind] - z.scores[i.scoreKind] || a.p.id.localeCompare(z.p.id),
  );
  const perPoint = Math.max(1, Math.ceil(sorted.length / HEALTH_CAP));
  const points: HealthPoint[] = [];
  for (let at = 0; at < sorted.length; at += perPoint) {
    const chunk = sorted.slice(at, at + perPoint);
    const mean = (k: ScoreKind) =>
      Math.round(chunk.reduce((n, c) => n + c.scores[k], 0) / chunk.length);
    const scores = {
      freshness: mean("freshness"),
      confidence: mean("confidence"),
      evidence: mean("evidence"),
    };
    const first = chunk[0] as (typeof chunk)[0];
    points.push({
      pageId: chunk.length === 1 ? first.p.id : null,
      title: chunk.length === 1 ? trim(first.p.title, 60) : null,
      score: scores[i.scoreKind],
      scores,
      source: first.source,
      k: chunk.length,
    });
  }
  return {
    scoreKind: i.scoreKind,
    threshold: THRESHOLD,
    total: rows.length,
    perPoint,
    points,
    above,
    weekDelta,
    sources: [...sourceCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, z) => z.count - a.count || a.kind.localeCompare(z.kind)),
  };
}

// ---- flow ----

export function buildFlow(i: {
  raw: InsightRaw;
  readable: ReadonlySet<string>;
  window: WindowKey;
  promotes: boolean;
  now: number;
}): Insights["flow"] {
  const since = i.now - WINDOWS[i.window] * DAY;
  // A proposal counts only when every source its title can show is readable by this caller.
  const props = i.raw.proposals.filter(
    (p) => p.createdAt >= since && p.titleSources.every((s) => i.readable.has(s)),
  );
  const readableIngests = i.raw.ingested.filter(
    (x) => x.at >= since && i.readable.has(x.sourceId),
  ).length;
  const proposed = props.length;
  const ingested = Math.max(
    proposed,
    readableIngests + props.filter((p) => p.sources.length === 0).length,
  );
  const decided = props.filter((p) => p.status === "approved" || p.status === "rejected");
  const published = props.filter((p) => p.status === "approved").length;
  const stages: Insights["flow"]["stages"] = [
    { key: "ingested", count: ingested },
    { key: "proposed", count: proposed },
    { key: "reviewed", count: decided.length },
    { key: "published", count: published },
  ];
  if (i.promotes) stages.push({ key: "promoted", count: Math.min(published, i.raw.promotions) });
  const days = decided
    .filter((p) => p.reviewed)
    .map((p) => Math.max(0, p.decidedAt - p.createdAt) / DAY)
    .sort((a, z) => a - z);
  const mid = Math.floor(days.length / 2);
  const median = days.length
    ? round1(
        days.length % 2
          ? (days[mid] as number)
          : ((days[mid - 1] as number) + (days[mid] as number)) / 2,
      )
    : null;
  // The server refuses an approval until every change was seen (409 changes_not_seen), so each
  // approval that went through review had them all seen: the rate is read off the recorded reviews.
  const approvedByReview = props.filter((p) => p.status === "approved" && p.reviewed).length;
  return {
    window: i.window,
    stages,
    publishRate: proposed ? Math.round((published / proposed) * 100) : null,
    medianDaysToReview: median,
    seenAllRate: approvedByReview ? 100 : null,
  };
}

// ---- activity, timeline, focus ----

export function buildActivity(
  events: { pageId: string; at: number }[],
  pageIds: ReadonlySet<string> | null,
  now: number,
  days = ACTIVITY_DAYS,
): Insights["activity"] {
  const from = now - (days - 1) * DAY;
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.at < from - DAY || (pageIds && !pageIds.has(e.pageId))) continue;
    const d = isoDay(e.at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const lower = isoDay(from);
  return {
    from: lower,
    to: isoDay(now),
    days: [...counts.entries()]
      .filter(([d]) => d >= lower)
      .sort(([a], [z]) => a.localeCompare(z))
      .map(([date, count]) => ({ date, count })),
  };
}

const DATED_TYPES = new Set([
  "project",
  "opportunity",
  "bid",
  "offer",
  "interaction",
  "success_story",
  "decision",
]);

export function buildTimeline(pages: PageIn[], now: number): TimelineBar[] {
  const recent = pages.filter((p) => now - p.updatedAt <= 730 * DAY);
  const dated = recent.filter((p) => DATED_TYPES.has(p.type));
  return (dated.length ? dated : recent)
    .sort(
      (a, z) => z.updatedAt - z.createdAt - (a.updatedAt - a.createdAt) || a.id.localeCompare(z.id),
    )
    .slice(0, 6)
    .sort((a, z) => a.createdAt - z.createdAt || a.id.localeCompare(z.id))
    .map((p) => ({
      label: trim(p.title, 28),
      start: isoDay(p.createdAt),
      end: isoDay(p.updatedAt),
      kind: p.type,
    }));
}

export function accountStatus(
  pages: PageIn[],
  now: number,
): { value: "active" | "watch" | "dormant"; since: string | null } {
  if (!pages.length) return { value: "dormant", since: null };
  const last = Math.max(...pages.map((p) => p.updatedAt));
  const age = (now - last) / DAY;
  return { value: age <= 30 ? "active" : age <= 90 ? "watch" : "dormant", since: isoDay(last) };
}

export const COVERAGE_TARGET = 3;

export function brainCoverage(
  counts: ReadonlyMap<string, number>,
  expected: readonly { type: string; label: string }[],
): CoverageRow[] {
  return expected.map((e) => {
    const value = counts.get(e.type) ?? 0;
    return {
      key: e.type,
      label: e.label,
      value,
      target: COVERAGE_TARGET,
      unit: "pages" as const,
      state: value === 0 ? "missing" : value >= COVERAGE_TARGET ? "ok" : "low",
    };
  });
}

/** One row per section the page's type asks for: how many content lines the section holds. */
export function pageCoverage(markdown: string, required: readonly string[]): CoverageRow[] {
  const sections = new Map<string, number>();
  let cur = "";
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const h = /^#{2,4}\s+(.+)$/.exec(line);
    if (h) {
      cur = (h[1] as string).trim().toLowerCase();
      if (!sections.has(cur)) sections.set(cur, 0);
    } else if (line && cur && !line.startsWith("#"))
      sections.set(cur, (sections.get(cur) ?? 0) + 1);
  }
  return required.map((label) => {
    const value = sections.get(label.toLowerCase()) ?? 0;
    return {
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label,
      value,
      target: 2,
      unit: "lines" as const,
      state: value === 0 ? "missing" : value >= 2 ? "ok" : "low",
    };
  });
}

export function pageTimeline(
  events: { pageId: string; at: number }[],
  pageId: string,
  now: number,
): TimelineBar[] {
  const at = events
    .filter((e) => e.pageId === pageId)
    .map((e) => e.at)
    .sort((a, z) => a - z);
  return at.slice(-6).map((t, n, all) => ({
    label: `${isoDay(t)}`,
    start: isoDay(t),
    end: isoDay(all[n + 1] ?? now),
    kind: "revision",
  }));
}

/** The weekly edit counts of the last `weeks` weeks, oldest first (the Home sparkline). */
export function weekly(
  events: { pageId: string; at: number }[],
  pageIds: ReadonlySet<string>,
  now: number,
  weeks = 12,
): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const e of events) {
    if (!pageIds.has(e.pageId)) continue;
    const back = Math.floor((now - e.at) / (7 * DAY));
    if (back >= 0 && back < weeks) out[weeks - 1 - back] = (out[weeks - 1 - back] ?? 0) + 1;
  }
  return out;
}

export interface OverviewTile {
  id: string;
  type: string;
  name: string;
  template: TemplateId;
  pages: number;
  health: { score: number };
  zone: { inZone: number; total: number };
  seed: number;
  /** s = sector index, r = radius, z = in the zone, k = pages the dot stands for. */
  dots: { s: number; r: number; z: boolean; k: number }[];
  sectors: number;
  sparkline: number[];
  lastActivityAt: string | null;
}
