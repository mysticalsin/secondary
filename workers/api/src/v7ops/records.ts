// Turns what the platform already records (audit receipts, the wiki log, connector sync attempts) into
// the one `OpRecord` shape that Activity and Health read. Ids, codes and counts only: a receipt holds no
// content, the wiki log detail is read for two codes, and connector attempts are numbers.

import type { Receipt } from "../../../../packages/contracts/src/audit-receipt.ts";
import {
  eventId,
  type FailureReason,
  type OpActor,
  type OpAttempt,
  type OpRecord,
  type OpsStatus,
  ruleRefOf,
} from "../../../../packages/contracts/src/ops-v7.ts";
import type { AttemptOut } from "./model.ts";

export type Step = {
  kind: "attempt" | "classifier" | "rule" | "review" | "policy";
  label: string;
  state: "ok" | "fail" | "pending" | "skipped";
  at: string | null;
  ms: number | null;
  code: string | null;
};
export type Meta = Record<string, string | number | boolean | null>;
export type Rec = OpRecord & {
  steps: Step[];
  metadata: Meta;
  /** What "Retry ingest" does for this event; null when it cannot be retried. */
  retryKind: "connector" | "ingest" | null;
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** Receipts that put something in front of a person to decide. */
const REVIEWS =
  /(^|[._])(propose|propose_page|propose_change|push|import|meeting|coach_propose|open_request|role_request|write_session_report)($|[._])/;

export async function receiptRec(
  r: Receipt,
  brain: string | null,
  hostLabel: (clientId: string | null) => string,
): Promise<Rec> {
  const agent = r.source === "mcp" || r.clientId !== null;
  const ruleRef = ruleRefOf(r.reason);
  const blocked = r.decision !== "allow";
  const status: OpsStatus = blocked
    ? "blocked"
    : REVIEWS.test(r.action) || (r.tool !== null && REVIEWS.test(r.tool))
      ? "needs_review"
      : "published";
  const reason: FailureReason | null = blocked
    ? ruleRef !== null
      ? "blocked_by_rule"
      : /classif/i.test(r.reason)
        ? "classifier_asked"
        : "permission_denied"
    : null;
  const [ruleId, ruleVersion] = ruleRef ? ruleRef.split("@") : [null, null];
  const steps: Step[] = [
    {
      kind: "policy",
      label: "Policy decision",
      state: blocked ? "fail" : "ok",
      at: r.at,
      ms: null,
      code: r.decision,
    },
  ];
  if (ruleRef)
    steps.push({
      kind: "rule",
      label: `Rule ${ruleRef}`,
      state: blocked ? "fail" : "ok",
      at: r.at,
      ms: null,
      code: ruleRef,
    });
  steps.push(
    status === "needs_review"
      ? {
          kind: "review",
          label: "Waiting for review",
          state: "pending",
          at: null,
          ms: null,
          code: null,
        }
      : status === "published"
        ? { kind: "review", label: "Applied", state: "ok", at: r.at, ms: null, code: null }
        : {
            kind: "review",
            label: "Not applied",
            state: "skipped",
            at: null,
            ms: null,
            code: null,
          },
  );
  const actor: OpActor = agent
    ? { kind: "agent", label: hostLabel(r.clientId) }
    : { kind: "human", label: "Person" };
  return {
    id: await eventId(`receipt:${r.receiptId}`),
    at: Date.parse(r.at),
    origin: "receipt",
    brain,
    sourceId: null,
    // An agent's tool name (`propose_page`) reads as the wiki action it is.
    type: agent && !r.action.includes(".") ? `wiki.${r.action}` : r.action,
    actor,
    status,
    attempts: [blocked ? "fail" : "ok"],
    maxAttempts: 1,
    latencyMs: null,
    reason,
    ruleRef,
    retryable: false,
    steps,
    retryKind: null,
    metadata: {
      receiptId: r.receiptId,
      action: r.action,
      nodeId: r.nodeId,
      scopeId: r.scopeId,
      decision: r.decision,
      requestId: r.requestId,
      clientId: r.clientId,
      tool: r.tool,
      host: agent ? actor.label : null,
      ruleId,
      ruleVersion,
    },
  };
}

const LOG_SYSTEM: OpActor = { kind: "system", label: "Wiki" };
const SOURCE = /^[A-Za-z0-9_:.-]{1,160}$/;

/** A wiki log row as an event, or null when it is not about an ingest, a verdict or a failed job. */
export async function logRec(
  row: { id: number; at: number; kind: string; detail: string },
  brain: string,
): Promise<Rec | null> {
  let d: Record<string, unknown> = {};
  try {
    const v = JSON.parse(row.detail) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) d = v as Record<string, unknown>;
  } catch {
    // an unreadable detail is treated as empty
  }
  const sourceId = typeof d.sourceId === "string" && SOURCE.test(d.sourceId) ? d.sourceId : null;
  const base = {
    id: await eventId(`log:${brain}:${row.id}`),
    at: row.at,
    origin: "ingest" as const,
    brain,
    sourceId,
    actor: LOG_SYSTEM,
    maxAttempts: 1,
    latencyMs: null,
    ruleRef: null,
  };
  const at = iso(row.at);
  if (row.kind === "ingest.triage") {
    // Only the two codes the ingest writes: anything else in the detail is not shown.
    const result =
      d.result === "unchanged" || d.result === "no new information" ? d.result : "triaged";
    return {
      ...base,
      type: "ingest.run",
      status: "published",
      attempts: ["ok"],
      reason: null,
      retryable: false,
      retryKind: null,
      steps: [
        {
          kind: "classifier",
          label: `Classifier verdict: ${result}`,
          state: "ok",
          at,
          ms: null,
          code: result,
        },
      ],
      metadata: { logId: row.id, kind: row.kind, sourceId, verdict: result },
    };
  }
  if (row.kind === "ingest.skipped")
    return {
      ...base,
      type: "classifier.ask",
      status: "needs_review",
      attempts: ["ok"],
      reason: "classifier_asked",
      retryable: false,
      retryKind: null,
      steps: [
        {
          kind: "classifier",
          label: "Classifier verdict: ask",
          state: "pending",
          at,
          ms: null,
          code: "ask",
        },
        {
          kind: "review",
          label: "Waiting for a person",
          state: "pending",
          at: null,
          ms: null,
          code: null,
        },
      ],
      metadata: { logId: row.id, kind: row.kind, sourceId, verdict: "ask" },
    };
  if (row.kind.endsWith(".failed")) {
    const job = row.kind.split(".")[0] as string;
    const canRetry = job === "ingest" && sourceId !== null;
    return {
      ...base,
      type: `${job}.run`,
      status: "failed",
      attempts: ["fail"],
      reason: "parse_error",
      retryable: canRetry,
      retryKind: canRetry ? "ingest" : null,
      steps: [{ kind: "attempt", label: "Run", state: "fail", at, ms: null, code: "error" }],
      metadata: { logId: row.id, kind: row.kind, sourceId },
    };
  }
  return null;
}

const CODES: Record<string, string> = {
  graph_429: "429",
  timeout: "timeout",
  permission_denied: "403",
  parse_error: "error",
  blocked_by_rule: "blocked",
  classifier_asked: "ask",
};

/**
 * Sync attempts as events. A streak of failures that ends in a success is one event ("recovered on
 * retry"); a streak still going is one event, retrying until the policy gives up, then failed.
 */
export async function connectorRecs(
  src: { id: string; name: string; scopeId: string },
  attempts: AttemptOut[],
  brain: string | null,
  maxAttempts: number,
): Promise<Rec[]> {
  const out: Rec[] = [];
  const stepOf = (a: AttemptOut, i: number): Step => ({
    kind: "attempt",
    label: `Try ${i + 1}`,
    state: a.outcome === "ok" ? "ok" : "fail",
    at: iso(a.at),
    ms: a.ms,
    code: a.outcome === "ok" ? "200" : (CODES[a.reason ?? "parse_error"] ?? "error"),
  });
  const make = async (group: AttemptOut[], final: AttemptOut, status: OpsStatus): Promise<Rec> => {
    const fails = group.length;
    const all = [...group, ...(final.outcome === "ok" ? [final] : [])];
    const outcomes: OpAttempt[] = all.map((a) => (a.outcome === "ok" ? "ok" : "fail"));
    if (status === "retrying") outcomes.push("scheduled");
    const steps = all.map(stepOf);
    if (status === "retrying")
      steps.push({
        kind: "attempt",
        label: `Try ${all.length + 1}`,
        state: "pending",
        at: null,
        ms: null,
        code: "scheduled",
      });
    return {
      id: await eventId(`conn:${src.id}:${(group[0] ?? final).at}`),
      at: final.at,
      origin: "connector",
      brain,
      sourceId: src.id,
      type: "connector.sync",
      actor: { kind: "connector", label: src.name },
      status,
      attempts: outcomes,
      maxAttempts,
      latencyMs: final.ms,
      reason: final.outcome === "ok" ? null : final.reason,
      ruleRef: null,
      retryable: status === "failed" || status === "retrying",
      retryKind: status === "failed" || status === "retrying" ? "connector" : null,
      steps,
      metadata: {
        sourceId: src.id,
        scopeId: src.scopeId,
        tries: fails + (final.outcome === "ok" ? 1 : 0),
      },
    };
  };
  let group: AttemptOut[] = [];
  for (const a of attempts) {
    if (a.outcome !== "ok") {
      group.push(a);
      continue;
    }
    out.push(await make(group, a, "published"));
    group = [];
  }
  const last = group[group.length - 1];
  if (last) out.push(await make(group, last, group.length >= maxAttempts ? "failed" : "retrying"));
  return out;
}

export type Filters = { status: "all" | "needs_review" | "blocked" | "failed"; q: string };

const isFailedKind = (s: OpsStatus): boolean => s === "failed" || s === "retrying";

export function matches(r: OpRecord, f: Filters): boolean {
  if (f.status === "needs_review" && r.status !== "needs_review") return false;
  if (f.status === "blocked" && r.status !== "blocked") return false;
  if (f.status === "failed" && !isFailedKind(r.status)) return false;
  const q = f.q.toLowerCase();
  if (!q) return true;
  return [r.type, r.actor.label, r.id, r.ruleRef ?? ""].some((v) => v.toLowerCase().includes(q));
}

export type EventOut = {
  id: string;
  type: string;
  source: OpActor;
  status: OpsStatus;
  attempts: { count: number; max: number; outcomes: OpAttempt[] };
  latencyMs: number | null;
  at: string;
  reason: FailureReason | null;
  ruleRef: string | null;
  retryable: boolean;
};

export const eventOut = (r: OpRecord): EventOut => ({
  id: r.id,
  type: r.type,
  source: r.actor,
  status: r.status,
  attempts: {
    count: r.attempts.filter((a) => a !== "scheduled").length,
    max: r.maxAttempts,
    outcomes: r.attempts,
  },
  latencyMs: r.latencyMs,
  at: iso(r.at),
  reason: r.reason,
  ruleRef: r.ruleRef,
  retryable: r.retryable,
});
