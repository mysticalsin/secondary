// Dev mock for the v5 Brain Insights endpoints (docs/API-CONTRACT.md "v5 Brain Insights"). Synthetic
// data only. It builds a page population per brain from a seeded generator and then follows the same
// rules as the API (scores, bucketing, highlights, flow), so the charts look as they would on a live
// brain. Counts here are larger than the brain pages' counts on purpose: the mock is for looking at
// the visuals. The real API is the only place access is ever decided.
import { rng } from "../insights/layout";
import type {
  Dot,
  HealthPoint,
  Insights,
  OverviewTile,
  ScoreKind,
  SourceKind,
  TimelineBar,
} from "../insights/types";
import { hash } from "./org";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-05T18:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Profile {
  total: number;
  sectors: { type: string; label: string; share: number; required: string[] }[];
  status?: "active" | "watch" | "dormant";
  timeline?: { label: string; from: string; to: string; kind: string }[];
  /** Named pages that must exist (the reference highlights). */
  anchors?: string[];
}

const S = (type: string, label: string, share: number, required = ["Summary", "Steps"]) => ({
  type,
  label,
  share,
  required,
});

const PROFILES: Record<string, Profile> = {
  c_bid: {
    total: 1240,
    sectors: [
      S("offer", "Offers", 0.27),
      S("method", "Methods", 0.25),
      S("success_story", "Success stories", 0.2, ["Summary", "Results"]),
      S("opportunity", "Opportunities", 0.16, ["Summary", "Stage"]),
      S("bid", "Bids", 0.12, ["Summary", "Deadline"]),
    ],
    anchors: ["Bid playbook", "Pricing method", "Win themes library", "Go/no-go checklist"],
    timeline: [
      { label: "Public sector response", from: "2023-03-01", to: "2024-02-20", kind: "bid" },
      { label: "Pricing model v2", from: "2024-05-10", to: "2025-04-02", kind: "method" },
      { label: "Frame agreement bid", from: "2025-06-01", to: "2026-10-28", kind: "bid" },
    ],
  },
  a_acme: {
    total: 186,
    status: "watch",
    sectors: [
      S("project", "Projects", 0.28),
      S("opportunity", "Opportunities", 0.16, ["Summary", "Stage"]),
      S("interaction", "Interactions", 0.3, ["Summary", "Next step"]),
      S("stakeholders", "Stakeholder roles", 0.1, ["Roles"]),
      S("commitment", "Commitments", 0.16, ["Summary", "Due"]),
    ],
    anchors: ["Cloud migration programme", "Data platform renewal", "Quarterly business review"],
    timeline: [
      { label: "Cloud migration", from: "2021-02-01", to: "2023-06-30", kind: "project" },
      { label: "Data platform", from: "2022-09-01", to: "2025-03-15", kind: "project" },
      { label: "Frame renewal", from: "2025-01-10", to: "2026-10-30", kind: "opportunity" },
    ],
  },
  c_delivery: {
    total: 420,
    sectors: [
      S("method", "Methods", 0.3),
      S("project", "Projects", 0.25),
      S("playbook", "Playbooks", 0.25),
      S("lesson", "Lessons", 0.2, ["Summary"]),
    ],
    anchors: ["Delivery gate review", "Handover checklist", "Risk escalation path"],
    timeline: [
      { label: "Gate model rollout", from: "2024-01-15", to: "2024-11-30", kind: "project" },
      { label: "Quality baseline", from: "2025-03-01", to: "2026-09-14", kind: "project" },
    ],
  },
  c_sales: {
    total: 1500,
    sectors: [
      S("account", "Accounts", 0.35, ["Summary"]),
      S("offer", "Offers", 0.25),
      S("playbook", "Playbooks", 0.22),
      S("success_story", "Win stories", 0.18, ["Summary", "Results"]),
    ],
    anchors: ["Qualification checklist", "Renewal playbook", "Pricing guardrails"],
  },
  core: {
    total: 2300,
    sectors: [
      S("method", "Methods", 0.3),
      S("offer", "Offers", 0.22),
      S("expertise", "Expertise", 0.25, ["Summary"]),
      S("project", "Projects", 0.15),
      S("glossary", "Glossary", 0.08, ["Terms"]),
    ],
    anchors: ["Company method for estimating", "Reference architecture", "Security baseline"],
  },
  me: {
    total: 64,
    sectors: [
      S("note", "Notes", 0.55, ["Summary"]),
      S("interaction", "Interactions", 0.3, ["Summary"]),
      S("topic", "Topics", 0.15, ["Summary"]),
    ],
    anchors: ["My week with Acme", "Workshop notes", "Reading list"],
  },
};

const FALLBACK = (
  id: string,
  collections: { type: string; label: string; count: number }[],
): Profile => ({
  total: 160,
  sectors: (collections.length ? collections : [{ type: "topic", label: "Topics", count: 1 }]).map(
    (c) => S(c.type, c.label, 1 / Math.max(1, collections.length)),
  ),
  anchors: [`${id} overview`],
});

const WORDS_A = [
  "Pricing",
  "Win themes",
  "Staffing",
  "Reference",
  "Solution",
  "Discovery",
  "Governance",
  "Risk",
  "Handover",
  "Quality",
  "Estimation",
  "Security",
  "Delivery",
  "Client",
  "Resourcing",
  "Compliance",
  "Pipeline",
  "Onboarding",
  "Renewal",
  "Architecture",
  "Sustainability",
  "Partner",
  "Workshop",
  "Reporting",
];
const WORDS_B = [
  "method",
  "playbook",
  "checklist",
  "template",
  "brief",
  "review",
  "case",
  "guide",
  "baseline",
  "framework",
  "log",
  "model",
  "canvas",
  "register",
];
const SEGMENTS = ["public sector", "banking", "retail", "energy", "health", "insurance", "telecom"];

interface P {
  id: string;
  type: string;
  title: string;
  summary: string;
  age: number;
  u: number;
  conf: number;
  evid: number;
  source: SourceKind;
}

const normal = (r: () => number, mean: number, sd: number) => {
  const u = Math.max(1e-9, r());
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function population(id: string, p: Profile, total: number): P[] {
  const r = rng(hash(`pop:${id}`));
  const out: P[] = [];
  let n = 0;
  for (const sec of p.sectors) {
    const count = Math.max(1, Math.round(total * sec.share));
    for (let i = 0; i < count; i++, n++) {
      const anchor =
        i < (p.anchors?.length ?? 0) && sec === p.sectors[0] ? p.anchors?.[i] : undefined;
      const a = WORDS_A[Math.floor(r() * WORDS_A.length)] as string;
      const b = WORDS_B[Math.floor(r() * WORDS_B.length)] as string;
      const seg = SEGMENTS[Math.floor(r() * SEGMENTS.length)] as string;
      const title = anchor ?? `${a} ${b} for ${seg}`;
      const pick = r();
      const source: SourceKind =
        pick < 0.46
          ? "sharepoint"
          : pick < 0.68
            ? "meetings"
            : pick < 0.85
              ? "agents"
              : pick < 0.95
                ? "manual"
                : "import";
      out.push({
        id: `${sec.type}-${n}`,
        type: sec.type,
        title,
        summary: `${a} ${b} ${seg} ${sec.label}`.toLowerCase(),
        age: 0,
        u: r(),
        conf: Math.round(clamp(normal(r, 71, 17))),
        evid: Math.round(clamp(normal(r, 63, 21))),
        source,
      });
      const last = out[out.length - 1] as P;
      // Freshness is a bell around 70, as the reference's score field is; age follows from it.
      last.age = Math.round((1 - clamp(normal(r, 70, 17)) / 100) * 180 * 1.5);
    }
  }
  return out;
}

const tokensOf = (q: string) =>
  (
    q
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((x) => x.length <= 40)
    .slice(0, 8);

const radiusOf = (s: number) => Math.round(Math.sqrt(clamp((100 - s) / 60, 0, 1)) * 1000) / 1000;
const trim = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function score(pg: P, mode: "relevance" | "freshness", tokens: string[], fd: number) {
  if (mode === "freshness") return Math.round(clamp(100 * (1 - pg.age / (fd * 1.5))));
  if (!tokens.length) return Math.round(40 + 60 * pg.u ** 2.6);
  const t = pg.title.toLowerCase();
  const s = pg.summary;
  let hits = 0;
  for (const k of tokens) hits += (t.includes(k) ? 5 : 0) + (s.includes(k) ? 3 : 0);
  // The mock blends a page's hidden affinity with where the words hit, so the map has a full spread.
  const hitFrac = hits / (10 * tokens.length);
  return Math.round(clamp(36 + 64 * Math.min(0.96, pg.u ** 1.2 + 0.5 * hitFrac)));
}

interface BrainIn {
  id: string;
  name: string;
  type: string;
  template: string;
  collections: { type: string; label: string; count: number }[];
}

function dense(): number {
  try {
    return Number(window.localStorage.getItem("secondary.mock.dots") ?? 0) || 0;
  } catch {
    return 0;
  }
}

function profileOf(b: BrainIn): Profile {
  return PROFILES[b.id] ?? FALLBACK(b.id, b.collections);
}

interface Build {
  prof: Profile;
  pages: P[];
  cap: number;
}

function build(b: BrainIn, cap: number): Build {
  const prof = profileOf(b);
  const d = dense();
  const total = d > 0 && b.id === "c_bid" ? d : prof.total;
  return { prof, pages: population(b.id, prof, total), cap: d > 0 && b.id === "c_bid" ? d : cap };
}

function constellation(b: BrainIn, bd: Build, mode: "relevance" | "freshness", q: string) {
  const tokens = tokensOf(q);
  const fd = 180;
  const scored = bd.pages.map((p) => ({ p, s: score(p, mode, tokens, fd) }));
  const types = bd.prof.sectors
    .map((s) => s.type)
    .sort((a, z) =>
      (bd.prof.sectors.find((x) => x.type === a)?.label ?? "").localeCompare(
        bd.prof.sectors.find((x) => x.type === z)?.label ?? "",
      ),
    );
  const per = Math.max(1, Math.ceil(scored.length / bd.cap));
  const best = new Map<string, (typeof scored)[0][]>();
  for (const x of scored
    .filter((y) => y.s >= 60)
    .sort((a, z) => z.s - a.s || a.p.id.localeCompare(z.p.id)))
    best.set(x.p.type, [...(best.get(x.p.type) ?? []), x]);
  const lists = [...best.values()].sort((a, z) => (z[0]?.s ?? 0) - (a[0]?.s ?? 0));
  const named: (typeof scored)[0][] = [];
  for (let rank = 0; named.length < 5 && lists.some((l) => l[rank]); rank++)
    for (const l of lists) {
      const x = l[rank];
      if (x && named.length < 5) named.push(x);
    }
  const namedIds = new Set(named.map((n) => n.p.id));
  const single = (x: (typeof scored)[0]): Dot => ({
    pageId: x.p.id,
    sector: x.p.type,
    r: radiusOf(x.s),
    score: x.s,
    k: 1,
    inZone: x.s >= 85,
    title: trim(x.p.title, 60),
  });
  const dots: Dot[] = [];
  for (const type of types) {
    const list = scored
      .filter((x) => x.p.type === type && !namedIds.has(x.p.id))
      .sort((a, z) => z.s - a.s || a.p.id.localeCompare(z.p.id));
    for (let at = 0; at < list.length; at += per) {
      const chunk = list.slice(at, at + per);
      if (chunk.length === 1) {
        dots.push(single(chunk[0] as (typeof chunk)[0]));
        continue;
      }
      const sc = Math.round(chunk.reduce((n, c) => n + c.s, 0) / chunk.length);
      dots.push({
        pageId: null,
        sector: type,
        r: radiusOf(sc),
        score: sc,
        k: chunk.length,
        inZone: sc >= 85,
      });
    }
    for (const n of named.filter((x) => x.p.type === type))
      dots.push({ ...single(n), highlight: true, label: trim(n.p.title, 40) });
  }
  const inZone = dots.reduce((n, d) => n + (d.inZone ? d.k : 0), 0);
  return {
    mode,
    q,
    seed: hash(`${b.id}|${mode}|${tokens.join(" ")}`),
    terms: tokens.map((term) => ({
      term,
      hits: bd.pages.filter((p) => `${p.title} ${p.summary}`.toLowerCase().includes(term)).length,
    })),
    sectors: types.map((id) => ({
      id,
      label: bd.prof.sectors.find((s) => s.type === id)?.label ?? id,
      count: scored.filter((x) => x.p.type === id).length,
    })),
    dots,
    rings: [50, 70, 85],
    legend: {
      inZone,
      below: scored.length - inZone,
      perDot: per,
      threshold: 85,
      total: scored.length,
    },
  };
}

function activityOf(seed: string, scale: number, from = 182) {
  const r = rng(hash(`act:${seed}`));
  const days: { date: string; count: number }[] = [];
  let burst = 0;
  for (let i = from - 1; i >= 0; i--) {
    const t = NOW - i * DAY;
    const wd = new Date(t).getUTCDay();
    const weekend = wd === 0 || wd === 6;
    if (r() < 0.07) burst = 3 + Math.floor(r() * 4);
    const base = weekend ? (r() < 0.12 ? 1 : 0) : r() < 0.62 ? Math.ceil(r() * 3 * scale) : 0;
    const count = base + (burst > 0 && !weekend ? Math.ceil(r() * 4 * scale) : 0);
    if (burst > 0) burst--;
    if (count > 0) days.push({ date: iso(t), count });
  }
  return { from: iso(NOW - (from - 1) * DAY), to: iso(NOW), days };
}

function timelineOf(b: BrainIn, prof: Profile): TimelineBar[] {
  if (prof.timeline)
    return prof.timeline.map((t) => ({ label: t.label, start: t.from, end: t.to, kind: t.kind }));
  const r = rng(hash(`tl:${b.id}`));
  return Array.from({ length: 3 }, (_, n) => {
    const start = NOW - (500 - n * 140 - Math.floor(r() * 60)) * DAY;
    return {
      label: `${WORDS_A[Math.floor(r() * WORDS_A.length)]} ${WORDS_B[Math.floor(r() * WORDS_B.length)]}`,
      start: iso(start),
      end: iso(start + (200 + Math.floor(r() * 220)) * DAY),
      kind: "project",
    };
  });
}

function health(b: BrainIn, bd: Build, kind: ScoreKind) {
  const fd = 180;
  const rows = bd.pages.map((p) => ({
    p,
    scores: {
      freshness: Math.round(clamp(100 * (1 - p.age / (fd * 1.5)))),
      confidence: p.conf,
      evidence: p.evid,
    } as Record<ScoreKind, number>,
  }));
  const above = { freshness: 0, confidence: 0, evidence: 0 };
  const week = { freshness: 0, confidence: 0, evidence: 0 };
  for (const r of rows)
    for (const k of ["freshness", "confidence", "evidence"] as const)
      if (r.scores[k] >= 60) {
        above[k]++;
        if (r.p.age <= 7) week[k]++;
      }
  const sorted = [...rows].sort(
    (a, z) => a.scores[kind] - z.scores[kind] || a.p.id.localeCompare(z.p.id),
  );
  const per = Math.max(1, Math.ceil(sorted.length / 1200));
  const points: HealthPoint[] = [];
  for (let at = 0; at < sorted.length; at += per) {
    const chunk = sorted.slice(at, at + per);
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
      score: scores[kind],
      scores,
      source: first.p.source,
      k: chunk.length,
    });
  }
  const counts = new Map<SourceKind, number>();
  for (const p of bd.pages) counts.set(p.source, (counts.get(p.source) ?? 0) + 1);
  return {
    scoreKind: kind,
    threshold: 60,
    total: rows.length,
    perPoint: per,
    points,
    above,
    weekDelta: week,
    sources: [...counts.entries()]
      .map(([k, count]) => ({ kind: k, count }))
      .sort((a, z) => z.count - a.count),
  };
}

function flow(b: BrainIn, bd: Build) {
  const n = Math.max(6, Math.round(bd.pages.length / 10));
  const proposed = n;
  const ingested = Math.round(n * 1.25);
  const reviewed = Math.round(n * 0.78);
  const published = Math.round(n * 0.64);
  const stages: {
    key: "ingested" | "proposed" | "reviewed" | "published" | "promoted";
    count: number;
  }[] = [
    { key: "ingested", count: ingested },
    { key: "proposed", count: proposed },
    { key: "reviewed", count: reviewed },
    { key: "published", count: published },
  ];
  if (b.type === "team" || b.type === "account")
    stages.push({ key: "promoted", count: Math.max(1, Math.round(published * 0.24)) });
  return {
    window: "30d",
    stages,
    publishRate: Math.round((published / proposed) * 100),
    medianDaysToReview: 1.8,
    seenAllRate: 100,
  };
}

export function insightsOf(b: BrainIn, search: URLSearchParams): Insights {
  const mode = search.get("mode") === "freshness" ? "freshness" : "relevance";
  const kind =
    (["freshness", "confidence", "evidence"] as const).find((k) => k === search.get("scoreKind")) ??
    "freshness";
  const q = (search.get("q") ?? "").trim().slice(0, 120);
  const bd = build(b, 640);
  const focusId = search.get("focus");
  const con = constellation(b, bd, mode, q);
  const timeline = timelineOf(b, bd.prof);
  const scale = Math.max(0.5, Math.min(2.2, bd.pages.length / 400));
  const activity = activityOf(b.id, scale);
  let focus: Insights["focus"];
  const page = focusId ? bd.pages.find((p) => p.id === focusId) : undefined;
  if (focusId && !page) {
    const e = new Error("Not found.");
    (e as Error & { status: number }).status = 404;
    throw e;
  }
  if (page) {
    const sec = bd.prof.sectors.find((s) => s.type === page.type);
    const r = rng(hash(`pf:${page.id}`));
    focus = {
      kind: "page",
      pageId: page.id,
      title: page.title,
      type: page.type,
      coverage: (sec?.required ?? ["Summary"]).map((label, i) => {
        const value = i === 0 ? 3 + Math.floor(r() * 4) : Math.floor(r() * 4);
        return {
          key: label.toLowerCase(),
          label,
          value,
          target: 2,
          unit: "lines" as const,
          state:
            value === 0 ? ("missing" as const) : value >= 2 ? ("ok" as const) : ("low" as const),
        };
      }),
      timeline: [0, 1, 2].map((n) => ({
        label: iso(NOW - (page.age + 60 - n * 25) * DAY),
        start: iso(NOW - (page.age + 60 - n * 25) * DAY),
        end: iso(NOW - (page.age + 35 - n * 25) * DAY),
        kind: "revision",
      })),
      activity: activityOf(page.id, 0.35),
      status: null,
    };
  } else {
    const counts = bd.prof.sectors.map((s) => ({
      s,
      n: bd.pages.filter((p) => p.type === s.type).length,
    }));
    focus = {
      kind: "brain",
      pageId: null,
      title: b.name,
      type: b.type,
      coverage: counts.map(({ s, n }, i) => {
        const value =
          b.type === "account"
            ? ([6, 2, 9, 1, 0][i % 5] ?? n)
            : i === counts.length - 1
              ? 2
              : Math.min(14, Math.round(n / 25));
        return {
          key: s.type,
          label: s.label,
          value,
          target: 3,
          unit: "pages" as const,
          state:
            value === 0 ? ("missing" as const) : value >= 3 ? ("ok" as const) : ("low" as const),
        };
      }),
      timeline,
      activity,
      status:
        b.type === "account" ? { value: bd.prof.status ?? "active", since: "2026-10-14" } : null,
    };
  }
  return {
    brainId: b.id,
    name: b.name,
    generatedAt: new Date(NOW).toISOString(),
    window: "30d",
    constellation: con,
    focus,
    health: health(b, bd, kind),
    flow: flow(b, bd),
    activity,
    timeline,
  };
}

export function overviewOf(brains: BrainIn[]): { generatedAt: string; brains: OverviewTile[] } {
  const tiles = brains.map((b): OverviewTile => {
    const bd = build(b, 140);
    const con = constellation(b, bd, "freshness", "");
    const index = new Map(con.sectors.map((s, n) => [s.id, n]));
    const r = rng(hash(`sp:${b.id}`));
    return {
      id: b.id,
      type: b.type,
      name: b.name,
      template: b.template,
      pages: bd.pages.length,
      health: { score: 58 + Math.floor(r() * 36) },
      zone: { inZone: con.legend.inZone, total: con.legend.total },
      seed: con.seed,
      dots: con.dots.map((d) => ({ s: index.get(d.sector) ?? 0, r: d.r, z: d.inZone, k: d.k })),
      sectors: con.sectors.length,
      sparkline: Array.from({ length: 12 }, (_, i) => Math.round(2 + r() * 10 + i * 0.5)),
      lastActivityAt: new Date(NOW - Math.floor(r() * 4) * DAY).toISOString(),
    };
  });
  return { generatedAt: new Date(NOW).toISOString(), brains: tiles };
}
