// v7 operate: the pure model behind Brain activity, Sources and Platform health
// (docs/DESIGN-V7-GOVERN-OPERATE.md sections 2 to 4). No runtime dependencies, so workers import it by
// relative path (the contracts package root pulls in ajv, which workerd forbids). Ids, counts and
// timings only: nothing here can carry page content.

export const OPS_STATUSES = ["published", "needs_review", "blocked", "failed", "retrying"] as const;
export type OpsStatus = (typeof OPS_STATUSES)[number];

export const FAILURE_REASONS = [
  "permission_denied",
  "graph_429",
  "timeout",
  "blocked_by_rule",
  "classifier_asked",
  "parse_error",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const SLO_DEFAULT = 0.99;

// ---- retry policy ----

export type RetryPolicy =
  | { kind: "exponential"; baseSeconds: number; maxSeconds: number; tries: number }
  | { kind: "linear"; everySeconds: number; tries: number }
  | { kind: "fixed"; times: number[] }
  | { kind: "none" };

export const DAY_S = 86_400;
/** Growth of the exponential ladder: 5 s, 30 s, 3 min, 18 min, 1.8 h, 10.8 h, then the cap. */
export const EXP_FACTOR = 6;
export const DEFAULT_RETRY: RetryPolicy = {
  kind: "exponential",
  baseSeconds: 5,
  maxSeconds: DAY_S,
  tries: 8,
};

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** A policy from untrusted input, or null. Unknown keys are dropped. */
export function parseRetry(v: unknown): RetryPolicy | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "none") return { kind: "none" };
  if (o.kind === "exponential") {
    const baseSeconds = int(o.baseSeconds, 1, 3_600);
    const maxSeconds = int(o.maxSeconds, 1, DAY_S);
    const tries = int(o.tries, 2, 12);
    if (baseSeconds === null || maxSeconds === null || tries === null || maxSeconds < baseSeconds)
      return null;
    return { kind: "exponential", baseSeconds, maxSeconds, tries };
  }
  if (o.kind === "linear") {
    const everySeconds = int(o.everySeconds, 1, DAY_S);
    const tries = int(o.tries, 2, 12);
    return everySeconds === null || tries === null ? null : { kind: "linear", everySeconds, tries };
  }
  if (o.kind === "fixed") {
    if (!Array.isArray(o.times) || o.times.length < 1 || o.times.length > 11) return null;
    const times = o.times.map((t) => int(t, 1, DAY_S));
    if (times.some((t) => t === null)) return null;
    return { kind: "fixed", times: times as number[] };
  }
  return null;
}

export type RetryStep = {
  /** 2 is the first retry. */
  try: number;
  /** Seconds to wait before this try. */
  afterSeconds: number;
  /** Seconds from the first failure. */
  atSeconds: number;
};

/** The planned retries after a first failure. Honours nothing at run time: Retry-After is `nextDelay`. */
export function retryPlan(p: RetryPolicy): RetryStep[] {
  const waits: number[] = [];
  if (p.kind === "exponential")
    for (let i = 0; i < p.tries - 1; i++)
      waits.push(Math.min(p.maxSeconds, Math.round(p.baseSeconds * EXP_FACTOR ** i)));
  else if (p.kind === "linear") for (let i = 0; i < p.tries - 1; i++) waits.push(p.everySeconds);
  else if (p.kind === "fixed") waits.push(...p.times);
  let at = 0;
  return waits.map((afterSeconds, i) => {
    at += afterSeconds;
    return { try: i + 2, afterSeconds, atSeconds: at };
  });
}

/**
 * The wait before retry `n` (1 is the first retry), or null when the policy gives up. A Retry-After
 * (Graph 429 and 503) never shortens the planned wait; it only lengthens it, up to one day.
 */
export function nextDelay(p: RetryPolicy, n: number, retryAfterSeconds?: number): number | null {
  const step = retryPlan(p)[n - 1];
  if (!step) return null;
  const hinted =
    typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds)
      : 0;
  return Math.min(DAY_S, Math.max(step.afterSeconds, Math.ceil(hinted)));
}

// ---- latency ----

export type CallOutcome = "ok" | "timeout" | "429" | "error";
export type LatencyPoint = { ms: number; outcome: CallOutcome };

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export type LatencyStats = {
  n: number;
  timeoutSeconds: number;
  p50Ms: number;
  p95Ms: number;
  timedOut: number;
  timedOutShare: number;
  hint: { raiseTimeout: boolean; suggestedSeconds: number | null };
};

/** Suggest a longer timeout when more than 5 percent of the calls ran into it. */
export function latencyStats(points: LatencyPoint[], timeoutSeconds: number): LatencyStats {
  const sorted = points.map((p) => p.ms).sort((a, b) => a - b);
  const timedOut = points.filter((p) => p.outcome === "timeout").length;
  const share = points.length ? timedOut / points.length : 0;
  const p95 = percentile(sorted, 95);
  const raise = share > 0.05;
  return {
    n: points.length,
    timeoutSeconds,
    p50Ms: percentile(sorted, 50),
    p95Ms: p95,
    timedOut,
    timedOutShare: share,
    hint: {
      raiseTimeout: raise,
      suggestedSeconds: raise
        ? Math.min(120, Math.max(timeoutSeconds + 5, Math.ceil(p95 / 1000) + 5))
        : null,
    },
  };
}

export type AclStrip = {
  maxAgeSeconds: number;
  total: number;
  /** Allowed and confirmed at the source within the max age. */
  confirmed: number;
  /** Allowed once, older than the max age: re-checked before the next read. */
  stale: number;
  /** Not allowed, or not confirmable: the item stayed hidden (fail closed). */
  failClosed: number;
  share: number;
};

export function aclStrip(
  rows: { allowed: boolean; checkedAt: number }[],
  maxAgeSeconds: number,
  now: number,
): AclStrip {
  let confirmed = 0;
  let stale = 0;
  let failClosed = 0;
  for (const r of rows) {
    if (!r.allowed) failClosed++;
    else if (now - r.checkedAt <= maxAgeSeconds * 1000) confirmed++;
    else stale++;
  }
  return {
    maxAgeSeconds,
    total: rows.length,
    confirmed,
    stale,
    failClosed,
    share: rows.length ? confirmed / rows.length : 1,
  };
}

// ---- windows and buckets ----

export const ACTIVITY_WINDOWS = {
  "60m": { ms: 3_600_000, bucketMs: 60_000 },
  "24h": { ms: 86_400_000, bucketMs: 1_800_000 },
  "7d": { ms: 604_800_000, bucketMs: 7_200_000 },
} as const;
export type ActivityWindow = keyof typeof ACTIVITY_WINDOWS;

/** Heatmap columns: 5 minutes for 1 h, one hour for 24 h, six hours for 7 d. */
export const HEALTH_WINDOWS = {
  "1h": { ms: 3_600_000, columnMs: 300_000 },
  "24h": { ms: 86_400_000, columnMs: 3_600_000 },
  "7d": { ms: 604_800_000, columnMs: 21_600_000 },
} as const;
export type HealthWindow = keyof typeof HEALTH_WINDOWS;

/** Dots stacked in one timeline column at most. */
export const MAX_DOTS = 14;

// ---- the normalised record both views read ----

export type OpActor = { kind: "agent" | "connector" | "human" | "system"; label: string };
export type OpAttempt = "fail" | "ok" | "scheduled";

export type OpRecord = {
  /** Stable, opaque: `evt_` plus 16 hex digits. */
  id: string;
  at: number;
  /** Where it came from. */
  origin: "receipt" | "connector" | "ingest" | "classifier";
  /** The brain scope param it belongs to (a policy node id or "me"), when it has one. */
  brain: string | null;
  sourceId: string | null;
  type: string;
  actor: OpActor;
  status: OpsStatus;
  attempts: OpAttempt[];
  maxAttempts: number;
  latencyMs: number | null;
  reason: FailureReason | null;
  /** `ruleId@version`, only when the receipt names one. */
  ruleRef: string | null;
  retryable: boolean;
};

const isFailed = (s: OpsStatus): boolean => s === "blocked" || s === "failed" || s === "retrying";

export type OutcomeCounts = { firstTry: number; recovered: number; failing: number };

export function outcomesOf(records: OpRecord[]): OutcomeCounts {
  let firstTry = 0;
  let recovered = 0;
  let failing = 0;
  for (const r of records) {
    if (isFailed(r.status)) failing++;
    else if (r.attempts.filter((a) => a === "fail").length > 0) recovered++;
    else firstTry++;
  }
  return { firstTry, recovered, failing };
}

export type FailureRow = { reason: FailureReason; count: number; share: number };

export function failuresOf(records: OpRecord[]): FailureRow[] {
  const counts = new Map<FailureReason, number>();
  let total = 0;
  for (const r of records) {
    if (!isFailed(r.status)) continue;
    const reason = r.reason ?? "parse_error";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    total++;
  }
  return FAILURE_REASONS.filter((k) => counts.has(k))
    .map((reason) => ({
      reason,
      count: counts.get(reason) as number,
      share: total ? (counts.get(reason) as number) / total : 0,
    }))
    .sort(
      (a, b) =>
        b.count - a.count || FAILURE_REASONS.indexOf(a.reason) - FAILURE_REASONS.indexOf(b.reason),
    );
}

export type HeatCell = {
  attempts: number;
  delivered: number;
  failed: number;
  failing: boolean;
  topReason: FailureReason | null;
  ruleRef: string | null;
};
export type HeatRow = {
  id: string;
  kind: "brain" | "source";
  label: string;
  total: number;
  failed: number;
  cells: HeatCell[];
};

/** A column is a failing hour when at least one in ten of its attempts failed. */
export const FAILING_SHARE = 0.1;

export function heatmapOf(
  records: OpRecord[],
  rows: { id: string; kind: "brain" | "source"; label: string }[],
  win: HealthWindow,
  now: number,
): { columnMs: number; columns: string[]; rows: HeatRow[] } {
  const { ms, columnMs } = HEALTH_WINDOWS[win];
  const n = ms / columnMs;
  // Columns end at the last full column boundary after `now`, oldest first.
  const end = Math.ceil(now / columnMs) * columnMs;
  const start = end - n * columnMs;
  const columns = Array.from({ length: n }, (_, i) => new Date(start + i * columnMs).toISOString());
  const out: HeatRow[] = rows.map((r) => ({ ...r, total: 0, failed: 0, cells: [] }));
  const byRow = new Map(out.map((r) => [`${r.kind}:${r.id}`, r]));
  const acc = new Map<
    string,
    { a: number; f: number; why: Map<FailureReason, number>; rule: string | null }[]
  >();
  for (const r of records) {
    if (r.at < now - ms || r.at > now) continue;
    const cols: [string, string][] = [];
    if (r.brain !== null) cols.push([`brain:${r.brain}`, r.brain]);
    if (r.sourceId !== null) cols.push([`source:${r.sourceId}`, r.sourceId]);
    for (const [key] of cols) {
      const row = byRow.get(key);
      if (!row) continue;
      const i = Math.min(n - 1, Math.max(0, Math.floor((r.at - start) / columnMs)));
      let cells = acc.get(key);
      if (!cells) {
        cells = Array.from({ length: n }, () => ({ a: 0, f: 0, why: new Map(), rule: null }));
        acc.set(key, cells);
      }
      const cell = cells[i] as (typeof cells)[number];
      cell.a++;
      row.total++;
      if (isFailed(r.status)) {
        cell.f++;
        row.failed++;
        const why = r.reason ?? "parse_error";
        cell.why.set(why, (cell.why.get(why) ?? 0) + 1);
        cell.rule ??= r.ruleRef;
      }
    }
  }
  for (const row of out) {
    const cells = acc.get(`${row.kind}:${row.id}`);
    row.cells = Array.from({ length: n }, (_, i) => {
      const c = cells?.[i];
      if (!c)
        return {
          attempts: 0,
          delivered: 0,
          failed: 0,
          failing: false,
          topReason: null,
          ruleRef: null,
        };
      const top = [...c.why].sort(
        (a, b) => b[1] - a[1] || FAILURE_REASONS.indexOf(a[0]) - FAILURE_REASONS.indexOf(b[0]),
      )[0];
      return {
        attempts: c.a,
        delivered: c.a - c.f,
        failed: c.f,
        failing: c.f > 0 && c.f / c.a >= FAILING_SHARE,
        topReason: top ? top[0] : null,
        ruleRef: c.rule,
      };
    });
  }
  return { columnMs, columns, rows: out };
}

export type ActivityBucket = {
  start: string;
  end: string;
  total: number;
  counts: Record<OpsStatus, number>;
};

const zeroCounts = (): Record<OpsStatus, number> => ({
  published: 0,
  needs_review: 0,
  blocked: 0,
  failed: 0,
  retrying: 0,
});

/** Timeline columns, oldest first. The last column ends at the next boundary after `now`. */
export function bucketsOf(
  records: OpRecord[],
  win: ActivityWindow,
  now: number,
): { buckets: ActivityBucket[]; perDot: number } {
  const { ms, bucketMs } = ACTIVITY_WINDOWS[win];
  const n = ms / bucketMs;
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const start = end - n * bucketMs;
  const buckets: ActivityBucket[] = Array.from({ length: n }, (_, i) => ({
    start: new Date(start + i * bucketMs).toISOString(),
    end: new Date(start + (i + 1) * bucketMs).toISOString(),
    total: 0,
    counts: zeroCounts(),
  }));
  for (const r of records) {
    if (r.at < start || r.at >= end) continue;
    const b = buckets[Math.floor((r.at - start) / bucketMs)] as ActivityBucket;
    b.total++;
    b.counts[r.status]++;
  }
  const peak = Math.max(0, ...buckets.map((b) => b.total));
  return { buckets, perDot: Math.max(1, Math.ceil(peak / MAX_DOTS)) };
}

export type Callout = {
  since: string;
  kind: "blocked" | "failed";
  label: string;
  count: number;
} | null;

/**
 * The failure callout: the start of the current run of failing events (newest first, stopping at the
 * first healthy one inside the last tenth of the window), and the thing they share.
 */
export function calloutOf(records: OpRecord[]): Callout {
  const failing = records.filter((r) => r.status === "blocked" || r.status === "failed");
  const newest = records[0];
  if (!failing.length || !newest) return null;
  // A run counts when the newest event is failing, or the last failure is the last thing that happened to its type.
  const first = failing[0] as OpRecord;
  const run: OpRecord[] = [];
  for (const r of failing) {
    if (r.type !== first.type && !(r.ruleRef !== null && r.ruleRef === first.ruleRef)) continue;
    run.push(r);
  }
  const since = run.reduce((m, r) => Math.min(m, r.at), first.at);
  const label =
    first.ruleRef !== null ? first.ruleRef : first.reason !== null ? first.reason : first.type;
  return {
    since: new Date(since).toISOString(),
    kind: first.status === "blocked" ? "blocked" : "failed",
    label,
    count: run.length,
  };
}

/** Opaque, stable event id from a source key (a receipt id, a job id, a sync attempt id). */
export async function eventId(key: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`v7.evt:${key}`));
  return `evt_${[...new Uint8Array(d)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A `ruleId@version` token in a receipt reason, when one is named. */
const RULE_REF = /\b([A-Za-z][A-Za-z0-9_-]{1,40}@v?\d{1,4})\b/;
export const ruleRefOf = (reason: string): string | null => RULE_REF.exec(reason)?.[1] ?? null;

export const EVENT_ID = /^evt_[0-9a-f]{16}$/;
