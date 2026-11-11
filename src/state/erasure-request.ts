/**
 * One erasure request per subject. The ledger remembers each step.
 * Callers perform the effects and pass the clock in. This module does not read one.
 * A stored word other than the four states is partial_failed, so a resume continues
 * and a completed report requires a ledger whose steps are all done.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type ErasureStatus =
  | { tag: "absent" }
  | { tag: "requested" }
  | { tag: "running" }
  | { tag: "completed" }
  | { tag: "partial_failed" };

export type StepMark = "pending" | "done" | "failed";

export type StoredErasure = {
  status: ErasureStatus;
  order: string[];
  mark: Record<string, StepMark>;
};

export type ErasureEvent =
  | { type: "request"; now: number; steps: readonly string[] }
  | { type: "resume"; now: number }
  | { type: "restore"; now: number; steps: readonly string[] }
  | { type: "step_done"; now: number; step: string }
  | { type: "step_failed"; now: number; step: string };

export type ErasureEffect = { type: "run"; step: string };

export type ErasureStep =
  | { ok: true; state: StoredErasure; effects: ErasureEffect[] }
  | IllegalTransition;

const MACHINE = "erasure_request";

/** A known stored word. Anything else, including null and legacy, is partial_failed. */
export function decodeErasureStatus(status: unknown): Exclude<ErasureStatus, { tag: "absent" }> {
  if (
    status === "requested" ||
    status === "running" ||
    status === "completed" ||
    status === "partial_failed"
  )
    return { tag: status };
  return { tag: "partial_failed" };
}

/** A known step mark. Anything else is failed, so the step runs again. */
export function decodeStepMark(value: unknown): StepMark {
  if (value === "pending" || value === "done" || value === "failed") return value;
  return "failed";
}

export function absentErasure(): StoredErasure {
  return { status: { tag: "absent" }, order: [], mark: {} };
}

/** No row is absent. A row whose ledger cannot prove completion is partial_failed. */
export function decodeErasure(row: { status: unknown; order: unknown; mark: unknown } | null): StoredErasure {
  if (!row) return absentErasure();
  const order = Array.isArray(row.order)
    ? row.order.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  const raw =
    row.mark !== null && typeof row.mark === "object"
      ? (row.mark as Record<string, unknown>)
      : {};
  const mark: Record<string, StepMark> = {};
  for (const id of order) mark[id] = decodeStepMark(raw[id]);
  const decoded = decodeErasureStatus(row.status);
  const status = decoded.tag === "completed" && !allDone(order, mark) ? { tag: "partial_failed" as const } : decoded;
  return { status, order, mark };
}

export function decodeErasureLedger(row: { status: unknown; ledger: unknown } | null): StoredErasure {
  if (!row) return absentErasure();
  let parsed: { order?: unknown; mark?: unknown } = {};
  if (typeof row.ledger === "string") {
    try {
      const value = JSON.parse(row.ledger) as { order?: unknown; mark?: unknown };
      if (value && typeof value === "object") parsed = value;
    } catch {
      parsed = {};
    }
  }
  return decodeErasure({ status: row.status, order: parsed.order, mark: parsed.mark });
}

export function encodeErasure(state: StoredErasure): { status: string; ledger: string } {
  return {
    status: state.status.tag,
    ledger: JSON.stringify({ order: state.order, mark: state.mark }),
  };
}

/** Receipts, the tombstone, each company scope, the personal brain, the connector, then the directory. */
export function erasurePlan(companyScopes: readonly string[]): string[] {
  return [
    "receipts",
    "tombstone",
    ...companyScopes.map((scope) => `scope:${scope}`),
    "personal",
    "connector",
    "directory",
  ];
}

/** The steps a restore put back. The same runner performs them. */
export function stepsForRestore(
  kind: "tenant" | "workspace",
  scope: string,
  principalId: string,
): string[] {
  if (kind === "tenant") return ["directory"];
  if (scope === `personal:${principalId}`) return ["personal"];
  if (scope.startsWith("personal:")) return [];
  return [`scope:${scope}`];
}

export function erasureOutcome(state: StoredErasure): { status: ErasureStatus["tag"]; step: string | null } {
  return { status: state.status.tag, step: incomplete(state) };
}

function allDone(order: readonly string[], mark: Record<string, StepMark>): boolean {
  return order.length > 0 && order.every((id) => mark[id] === "done");
}

function incomplete(state: StoredErasure): string | null {
  for (const id of state.order) if (state.mark[id] !== "done") return id;
  return null;
}

const allow = (state: StoredErasure, effects: ErasureEffect[]): ErasureStep => ({
  ok: true,
  state,
  effects,
});

function clock(state: StoredErasure, event: ErasureEvent): ErasureStep | null {
  if (!Number.isSafeInteger(event.now))
    return reject(MACHINE, state.status.tag, event.type, "clock_unreadable");
  return null;
}

function requestedFrom(steps: readonly string[]): StoredErasure {
  const order = [...new Set(steps.filter((id) => id !== ""))];
  const mark: Record<string, StepMark> = {};
  for (const id of order) mark[id] = "pending";
  return { status: { tag: "requested" }, order, mark };
}

function addSteps(state: StoredErasure, steps: readonly string[]): StoredErasure {
  const order = [...state.order];
  const mark = { ...state.mark };
  for (const id of steps) {
    if (!id || order.includes(id)) continue;
    order.push(id);
    mark[id] = "pending";
  }
  return { ...state, order, mark };
}

function reopen(state: StoredErasure, steps: readonly string[]): StoredErasure {
  const order = [...state.order];
  const mark = { ...state.mark };
  for (const id of steps) {
    if (!id) continue;
    if (!order.includes(id)) order.push(id);
    mark[id] = "pending";
  }
  return { ...state, order, mark };
}

/** Continue from the first step that is not done. An empty ledger is not completion. */
function proceed(state: StoredErasure): ErasureStep {
  const step = incomplete(state);
  if (step) return allow({ ...state, status: { tag: "running" } }, [{ type: "run", step }]);
  if (state.order.length === 0) return allow({ ...state, status: { tag: "partial_failed" } }, []);
  return allow({ ...state, status: { tag: "completed" } }, []);
}

export function transitionErasure(state: StoredErasure, event: ErasureEvent): ErasureStep {
  const badClock = clock(state, event);
  if (badClock) return badClock;
  if (event.type === "request") {
    if (state.status.tag === "absent" || state.order.length === 0)
      return allow(requestedFrom(event.steps), []);
    if (state.status.tag === "completed") return allow(state, []);
    return allow(addSteps(state, event.steps), []);
  }
  if (event.type === "resume") {
    if (state.status.tag === "absent") return reject(MACHINE, state.status.tag, event.type, "not_started");
    if (state.status.tag === "completed") return allow(state, []);
    return proceed(state);
  }
  if (event.type === "restore") {
    const base = state.status.tag === "absent" ? requestedFrom([]) : state;
    return proceed(reopen(base, event.steps));
  }
  if (state.status.tag !== "running") return reject(MACHINE, state.status.tag, event.type, "not_running");
  if (!state.order.includes(event.step)) return reject(MACHINE, state.status.tag, event.type, "unknown_step");
  const mark = {
    ...state.mark,
    [event.step]: event.type === "step_done" ? ("done" as const) : ("failed" as const),
  };
  if (event.type === "step_failed")
    return allow({ ...state, mark, status: { tag: "partial_failed" } }, []);
  return proceed({ ...state, mark });
}

export const commitErasure = (state: StoredErasure, event: ErasureEvent): ErasureStep =>
  commit(transitionErasure(state, event));

/**
 * Apply one opening event, then perform each run effect until the ledger stops.
 * The caller persists after every accepted transition and performs the named step.
 */
export async function runErasure(
  state: StoredErasure,
  event: ErasureEvent,
  perform: (step: string) => Promise<boolean>,
  persist: (state: StoredErasure) => Promise<void>,
): Promise<StoredErasure> {
  let step = commitErasure(state, event);
  if (!step.ok) return state;
  let current = step.state;
  await persist(current);
  if (!step.effects.some((effect) => effect.type === "run") && current.status.tag !== "completed") {
    step = commitErasure(current, { type: "resume", now: event.now });
    if (!step.ok) return current;
    current = step.state;
    await persist(current);
  }
  while (true) {
    const run = step.effects.find((effect) => effect.type === "run");
    if (!run) return current;
    let ok = false;
    try {
      ok = await perform(run.step);
    } catch {
      ok = false;
    }
    step = commitErasure(current, {
      type: ok ? "step_done" : "step_failed",
      now: event.now,
      step: run.step,
    });
    if (!step.ok) return current;
    current = step.state;
    await persist(current);
  }
}
