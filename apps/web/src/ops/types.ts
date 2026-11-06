// Shapes of the v7 Operate endpoints (docs/API-CONTRACT.md "v7 Operate"). Copied from the pure model
// in packages/contracts/src/ops-v7.ts: the web does not import that file. Ids, counts, timings only.

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

export type ActivityWindow = "60m" | "24h" | "7d";
export type HealthWindow = "1h" | "24h" | "7d";
export type StatusFilter = "all" | "needs_review" | "blocked" | "failed";
export type Attempt = "fail" | "ok" | "scheduled";

export interface OpEvent {
  id: string;
  type: string;
  source: { kind: "agent" | "connector" | "human" | "system"; label: string };
  status: OpsStatus;
  attempts: { count: number; max: number; outcomes: Attempt[] };
  latencyMs: number | null;
  at: string;
  reason: FailureReason | null;
  ruleRef: string | null;
  retryable: boolean;
}

export interface ActivityBucket {
  start: string;
  end: string;
  total: number;
  counts: Record<OpsStatus, number>;
}

export interface Callout {
  since: string;
  kind: "blocked" | "failed";
  label: string;
  count: number;
}

export interface ActivityTotals {
  all: number;
  published: number;
  needs_review: number;
  blocked: number;
  failed: number;
  retrying: number;
  matching: number;
}

export interface ActivityResponse {
  brainId?: string;
  window: ActivityWindow;
  from: string;
  to: string;
  generatedAt: string;
  synthetic: boolean;
  perDot: number;
  buckets: ActivityBucket[];
  callout: Callout | null;
  totals: ActivityTotals;
  events: OpEvent[];
  /** Agent activity only. */
  hosts?: { id: string; label: string; count: number }[];
}

export interface EventStep {
  kind: "attempt" | "classifier" | "rule" | "review" | "policy";
  label: string;
  state: "ok" | "fail" | "pending" | "skipped";
  at: string | null;
  ms: number | null;
  code: string | null;
}

export interface EventDetail extends OpEvent {
  steps: EventStep[];
  metadata: Record<string, string>;
  retry: { requestedAt: string } | null;
}

export interface RetryResult {
  ok: true;
  retryId: string;
  kind: "connector" | "ingest";
  already: boolean;
}

export interface ActivityQuery {
  window: ActivityWindow;
  status: StatusFilter;
  q: string;
  from?: string | undefined;
  to?: string | undefined;
  host?: string | undefined;
}

// ---- sources ----

export type RetryPolicy =
  | { kind: "exponential"; baseSeconds: number; maxSeconds: number; tries: number }
  | { kind: "linear"; everySeconds: number; tries: number }
  | { kind: "fixed"; times: number[] }
  | { kind: "none" };

export type SourceStatus = "active" | "paused";

export interface SourceRow {
  id: string;
  name: string;
  provider: "sharepoint_drive" | "onedrive_folder";
  target: { brainId: string; label: string; collection: string };
  status: SourceStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  files: number;
  nextRunInSeconds: number | null;
  synthetic: boolean;
}

export interface SourceList {
  synthetic: boolean;
  sources: SourceRow[];
}

export interface SourceConfig {
  id: string;
  name: string;
  provider: SourceRow["provider"];
  location: { label: string; folder: string };
  target: { brainId: string; label: string; collection: string };
  chips: { selected: string[]; available: string[]; total: number };
  credential: { name: string; rotatedAt: string | null; pending: { requestedAt: string } | null };
  schedule: { deltaMinutes: number };
  retry: RetryPolicy;
  timeoutSeconds: number;
  aclMaxAgeSeconds: number;
  status: SourceStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  synthetic: boolean;
}

export interface SourcePatch {
  chips?: string[];
  schedule?: { deltaMinutes: number };
  retry?: RetryPolicy;
  timeoutSeconds?: number;
  aclMaxAgeSeconds?: number;
  status?: SourceStatus;
}

export type CallOutcome = "ok" | "timeout" | "429" | "error";

export interface SourceStats {
  synthetic: boolean;
  retry: {
    plan: { try: number; afterSeconds: number; atSeconds: number }[];
    tries: number;
    totalSeconds: number;
    honoursRetryAfter: true;
    next: { try: number; inSeconds: number; last: string } | null;
  };
  latency: {
    n: number;
    timeoutSeconds: number;
    p50Ms: number;
    p95Ms: number;
    timedOut: number;
    timedOutShare: number;
    hint: { raiseTimeout: boolean; suggestedSeconds: number | null };
    points: { ms: number; outcome: CallOutcome }[];
  };
  acl: {
    maxAgeSeconds: number;
    total: number;
    confirmed: number;
    stale: number;
    failClosed: number;
    share: number;
  };
}

export type RotateResult =
  | { status: "pending"; needs: "second_person"; name: string }
  | { status: "rotated"; name: string; rotatedAt: string };

// ---- health ----

export interface HeatCell {
  attempts: number;
  delivered: number;
  failed: number;
  failing: boolean;
  topReason: FailureReason | null;
  ruleRef: string | null;
}

export interface HeatRow {
  id: string;
  kind: "brain" | "source";
  label: string;
  total: number;
  failed: number;
  cells: HeatCell[];
}

export interface HealthResponse {
  window: HealthWindow;
  generatedAt: string;
  scope: "tenant" | "stewards";
  synthetic: boolean;
  slo: number;
  success: { attempts: number; delivered: number; failed: number; rate: number };
  outcomes: { firstTry: number; recovered: number; failing: number };
  failures: { reason: FailureReason; count: number; share: number }[];
  heatmap: { columnMs: number; columns: string[]; rows: HeatRow[] };
  totals: { attempts: number; delivered: number; failed: number };
}
