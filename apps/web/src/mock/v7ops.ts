// Dev mock for the v7 Operate endpoints (docs/API-CONTRACT.md "v7 Operate"). Synthetic data only, every
// answer says `synthetic: true`. Deterministic: the clock is fixed at OPS_NOW, so the story is the same
// on every load: a client-name rule blocks agent proposals into Bid & Pre-sales since 10:51, and a
// SharePoint source times out and retries. State (retry requests, source config, rotation) lives in
// memory for the page load. Ids, counts and timings only: nothing here can carry page content.
import { ApiError } from "../api";
import { rng } from "../insights/layout";
import { retryPlan } from "../ops/retry";
import type {
  ActivityBucket,
  ActivityResponse,
  ActivityTotals,
  ActivityWindow,
  Attempt,
  CallOutcome,
  Callout,
  EventDetail,
  EventStep,
  FailureReason,
  HealthResponse,
  HealthWindow,
  HeatCell,
  HeatRow,
  OpEvent,
  OpsStatus,
  RetryPolicy,
  SourceConfig,
  SourceList,
  SourceRow,
  SourceStats,
} from "../ops/types";
import { FAILURE_REASONS } from "../ops/types";
import { NOT_HANDLED } from "./uxv2";

/** The fixed clock of the mock: the end of the story in the reference (11:05). */
export const OPS_NOW = Date.parse("2026-11-06T11:05:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const MAX_DOTS = 14;
const iso = (t: number) => new Date(t).toISOString();

const WINDOWS: Record<ActivityWindow, { ms: number; bucketMs: number }> = {
  "60m": { ms: HOUR, bucketMs: MIN },
  "24h": { ms: 24 * HOUR, bucketMs: 30 * MIN },
  "7d": { ms: 168 * HOUR, bucketMs: 2 * HOUR },
};
const HEALTH: Record<HealthWindow, { ms: number; columnMs: number }> = {
  "1h": { ms: HOUR, columnMs: 5 * MIN },
  "24h": { ms: 24 * HOUR, columnMs: HOUR },
  "7d": { ms: 168 * HOUR, columnMs: 6 * HOUR },
};

/** Roles that manage each mock brain (mirrors mock/v3.ts). */
const MANAGERS: Record<string, string[]> = {
  me: ["ceo", "head_bid", "acme_lead", "consultant", "reviewer", "platform_admin", "auditor"],
  core: ["platform_admin"],
  c_bid: ["head_bid"],
  c_delivery: [],
  a_acme: ["acme_lead"],
  c_sales: ["ceo"],
};
const BRAIN_LABEL: Record<string, string> = {
  c_bid: "Bid & Pre-sales",
  core: "Company Brain",
  c_sales: "Sales circle",
  c_delivery: "Delivery practice",
  a_acme: "Account Acme",
};

const strHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const hex = (r: () => number, n: number): string =>
  Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
const pickW = <T>(r: () => number, items: readonly (readonly [T, number])[]): T => {
  const total = items.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return (items[items.length - 1] as readonly [T, number])[0];
};

// ---- events ----

interface Ev extends OpEvent {
  t: number;
  brain: string;
  sourceId: string | null;
}

const AGENTS = [
  ["Claude", 38],
  ["ChatGPT", 22],
  ["Dust", 16],
  ["Codex", 14],
  ["Copilot", 10],
] as const;
const HOST_ID: Record<string, string> = {
  Claude: "claude_code",
  ChatGPT: "chatgpt",
  Dust: "dust",
  Codex: "codex",
  Copilot: "copilot_studio",
};
const CONNECTORS = [
  "Bid library (SharePoint)",
  "Delivery drive (SharePoint)",
  "Proposals (OneDrive)",
];
const RULE = "client-name@3";
const RETRY_ID = "evt_7a31c0d29b4e8f56";
const RECOVERED_ID = "evt_7a31c0d29b4e8f02";
const FEATURED_AT = Date.parse("2026-11-06T11:03:58.000Z");
const RUN_START = Date.parse("2026-11-06T10:51:07.000Z");

const SOURCE_IDS: Record<string, string> = {
  "Bid library (SharePoint)": "src_bidlib01",
  "Delivery drive (SharePoint)": "src_delivdr2",
  "Proposals (OneDrive)": "src_proposal3",
};

function make(
  r: () => number,
  brain: string,
  t: number,
  o: Partial<Ev> & Pick<Ev, "type" | "source" | "status">,
): Ev {
  const failingKind = o.status === "failed" || o.status === "retrying";
  const outcomes: Attempt[] = o.attempts?.outcomes ?? ["ok"];
  const retryable =
    failingKind && ["connector.sync", "ingest.run", "classifier.ask"].includes(o.type);
  return {
    id: o.id ?? `evt_${hex(r, 16)}`,
    type: o.type,
    source: o.source,
    status: o.status,
    attempts: o.attempts ?? { count: 1, max: 1, outcomes },
    latencyMs: o.latencyMs === undefined ? Math.round(120 + r() ** 2 * 900) : o.latencyMs,
    at: iso(t),
    reason: o.reason ?? null,
    ruleRef: o.ruleRef ?? null,
    retryable: o.retryable ?? retryable,
    t,
    brain,
    sourceId:
      o.sourceId ?? (o.source.kind === "connector" ? (SOURCE_IDS[o.source.label] ?? null) : null),
  };
}

/** One event of ordinary life at time t. `run` is true inside the failure run of Bid & Pre-sales. */
function ordinary(r: () => number, brain: string, t: number, run: boolean): Ev {
  const kind = pickW(r, [
    ["agent", 58],
    ["human", 8],
    ["connector", 12],
    ["ingest", 14],
    ["classifier", 8],
  ] as const);
  if (kind === "agent") {
    const label = pickW(r, AGENTS);
    const type = pickW(r, [
      ["wiki.propose_page", 70],
      ["wiki.propose_change", 20],
      ["session.write_report", 10],
    ] as const);
    const source = { kind: "agent" as const, label };
    if (run && type === "wiki.propose_page" && r() < 0.42)
      return make(r, brain, t, {
        type,
        source,
        status: "blocked",
        reason: "blocked_by_rule",
        ruleRef: RULE,
        attempts: { count: 1, max: 1, outcomes: ["fail"] },
        latencyMs: Math.round(40 + r() * 90),
      });
    const x = r();
    if (x < 0.06) return make(r, brain, t, { type, source, status: "needs_review" });
    if (x < 0.075)
      return make(r, brain, t, {
        type,
        source,
        status: "blocked",
        reason: "permission_denied",
        attempts: { count: 1, max: 1, outcomes: ["fail"] },
        latencyMs: Math.round(30 + r() * 60),
      });
    return make(r, brain, t, { type, source, status: "published" });
  }
  if (kind === "human")
    return make(r, brain, t, {
      type: "wiki.publish",
      source: { kind: "human", label: "Person" },
      status: r() < 0.9 ? "published" : "needs_review",
    });
  const type =
    kind === "connector" ? "connector.sync" : kind === "ingest" ? "ingest.run" : "classifier.ask";
  const source =
    kind === "connector"
      ? {
          kind: "connector" as const,
          label: CONNECTORS[Math.floor(r() * CONNECTORS.length)] as string,
        }
      : { kind: "system" as const, label: kind === "ingest" ? "Ingest" : "Classifier" };
  const slow = Math.round(300 + r() ** 2 * 1800);
  if (run && r() < 0.34) {
    const fails = 1 + Math.floor(r() * 2);
    const reason: FailureReason = r() < 0.5 ? "timeout" : "graph_429";
    return make(r, brain, t, {
      type,
      source,
      status: "retrying",
      reason,
      attempts: {
        count: fails + 1,
        max: 8,
        outcomes: [...Array(fails).fill("fail"), "scheduled"] as Attempt[],
      },
      latencyMs: reason === "timeout" ? 15_000 : Math.round(900 + r() * 1500),
    });
  }
  const x = r();
  if (x < 0.04)
    return make(r, brain, t, {
      type,
      source,
      status: "published",
      attempts: { count: 2, max: 8, outcomes: ["fail", "ok"] },
      latencyMs: slow,
    });
  if (x < 0.055)
    return make(r, brain, t, {
      type,
      source,
      status: "failed",
      reason: pickW(r, [
        ["parse_error", 5],
        ["classifier_asked", 3],
        ["timeout", 2],
      ] as const),
      attempts: { count: 3, max: 3, outcomes: ["fail", "fail", "fail"] },
      latencyMs: slow,
    });
  return make(r, brain, t, { type, source, status: "published", latencyMs: slow });
}

const STREAMS = new Map<string, Ev[]>();

function streamOf(brain: string): Ev[] {
  const hit = STREAMS.get(brain);
  if (hit) return hit;
  const r = rng(strHash(`brain:${brain}`));
  const heavy = brain === "c_bid";
  const out: Ev[] = [];
  // Last hour: a ramp towards the end, about 900 events for Bid & Pre-sales.
  for (let m = 0; m < 60; m++) {
    const rate = heavy ? 9 + 14 * (m / 60) ** 1.6 : 1.4 + 1.1 * r();
    const n = Math.round(rate * (0.85 + 0.3 * r()));
    for (let k = 0; k < n; k++) {
      const t = OPS_NOW - (60 - m) * MIN + Math.floor(r() * MIN);
      // The two events of the reference are the newest ones.
      if (heavy && t > FEATURED_AT) continue;
      out.push(ordinary(r, brain, t, heavy && t >= RUN_START));
    }
  }
  // The other 167 hours: lighter, with a daytime hump.
  for (let h = 1; h < 168; h++) {
    const start = OPS_NOW - HOUR - h * HOUR;
    const hourOfDay = new Date(start).getUTCHours();
    const hump = 0.35 + Math.exp(-(((hourOfDay - 14) / 4.5) ** 2));
    const n = Math.round((heavy ? 26 : 3) * hump * (0.8 + 0.4 * r()));
    for (let k = 0; k < n; k++) out.push(ordinary(r, brain, start + Math.floor(r() * HOUR), false));
  }
  if (heavy) {
    // The first blocked event of the run, and the two rows the reference shows.
    out.push(
      make(r, brain, RUN_START, {
        type: "wiki.propose_page",
        source: { kind: "agent", label: "Claude" },
        status: "blocked",
        reason: "blocked_by_rule",
        ruleRef: RULE,
        attempts: { count: 1, max: 1, outcomes: ["fail"] },
        latencyMs: 62,
      }),
      make(r, brain, Date.parse("2026-11-06T11:04:09.000Z"), {
        id: RETRY_ID,
        type: "connector.sync",
        source: { kind: "connector", label: CONNECTORS[0] as string },
        status: "retrying",
        reason: "timeout",
        attempts: { count: 3, max: 8, outcomes: ["fail", "fail", "scheduled"] },
        latencyMs: 15_000,
        retryable: true,
      }),
      make(r, brain, Date.parse("2026-11-06T11:03:58.000Z"), {
        id: RECOVERED_ID,
        type: "ingest.run",
        source: { kind: "system", label: "Ingest" },
        status: "published",
        attempts: { count: 3, max: 8, outcomes: ["fail", "fail", "ok"] },
        latencyMs: 640,
      }),
    );
    // Nothing healthy-looking may share the rule after the run began except what the run produced.
  }
  out.sort((a, b) => b.t - a.t);
  STREAMS.set(brain, out);
  return out;
}

const AGENT_HOSTS = [
  ["claude_code", "Claude Code"],
  ["codex", "Codex"],
  ["dust", "Dust"],
  ["copilot_studio", "Copilot Studio"],
  ["claude_ai", "Claude"],
  ["chatgpt", "ChatGPT"],
] as const;

function agentStream(): Ev[] {
  const hit = STREAMS.get("@agent");
  if (hit) return hit;
  const r = rng(strHash("agent:me"));
  const out: Ev[] = [];
  const total = 340;
  for (let i = 0; i < total; i++) {
    // Denser near the end, so the last hour has about 40 calls.
    const back = i < 40 ? r() * HOUR : HOUR + r() ** 0.8 * (167 * HOUR);
    const t = OPS_NOW - 1 - Math.floor(back);
    const host = pickW(r, [
      ["claude_code", 40],
      ["codex", 18],
      ["dust", 14],
      ["copilot_studio", 6],
      ["claude_ai", 14],
      ["chatgpt", 8],
    ] as const);
    const label = (AGENT_HOSTS.find((h) => h[0] === host) as (typeof AGENT_HOSTS)[number])[1];
    const type = pickW(r, [
      ["wiki.search", 40],
      ["wiki.read_page", 24],
      ["wiki.propose_page", 22],
      ["wiki.propose_change", 8],
      ["session.write_report", 6],
    ] as const);
    const source = { kind: "agent" as const, label };
    const x = r();
    const base = { type, source, retryable: false };
    if (type === "wiki.propose_page" && x < 0.2)
      out.push(make(r, "me", t, { ...base, status: "needs_review" }));
    else if (x > 0.96)
      out.push(
        make(r, "me", t, {
          ...base,
          status: "blocked",
          reason: "permission_denied",
          attempts: { count: 1, max: 1, outcomes: ["fail"] },
          latencyMs: 41,
        }),
      );
    else
      out.push(
        make(r, "me", t, {
          ...base,
          status: "published",
          latencyMs: Math.round(60 + r() ** 2 * 700),
        }),
      );
  }
  out.sort((a, b) => b.t - a.t);
  STREAMS.set("@agent", out);
  return out;
}

const hostOf = (e: Ev): string => HOST_ID[e.source.label] ?? "";
const AGENT_HOST_BY_LABEL = new Map<string, string>(AGENT_HOSTS.map((h) => [h[1], h[0]]));
const agentHostOf = (e: Ev): string => AGENT_HOST_BY_LABEL.get(e.source.label) ?? hostOf(e);

function bucketsOf(evs: Ev[], win: ActivityWindow): { buckets: ActivityBucket[]; perDot: number } {
  const { ms, bucketMs } = WINDOWS[win];
  const n = ms / bucketMs;
  const end = Math.ceil(OPS_NOW / bucketMs) * bucketMs;
  const start = end - n * bucketMs;
  const buckets: ActivityBucket[] = Array.from({ length: n }, (_, i) => ({
    start: iso(start + i * bucketMs),
    end: iso(start + (i + 1) * bucketMs),
    total: 0,
    counts: { published: 0, needs_review: 0, blocked: 0, failed: 0, retrying: 0 },
  }));
  for (const e of evs) {
    if (e.t < start || e.t >= end) continue;
    const b = buckets[Math.floor((e.t - start) / bucketMs)] as ActivityBucket;
    b.total++;
    b.counts[e.status]++;
  }
  const peak = Math.max(0, ...buckets.map((b) => b.total));
  return { buckets, perDot: Math.max(1, Math.ceil(peak / MAX_DOTS)) };
}

/** The current run of blocked or failed events that name the same rule (or type), newest first. */
function calloutOf(evs: Ev[]): Callout | null {
  const failing = evs.filter((e) => e.status === "blocked" || e.status === "failed");
  const first = failing[0];
  if (!first) return null;
  const same = (e: Ev) =>
    first.ruleRef !== null ? e.ruleRef === first.ruleRef : e.type === first.type;
  const run: Ev[] = [];
  let last = first.t;
  for (const e of failing) {
    if (!same(e)) continue;
    if (last - e.t > 20 * MIN) break;
    run.push(e);
    last = e.t;
  }
  const since = run.reduce((m, e) => Math.min(m, e.t), first.t);
  return {
    since: iso(since),
    kind: first.status === "blocked" ? "blocked" : "failed",
    label: first.ruleRef ?? first.reason ?? first.type,
    count: run.length,
  };
}

const publicEvent = (e: Ev): OpEvent => ({
  id: e.id,
  type: e.type,
  source: e.source,
  status: e.status,
  attempts: e.attempts,
  latencyMs: e.latencyMs,
  at: e.at,
  reason: e.reason,
  ruleRef: e.ruleRef,
  retryable: e.retryable,
});

const STATUS_FILTERS = ["all", "needs_review", "blocked", "failed"] as const;

function activityOf(
  evs: Ev[],
  params: URLSearchParams,
  extra: Partial<ActivityResponse>,
): ActivityResponse {
  const win = (params.get("window") ?? "60m") as ActivityWindow;
  if (!(win in WINDOWS))
    throw new ApiError(400, "Window must be 60m, 24h or 7d.", { error: "bad_window" });
  const status = params.get("status") ?? "all";
  if (!(STATUS_FILTERS as readonly string[]).includes(status))
    throw new ApiError(400, "Status must be all, needs_review, blocked or failed.", {
      error: "bad_status",
    });
  const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const fromMs = params.get("from") ? Date.parse(params.get("from") as string) : null;
  const toMs = params.get("to") ? Date.parse(params.get("to") as string) : null;
  const { ms } = WINDOWS[win];
  const inWin = evs.filter((e) => e.t >= OPS_NOW - ms && e.t <= OPS_NOW);
  const { buckets, perDot } = bucketsOf(inWin, win);
  const totals: ActivityTotals = {
    all: inWin.length,
    published: 0,
    needs_review: 0,
    blocked: 0,
    failed: 0,
    retrying: 0,
    matching: 0,
  };
  for (const e of inWin) totals[e.status]++;
  const match = inWin.filter((e) => {
    if (status === "needs_review" && e.status !== "needs_review") return false;
    if (status === "blocked" && e.status !== "blocked") return false;
    if (status === "failed" && e.status !== "failed" && e.status !== "retrying") return false;
    if (fromMs !== null && !Number.isNaN(fromMs) && e.t < fromMs) return false;
    if (toMs !== null && !Number.isNaN(toMs) && e.t >= toMs) return false;
    if (q && !`${e.type} ${e.source.label} ${e.id} ${e.ruleRef ?? ""}`.toLowerCase().includes(q))
      return false;
    return true;
  });
  totals.matching = match.length;
  return {
    window: win,
    from: (buckets[0] as ActivityBucket).start,
    to: (buckets[buckets.length - 1] as ActivityBucket).end,
    generatedAt: iso(OPS_NOW),
    synthetic: true,
    perDot,
    buckets,
    callout: calloutOf(inWin),
    totals,
    events: match.slice(0, 200).map(publicEvent),
    ...extra,
  };
}

const retried = new Map<string, string>();

function stepsOf(e: Ev): EventStep[] {
  const steps: EventStep[] = [];
  const r = rng(strHash(e.id));
  const code = (reason: FailureReason | null): string =>
    reason === "graph_429"
      ? "429"
      : reason === "timeout"
        ? "timeout"
        : reason === "permission_denied"
          ? "403"
          : "503";
  const gap = 5_000;
  if (e.source.kind === "agent" || e.source.kind === "human") {
    const blocked = e.status === "blocked";
    steps.push({
      kind: "classifier",
      label: "Classifier verdict",
      state: "ok",
      at: iso(e.t),
      ms: Math.round(20 + r() * 60),
      code: blocked && e.ruleRef ? "client_name" : "clean",
    });
    steps.push({
      kind: "rule",
      label: "Rule matched",
      state: blocked ? "fail" : e.ruleRef ? "ok" : "skipped",
      at: blocked ? iso(e.t + 40) : null,
      ms: blocked ? 8 : null,
      code: e.ruleRef,
    });
    steps.push({
      kind: "policy",
      label: "Policy decision",
      state: e.reason === "permission_denied" ? "fail" : "ok",
      at: iso(e.t + 60),
      ms: 4,
      code: e.reason === "permission_denied" ? "403" : null,
    });
    steps.push({
      kind: "review",
      label: "Review state",
      state: e.status === "needs_review" ? "pending" : e.status === "published" ? "ok" : "skipped",
      at: e.status === "published" ? iso(e.t + 90) : null,
      ms: null,
      code: e.status === "needs_review" ? "waiting" : null,
    });
    return steps;
  }
  const outs = e.attempts.outcomes;
  outs.forEach((o, i) => {
    const at = e.t - (outs.length - 1 - i) * gap;
    steps.push({
      kind: "attempt",
      label: `Try ${i + 1}`,
      state: o === "fail" ? "fail" : o === "ok" ? "ok" : "pending",
      at: o === "scheduled" ? null : iso(at),
      ms:
        o === "scheduled" ? null : o === "ok" ? (e.latencyMs ?? 640) : Math.round(1000 + r() * 900),
      code: o === "fail" ? code(e.reason ?? "timeout") : o === "ok" ? "200" : null,
    });
  });
  if (e.source.kind === "system" && e.type === "classifier.ask")
    steps.push({
      kind: "classifier",
      label: "Classifier verdict",
      state: e.status === "failed" ? "fail" : "ok",
      at: iso(e.t),
      ms: 80,
      code: e.status === "failed" ? "parse_error" : "clean",
    });
  return steps;
}

function detailOf(e: Ev, mode: "brain" | "agent"): EventDetail {
  const r = rng(strHash(`meta:${e.id}`));
  const meta: Record<string, string> = {};
  meta.receiptId = `rcpt_${hex(r, 8)}`;
  meta.action = e.type.replace(/\./g, "_");
  if (mode === "brain") meta.nodeId = e.brain;
  meta.scopeId = e.brain === "me" ? "me" : e.brain;
  meta.decision =
    e.status === "blocked" ? "deny" : e.status === "needs_review" ? "review" : "allow";
  meta.requestId = `req_${hex(r, 10)}`;
  if (e.source.kind === "agent") {
    meta.clientId = `cl_${hex(r, 8)}`;
    meta.tool = e.type.replace(/^wiki\./, "");
    meta.host = agentHostOf(e) || hostOf(e);
  }
  if (e.ruleRef) {
    meta.ruleId = e.ruleRef.replace(/@.*/, "");
    meta.ruleVersion = e.ruleRef.replace(/^.*@/, "");
  }
  if (e.sourceId) meta.sourceId = e.sourceId;
  if (e.source.kind !== "agent" && e.source.kind !== "human") meta.jobId = `job_${hex(r, 10)}`;
  meta.verdict = e.status === "blocked" && e.ruleRef ? "client_name" : "clean";
  const requestedAt = retried.get(e.id);
  return {
    ...publicEvent(e),
    steps: stepsOf(e),
    metadata: meta,
    retry: requestedAt ? { requestedAt } : null,
  };
}

// ---- sources ----

const FILE_TYPES = ["pdf", "docx", "pptx", "xlsx", "md", "txt", "csv", "msg", "html", "rtf", "odt"];
const FOLDERS = [
  "/Proposals",
  "/Pricing",
  "/Delivery",
  "/Legal",
  "/Case studies",
  "/Templates",
  "/Handbook",
  "/Playbooks",
  "/Retros",
  "/Reference",
  "/Archive",
  "/Decks",
  "/Bids 2026",
  "/Bids 2025",
  "/Partners",
  "/Training",
  "/Onboarding",
  "/Security",
  "/Finance",
  "/Research",
];
const AVAILABLE = [...FILE_TYPES, ...FOLDERS];

const SOURCE_DEFS: {
  id: string;
  name: string;
  provider: SourceRow["provider"];
  brain: string;
  collection: string;
  status: SourceRow["status"];
  files: number;
  folder: string;
  chips: string[];
  err?: string;
  next: number | null;
}[] = [
  {
    id: "src_bidlib01",
    name: "Bid library",
    provider: "sharepoint_drive",
    brain: "c_bid",
    collection: "Proposals",
    status: "active",
    files: 1842,
    folder: "/sites/bids/Shared Documents",
    chips: ["pdf", "docx", "pptx", "/Proposals"],
    err: "Graph timeout after 15 s",
    next: 22,
  },
  {
    id: "src_delivdr2",
    name: "Delivery drive",
    provider: "sharepoint_drive",
    brain: "c_delivery",
    collection: "Playbooks",
    status: "active",
    files: 960,
    folder: "/sites/delivery/Shared Documents",
    chips: ["docx", "md", "/Playbooks", "/Retros"],
    next: 540,
  },
  {
    id: "src_proposal3",
    name: "Proposals folder",
    provider: "onedrive_folder",
    brain: "c_bid",
    collection: "Proposals",
    status: "active",
    files: 312,
    folder: "/Proposals",
    chips: ["pdf", "docx"],
    next: 1380,
  },
  {
    id: "src_pricing04",
    name: "Pricing models",
    provider: "sharepoint_drive",
    brain: "c_sales",
    collection: "Pricing",
    status: "active",
    files: 128,
    folder: "/sites/sales/Pricing",
    chips: ["xlsx", "/Pricing"],
    next: 3010,
  },
  {
    id: "src_acmedocs5",
    name: "Acme shared space",
    provider: "sharepoint_drive",
    brain: "a_acme",
    collection: "Contracts",
    status: "active",
    files: 244,
    folder: "/sites/acme/Shared Documents",
    chips: ["pdf", "docx", "/Legal"],
    next: 760,
  },
  {
    id: "src_handbk006",
    name: "Company handbook",
    provider: "sharepoint_drive",
    brain: "core",
    collection: "Handbook",
    status: "active",
    files: 86,
    folder: "/sites/hr/Handbook",
    chips: ["md", "pdf", "/Handbook"],
    next: 4120,
  },
  {
    id: "src_casest007",
    name: "Case studies",
    provider: "sharepoint_drive",
    brain: "c_sales",
    collection: "Case studies",
    status: "paused",
    files: 57,
    folder: "/sites/marketing/Case studies",
    chips: ["pdf", "pptx"],
    next: null,
  },
  {
    id: "src_security8",
    name: "Security policies",
    provider: "sharepoint_drive",
    brain: "core",
    collection: "Policies",
    status: "active",
    files: 41,
    folder: "/sites/security/Policies",
    chips: ["pdf", "docx", "/Security"],
    next: 2210,
  },
  {
    id: "src_templat09",
    name: "Templates",
    provider: "onedrive_folder",
    brain: "c_delivery",
    collection: "Templates",
    status: "active",
    files: 73,
    folder: "/Templates",
    chips: ["docx", "pptx", "xlsx", "/Templates"],
    next: 880,
  },
  {
    id: "src_research10",
    name: "Research notes",
    provider: "onedrive_folder",
    brain: "c_sales",
    collection: "Research",
    status: "paused",
    files: 39,
    folder: "/Research",
    chips: ["md", "txt"],
    next: null,
  },
  {
    id: "src_training11",
    name: "Training decks",
    provider: "sharepoint_drive",
    brain: "core",
    collection: "Training",
    status: "active",
    files: 104,
    folder: "/sites/academy/Decks",
    chips: ["pptx", "/Training"],
    err: "Rate limited (429), retrying",
    next: 95,
  },
  {
    id: "src_partners12",
    name: "Partner agreements",
    provider: "sharepoint_drive",
    brain: "a_acme",
    collection: "Partners",
    status: "active",
    files: 28,
    folder: "/sites/legal/Partners",
    chips: ["pdf", "/Partners"],
    next: 1500,
  },
];

const configs = new Map<string, SourceConfig>();
const rotation = new Map<string, { requestedAt: string }>();

function configOf(id: string): SourceConfig {
  const hit = configs.get(id);
  if (hit) return hit;
  const d = SOURCE_DEFS.find((x) => x.id === id);
  if (!d) throw new ApiError(404, "Not found.", { error: "not_found" });
  const cfg: SourceConfig = {
    id: d.id,
    name: d.name,
    provider: d.provider,
    location: {
      label: d.provider === "sharepoint_drive" ? "SharePoint site" : "OneDrive folder",
      folder: d.folder,
    },
    target: { brainId: d.brain, label: BRAIN_LABEL[d.brain] ?? d.brain, collection: d.collection },
    chips: { selected: [...d.chips], available: AVAILABLE, total: AVAILABLE.length },
    credential: {
      name: `SOURCE_${d.id.replace(/^src_/, "").toUpperCase()}_SECRET`,
      rotatedAt: "2026-09-18T08:30:00.000Z",
      pending: null,
    },
    schedule: { deltaMinutes: d.id === "src_bidlib01" ? 15 : 30 },
    retry: { kind: "exponential", baseSeconds: 5, maxSeconds: 86_400, tries: 8 },
    timeoutSeconds: 15,
    aclMaxAgeSeconds: 3_600,
    status: d.status,
    lastSyncAt:
      d.status === "paused"
        ? "2026-11-01T09:00:00.000Z"
        : iso(OPS_NOW - (3 + (strHash(d.id) % 25)) * MIN),
    lastError: d.err ?? null,
    synthetic: true,
  };
  configs.set(id, cfg);
  return cfg;
}

function sourceRow(d: (typeof SOURCE_DEFS)[number]): SourceRow {
  const c = configOf(d.id);
  return {
    id: d.id,
    name: c.name,
    provider: c.provider,
    target: c.target,
    status: c.status,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    files: d.files,
    nextRunInSeconds: c.status === "paused" ? null : d.next,
    synthetic: true,
  };
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

function parseRetry(v: unknown): RetryPolicy | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "none") return { kind: "none" };
  if (o.kind === "exponential") {
    const baseSeconds = int(o.baseSeconds, 1, 3600);
    const maxSeconds = int(o.maxSeconds, 1, 86_400);
    const tries = int(o.tries, 2, 12);
    if (baseSeconds === null || maxSeconds === null || tries === null || maxSeconds < baseSeconds)
      return null;
    return { kind: "exponential", baseSeconds, maxSeconds, tries };
  }
  if (o.kind === "linear") {
    const everySeconds = int(o.everySeconds, 1, 86_400);
    const tries = int(o.tries, 2, 12);
    return everySeconds === null || tries === null ? null : { kind: "linear", everySeconds, tries };
  }
  if (o.kind === "fixed") {
    if (!Array.isArray(o.times) || o.times.length < 1 || o.times.length > 11) return null;
    const times = o.times.map((x) => int(x, 1, 86_400));
    return times.some((x) => x === null) ? null : { kind: "fixed", times: times as number[] };
  }
  return null;
}

const bad = (error: string, reason: string) => new ApiError(400, reason, { error, reason });

function saveSource(id: string, body: Record<string, unknown>): SourceConfig {
  const c = configOf(id);
  const next: SourceConfig = { ...c };
  if (body.chips !== undefined) {
    const chips = body.chips;
    if (
      !Array.isArray(chips) ||
      chips.length > 40 ||
      chips.some((x) => typeof x !== "string" || !/^[A-Za-z0-9/._ -]{1,60}$/.test(x))
    )
      throw bad(
        "invalid_chips",
        "Chips: up to 40 types or folders, 1 to 60 letters, digits or / . _ - each.",
      );
    next.chips = { ...c.chips, selected: [...new Set(chips as string[])] };
  }
  if (body.schedule !== undefined) {
    const m = int((body.schedule as { deltaMinutes?: unknown } | null)?.deltaMinutes, 5, 1440);
    if (m === null) throw bad("invalid_schedule", "Sync every 5 to 1440 minutes.");
    next.schedule = { deltaMinutes: m };
  }
  if (body.retry !== undefined) {
    const rp = parseRetry(body.retry);
    if (!rp) throw bad("invalid_retry", "Retry policy is not valid.");
    next.retry = rp;
  }
  if (body.timeoutSeconds !== undefined) {
    const s = int(body.timeoutSeconds, 1, 120);
    if (s === null) throw bad("invalid_timeout", "Timeout is 1 to 120 seconds.");
    next.timeoutSeconds = s;
  }
  if (body.aclMaxAgeSeconds !== undefined) {
    const s = int(body.aclMaxAgeSeconds, 60, 86_400);
    if (s === null) throw bad("invalid_acl_max_age", "ACL max age is 60 to 86400 seconds.");
    next.aclMaxAgeSeconds = s;
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "paused")
      throw bad("invalid_status", "Status is active or paused.");
    next.status = body.status;
  }
  configs.set(id, next);
  return next;
}

function statsOf(id: string): SourceStats {
  const c = configOf(id);
  const r = rng(strHash(`stats:${id}`));
  const first = id === "src_bidlib01";
  const n = 320;
  const timedOut = first ? 24 : 2 + Math.floor(r() * 5);
  const oks: { ms: number; outcome: CallOutcome }[] = [];
  const ok = n - timedOut;
  for (let i = 0; i < ok; i++) {
    // Log-normal around a median that is scaled below so p50 lands on 292 ms for the first source.
    const z = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    oks.push({ ms: Math.exp(Math.log(300) + 0.85 * z), outcome: "ok" });
  }
  const sortedMs = oks.map((p) => p.ms).sort((a, b) => a - b);
  const targetP50 = first ? 292 : 180 + Math.floor(r() * 400);
  const k = targetP50 / (sortedMs[Math.floor(n / 2) - 1] as number);
  const mid = oks.map((p) => ({ ms: Math.max(30, Math.round(p.ms * k)), outcome: p.outcome }));
  // A few rate limited and errored calls are among the fast ones.
  for (let i = 0; i < 7; i++) (mid[i * 11] as { outcome: CallOutcome }).outcome = "429";
  for (let i = 0; i < 3; i++) (mid[5 + i * 31] as { outcome: CallOutcome }).outcome = "error";
  const timeouts = Array.from({ length: timedOut }, (_, i) => ({
    ms: Math.min(c.timeoutSeconds * 1000, 13_300 + Math.round(i * 85.7)),
    outcome: "timeout" as CallOutcome,
  }));
  if (first && timeouts[7]) timeouts[7].ms = 13_900;
  const points = [...mid, ...timeouts]
    .map((p) => ({ p, k: r() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
  const sorted = points.map((p) => p.ms).sort((a, b) => a - b);
  const pctl = (p: number) =>
    sorted[
      Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1
    ] as number;
  const share = timedOut / points.length;
  const p95 = pctl(95);
  const raise = share > 0.05;
  const plan = retryPlan(c.retry);
  const total = 1240;
  const stale = 94;
  const failClosed = 28;
  return {
    synthetic: true,
    retry: {
      plan,
      tries: c.retry.kind === "none" ? 1 : plan.length + 1,
      totalSeconds: plan.length ? (plan[plan.length - 1] as { atSeconds: number }).atSeconds : 0,
      honoursRetryAfter: true,
      next: first && c.status === "active" ? { try: 3, inSeconds: 22, last: "429" } : null,
    },
    latency: {
      n: points.length,
      timeoutSeconds: c.timeoutSeconds,
      p50Ms: pctl(50),
      p95Ms: p95,
      timedOut,
      timedOutShare: share,
      hint: {
        raiseTimeout: raise,
        suggestedSeconds: raise
          ? Math.min(120, Math.max(c.timeoutSeconds + 5, Math.ceil(p95 / 1000) + 5))
          : null,
      },
      points,
    },
    acl: {
      maxAgeSeconds: c.aclMaxAgeSeconds,
      total,
      confirmed: total - stale - failClosed,
      stale,
      failClosed,
      share: (total - stale - failClosed) / total,
    },
  };
}

// ---- health ----

interface RowDef {
  id: string;
  kind: "brain" | "source";
  label: string;
  weight: number;
}
const HEAT_ROWS: RowDef[] = [
  { id: "c_bid", kind: "brain", label: "Bid & Pre-sales", weight: 0.32 },
  { id: "core", kind: "brain", label: "Company Brain", weight: 0.16 },
  { id: "c_sales", kind: "brain", label: "Sales circle", weight: 0.2 },
  { id: "c_delivery", kind: "brain", label: "Delivery practice", weight: 0.2 },
  { id: "a_acme", kind: "brain", label: "Account Acme", weight: 0.12 },
  { id: "src_bidlib01", kind: "source", label: "Bid library", weight: 0.3 },
  { id: "src_delivdr2", kind: "source", label: "Delivery drive", weight: 0.18 },
  { id: "src_proposal3", kind: "source", label: "Proposals folder", weight: 0.1 },
];
const ATTEMPTS: Record<HealthWindow, number> = { "1h": 520, "24h": 5980, "7d": 31_400 };

/** Injected failing cells: [row, column from the end (0 is the last), failed, reason, rule]. */
const INJECT: Record<HealthWindow, [string, number, number, FailureReason, string | null][]> = {
  "1h": [
    ["c_bid", 2, 4, "blocked_by_rule", RULE],
    ["c_bid", 1, 7, "blocked_by_rule", RULE],
    ["c_bid", 0, 5, "blocked_by_rule", RULE],
    ["src_bidlib01", 0, 4, "timeout", null],
  ],
  "24h": [
    ["c_bid", 1, 9, "blocked_by_rule", RULE],
    ["c_bid", 0, 12, "blocked_by_rule", RULE],
    ["src_bidlib01", 0, 6, "timeout", null],
    ["src_delivdr2", 20, 8, "graph_429", null],
    ["core", 8, 7, "permission_denied", null],
  ],
  "7d": [
    ["c_bid", 0, 52, "blocked_by_rule", RULE],
    ["src_delivdr2", 22, 40, "graph_429", null],
    ["core", 9, 36, "permission_denied", null],
  ],
};

function healthOf(window: HealthWindow, role: string): HealthResponse {
  const admin = role === "platform_admin";
  const stewardOf = Object.entries(MANAGERS)
    .filter(([id, roles]) => id !== "me" && roles.includes(role))
    .map(([id]) => id);
  if (!admin && !stewardOf.length)
    throw new ApiError(403, "Health needs the configure grant or a brain you manage.", {
      error: "forbidden",
    });
  const { ms, columnMs } = HEALTH[window];
  const n = ms / columnMs;
  const end = Math.ceil(OPS_NOW / columnMs) * columnMs;
  const start = end - n * columnMs;
  const columns = Array.from({ length: n }, (_, i) => iso(start + i * columnMs));
  const partialLast = window === "24h" ? 0.1 : 1;
  const curve = columns.map((c, i) => {
    const h = new Date(c).getUTCHours();
    const day = new Date(c).getUTCDay();
    const base = window === "1h" ? 0.7 + 0.5 * (i / n) : 0.18 + Math.exp(-(((h - 14) / 4.2) ** 2));
    const weekend = window === "7d" && (day === 0 || day === 6) ? 0.4 : 1;
    return base * weekend * (i === n - 1 ? partialLast : 1);
  });
  const curveSum = curve.reduce((a, b) => a + b, 0);
  const reasonOf = (r: () => number): FailureReason =>
    pickW(r, [
      ["permission_denied", 28],
      ["graph_429", 22],
      ["timeout", 14],
      ["blocked_by_rule", 16],
      ["classifier_asked", 12],
      ["parse_error", 8],
    ] as const);
  const reasonTotals = new Map<FailureReason, number>();
  const rows: HeatRow[] = HEAT_ROWS.filter(
    (d) =>
      admin ||
      stewardOf.includes(d.id) ||
      (d.kind === "source" && d.id === "src_bidlib01" && stewardOf.includes("c_bid")),
  ).map((d) => {
    const r = rng(strHash(`heat:${window}:${d.id}`));
    const inj = INJECT[window].filter((x) => x[0] === d.id);
    const cells: HeatCell[] = curve.map((w, i) => {
      const attempts0 = Math.round((ATTEMPTS[window] * d.weight * w) / curveSum);
      const j = inj.find((x) => n - 1 - x[1] === i);
      const rate = d.kind === "brain" ? 0.026 : 0.03;
      const bg = Math.round(attempts0 * rate * (0.4 + 1.2 * r()));
      const failedInj = j ? j[2] : 0;
      const failed = bg + failedInj;
      const attempts = Math.max(attempts0, Math.ceil((failedInj * 100) / 22), failed);
      const why = new Map<FailureReason, number>();
      for (let k = 0; k < bg; k++) {
        const rr = reasonOf(r);
        why.set(rr, (why.get(rr) ?? 0) + 1);
      }
      if (j) why.set(j[3], (why.get(j[3]) ?? 0) + failedInj);
      if (d.kind === "brain")
        for (const [rr, c] of why) reasonTotals.set(rr, (reasonTotals.get(rr) ?? 0) + c);
      const top = [...why].sort(
        (a, b) => b[1] - a[1] || FAILURE_REASONS.indexOf(a[0]) - FAILURE_REASONS.indexOf(b[0]),
      )[0];
      return {
        attempts,
        delivered: attempts - failed,
        failed,
        failing: failed > 0 && failed / attempts >= 0.1,
        topReason: top ? top[0] : null,
        ruleRef: top && top[0] === "blocked_by_rule" && d.id === "c_bid" ? RULE : null,
      };
    });
    return {
      id: d.id,
      kind: d.kind,
      label: d.label,
      total: cells.reduce((a, c) => a + c.attempts, 0),
      failed: cells.reduce((a, c) => a + c.failed, 0),
      cells,
    };
  });
  const brainRows = rows.filter((x) => x.kind === "brain");
  const attempts = brainRows.reduce((a, x) => a + x.total, 0);
  const failed = brainRows.reduce((a, x) => a + x.failed, 0);
  const delivered = attempts - failed;
  const recovered = Math.round(delivered * 0.043);
  const failures = FAILURE_REASONS.filter((k) => reasonTotals.has(k))
    .map((reason) => ({
      reason,
      count: reasonTotals.get(reason) as number,
      share: failed ? (reasonTotals.get(reason) as number) / failed : 0,
    }))
    .sort(
      (a, b) =>
        b.count - a.count || FAILURE_REASONS.indexOf(a.reason) - FAILURE_REASONS.indexOf(b.reason),
    );
  return {
    window,
    generatedAt: iso(OPS_NOW),
    scope: admin ? "tenant" : "stewards",
    synthetic: true,
    slo: 0.99,
    success: { attempts, delivered, failed, rate: attempts ? delivered / attempts : 1 },
    outcomes: { firstTry: delivered - recovered, recovered, failing: failed },
    failures,
    heatmap: { columnMs, columns, rows },
    totals: { attempts, delivered, failed },
  };
}

// ---- routing ----

const forbidden = (why: string) => new ApiError(403, why, { error: "forbidden" });
const missing = () => new ApiError(404, "Not found.", { error: "not_found" });

function brainEvents(id: string, role: string): Ev[] {
  const managers = MANAGERS[id];
  if (!managers) throw missing();
  if (!managers.includes(role))
    throw forbidden("Only a person who manages this brain can see its activity.");
  return streamOf(id);
}

/** Dev mock for the v7 Operate routes. Returns NOT_HANDLED for anything else. */
export function handleV7Ops(
  method: "GET" | "POST" | "PUT" | "DELETE",
  p: string,
  params: URLSearchParams,
  body: Record<string, unknown>,
  role: string,
): unknown {
  let m = /^\/v1\/brains\/([^/]+)\/activity(?:\/([^/]+?)(\/retry)?)?$/.exec(p);
  if (m) {
    const brain = decodeURIComponent(m[1] as string);
    const evs = brainEvents(brain, role);
    if (!m[2] && method === "GET") return activityOf(evs, params, { brainId: brain });
    const id = decodeURIComponent(m[2] as string);
    const ev = evs.find((e) => e.id === id);
    if (!ev) throw missing();
    if (!m[3] && method === "GET") return detailOf(ev, "brain");
    if (m[3] && method === "POST") {
      if (!ev.retryable)
        throw new ApiError(409, "This event cannot be retried.", { error: "not_retryable" });
      const prior = retried.get(ev.id);
      const kind = ev.type === "connector.sync" ? "connector" : "ingest";
      if (!retried.has(ev.id)) retried.set(ev.id, iso(OPS_NOW));
      return { ok: true, retryId: `rty_${ev.id.slice(4, 16)}`, kind, already: prior !== undefined };
    }
    return NOT_HANDLED;
  }
  m = /^\/v1\/agents\/activity(?:\/([^/]+))?$/.exec(p);
  if (m && method === "GET") {
    const host = params.get("host");
    const all = agentStream();
    const evs = host ? all.filter((e) => agentHostOf(e) === host) : all;
    if (!m[1]) {
      const inWin = (params.get("window") ?? "60m") as ActivityWindow;
      const ms = (WINDOWS[inWin] ?? WINDOWS["60m"]).ms;
      const counts = new Map<string, number>();
      for (const e of all)
        if (e.t >= OPS_NOW - ms) counts.set(agentHostOf(e), (counts.get(agentHostOf(e)) ?? 0) + 1);
      const hosts = AGENT_HOSTS.map(([hid, label]) => ({
        id: hid,
        label,
        count: counts.get(hid) ?? 0,
      }));
      const res = activityOf(evs, params, { hosts });
      return { ...res, events: res.events.map((e) => ({ ...e, retryable: false })) };
    }
    const id = decodeURIComponent(m[1]);
    const ev = all.find((e) => e.id === id);
    if (!ev) throw missing();
    return { ...detailOf(ev, "agent"), retryable: false };
  }
  if (p === "/v1/health" && params.has("window") && method === "GET") {
    const w = params.get("window") as HealthWindow;
    if (!(w in HEALTH))
      throw new ApiError(400, "Window must be 1h, 24h or 7d.", { error: "bad_window" });
    return healthOf(w, role);
  }
  if (p === "/v1/sources" && method === "GET") {
    if (role !== "platform_admin") throw forbidden("Sources need the configure grant.");
    const out: SourceList = { synthetic: true, sources: SOURCE_DEFS.map(sourceRow) };
    return out;
  }
  m = /^\/v1\/sources\/(src_[^/:%]+)(\/run|\/stats|\/credential\/rotate)?$/.exec(p);
  if (m) {
    if (role !== "platform_admin") throw forbidden("Sources need the configure grant.");
    const id = decodeURIComponent(m[1] as string);
    const c = configOf(id);
    const sub = m[2];
    if (!sub && method === "GET") {
      const pending = rotation.get(id) ?? null;
      return { ...c, credential: { ...c.credential, pending } };
    }
    if (!sub && method === "PUT") return saveSource(id, body);
    if (sub === "/run" && method === "POST") {
      if (c.status === "paused")
        throw new ApiError(409, "The source is paused.", { error: "paused" });
      return { ok: true };
    }
    if (sub === "/stats" && method === "GET") return statsOf(id);
    if (sub === "/credential/rotate" && method === "POST") {
      // The mock has one admin. The second call stands in for a different admin confirming.
      if (!rotation.has(id)) {
        rotation.set(id, { requestedAt: iso(OPS_NOW) });
        return { status: "pending", needs: "second_person", name: c.credential.name };
      }
      rotation.delete(id);
      const rotatedAt = iso(OPS_NOW);
      configs.set(id, { ...c, credential: { ...c.credential, rotatedAt, pending: null } });
      return { status: "rotated", name: c.credential.name, rotatedAt };
    }
    return NOT_HANDLED;
  }
  return NOT_HANDLED;
}
