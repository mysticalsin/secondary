/**
 * One erasure request per subject. The ledger remembers each step and the grant
 * that approved it. Callers perform the effects and pass the clock in. This module
 * does not read one. A row resumes only when two different people approved that
 * subject and every plan step is inside that grant. A missing grant, the same
 * person twice, a mismatched subject, a corrupt ledger, an unknown status or mark,
 * an unknown step, and a completed row whose marks are not all done are unreadable.
 * Loading does not rewrite that row. Rows stored before the grant existed have
 * none, so they are unreadable too.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type ErasureStatus =
  | { tag: "absent" }
  | { tag: "unreadable" }
  | { tag: "requested" }
  | { tag: "running" }
  | { tag: "completed" }
  | { tag: "partial_failed" };

export type StepMark = "pending" | "done" | "failed";

/** The two people who approved this subject, and the steps they approved. */
export type ErasureGrant = {
  subject: string;
  requester: string;
  confirmer: string;
  steps: string[];
};

/**
 * One scan of the receipt bucket. `done` has no cursor. `partial` is the next page.
 * `failed` keeps the last good cursor when there is one. `rejected` is not a position.
 */
export type ReceiptErase =
  | { tag: "done"; rewritten: number }
  | { tag: "partial"; rewritten: number; cursor: string }
  | { tag: "failed"; reason: "unavailable" | "refused" | "malformed"; rewritten: number; cursor: string | null }
  | { tag: "rejected" };

export type StoredErasure = {
  status: ErasureStatus;
  order: string[];
  mark: Record<string, StepMark>;
  grant: ErasureGrant | null;
  /** Absent on rows from before the receipt cursor. That starts the scan again. */
  receipts: ReceiptErase | null;
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

/** A known stored word. Anything else, including null and legacy, is unreadable. */
export function decodeErasureStatus(status: unknown): Exclude<ErasureStatus, { tag: "absent" }> {
  if (
    status === "unreadable" ||
    status === "requested" ||
    status === "running" ||
    status === "completed" ||
    status === "partial_failed"
  )
    return { tag: status };
  return { tag: "unreadable" };
}

/** A known step mark. Anything else is not a mark. */
export function decodeStepMark(value: unknown): StepMark | null {
  if (value === "pending" || value === "done" || value === "failed") return value;
  return null;
}

const FIXED_STEPS = new Set(["receipts", "tombstone", "personal", "connector", "directory"]);
export const SCOPE_ID = /^[a-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const SCOPE_STEP = "scope:";

/** The scope id inside a step, or null when the step is not exactly scope: plus that id. */
export function scopeIdOfStep(step: string): string | null {
  if (!step.startsWith(SCOPE_STEP)) return null;
  const id = step.slice(SCOPE_STEP.length);
  return SCOPE_ID.test(id) ? id : null;
}

/** A step the erasure plan can name: a fixed name, or scope: plus one scope id. */
export function knownErasureStep(id: string): boolean {
  return FIXED_STEPS.has(id) || scopeIdOfStep(id) !== null;
}

export function absentErasure(): StoredErasure {
  return { status: { tag: "absent" }, order: [], mark: {}, grant: null, receipts: null };
}

/** A row the caller must not resume. Decoding it does not write. */
export function unreadableErasure(): StoredErasure {
  return { status: { tag: "unreadable" }, order: [], mark: {}, grant: null, receipts: null };
}

/**
 * Resume only when both approvers are present and distinct, the subject is the
 * one they approved, and every plan step is one of the approved steps.
 */
export function erasureGrantOk(
  grant: ErasureGrant | null,
  subject: string,
  plan: readonly string[],
): boolean {
  if (!grant || subject === "") return false;
  if (grant.subject !== subject) return false;
  if (grant.requester === "" || grant.confirmer === "" || grant.requester === grant.confirmer)
    return false;
  return plan.every((step) => grant.steps.includes(step));
}

function readGrant(value: unknown): ErasureGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.subject !== "string" || typeof raw.requester !== "string" || typeof raw.confirmer !== "string")
    return null;
  if (!Array.isArray(raw.steps) || !raw.steps.every((step) => typeof step === "string")) return null;
  return { subject: raw.subject, requester: raw.requester, confirmer: raw.confirmer, steps: raw.steps };
}

/**
 * No row is absent. A row resumes only when every step is a plan step and every mark
 * is pending, done, or failed. Anything else is unreadable and is not rewritten here.
 */
export function decodeErasure(row: { status: unknown; order: unknown; mark: unknown } | null): StoredErasure {
  if (!row) return absentErasure();
  if (row.status === "unreadable") return unreadableErasure();
  if (!Array.isArray(row.order) || row.order.length === 0) return unreadableErasure();
  const order: string[] = [];
  for (const id of row.order) {
    if (typeof id !== "string" || !knownErasureStep(id)) return unreadableErasure();
    order.push(id);
  }
  if (row.mark === null || typeof row.mark !== "object" || Array.isArray(row.mark))
    return unreadableErasure();
  const raw = row.mark as Record<string, unknown>;
  const mark: Record<string, StepMark> = {};
  for (const id of order) {
    const step = decodeStepMark(raw[id]);
    if (!step) return unreadableErasure();
    mark[id] = step;
  }
  const decoded = decodeErasureStatus(row.status);
  if (decoded.tag === "unreadable") return unreadableErasure();
  if (decoded.tag === "completed" && !allDone(order, mark)) return unreadableErasure();
  return { status: decoded, order, mark, grant: null, receipts: null };
}

function wholeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * A cursor the audit worker handed back. A missing, empty, numeric, `legacy`,
 * or `unknown` value starts the scan again. It is never sent on as a skip.
 */
export function decodeReceiptCursor(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value === "legacy" || value === "unknown") return null;
  return value;
}

/** A stored receipt scan. A bad shape is `rejected`, which is not `done` and not a cursor. */
export function decodeReceiptErase(value: unknown): ReceiptErase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { tag: "rejected" };
  const raw = value as Record<string, unknown>;
  const rewritten = wholeCount(raw.rewritten);
  if (raw.tag === "done") {
    if (rewritten === null || raw.cursor !== undefined) return { tag: "rejected" };
    return { tag: "done", rewritten };
  }
  if (raw.tag === "partial") {
    if (rewritten === null) return { tag: "rejected" };
    const cursor = decodeReceiptCursor(raw.cursor);
    if (!cursor) return { tag: "rejected" };
    return { tag: "partial", rewritten, cursor };
  }
  if (raw.tag === "failed") {
    if (
      rewritten === null ||
      (raw.reason !== "unavailable" && raw.reason !== "refused" && raw.reason !== "malformed")
    )
      return { tag: "rejected" };
    return { tag: "failed", reason: raw.reason, rewritten, cursor: decodeReceiptCursor(raw.cursor) };
  }
  return { tag: "rejected" };
}

export function decodeErasureLedger(
  row: { status: unknown; ledger: unknown } | null,
  subject = "",
): StoredErasure {
  if (!row) return absentErasure();
  if (typeof row.ledger !== "string") return unreadableErasure();
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.ledger) as unknown;
  } catch {
    return unreadableErasure();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unreadableErasure();
  const body = parsed as { order?: unknown; mark?: unknown; grant?: unknown; receipts?: unknown };
  const state = decodeErasure({ status: row.status, order: body.order, mark: body.mark });
  if (state.status.tag === "absent" || state.status.tag === "unreadable") return state;
  const grant = readGrant(body.grant);
  if (!erasureGrantOk(grant, subject, state.order)) return unreadableErasure();
  const receipts = body.receipts === undefined ? null : decodeReceiptErase(body.receipts);
  return { ...state, grant, receipts };
}

export function encodeErasure(state: StoredErasure): { status: string; ledger: string } {
  const body: {
    order: string[];
    mark: Record<string, StepMark>;
    grant?: ErasureGrant;
    receipts?: ReceiptErase;
  } = { order: state.order, mark: state.mark };
  if (state.grant) body.grant = state.grant;
  if (state.receipts) body.receipts = state.receipts;
  return { status: state.status.tag, ledger: JSON.stringify(body) };
}

/** The positive integer version on a ledger, or 0 when the row has none. */
export function ledgerVersion(ledger: unknown): number {
  if (typeof ledger !== "string") return 0;
  try {
    const body = JSON.parse(ledger) as { v?: unknown };
    return typeof body.v === "number" && Number.isSafeInteger(body.v) && body.v > 0 ? body.v : 0;
  } catch {
    return 0;
  }
}

/** Stamp `version` onto a ledger. Other fields stay. */
export function withLedgerVersion(ledger: string, version: number): string {
  const body = JSON.parse(ledger) as Record<string, unknown>;
  body.v = version;
  return JSON.stringify(body);
}

/**
 * Keep a ledger whose grant already covers its own steps. Newly approved steps
 * join that grant. A missing or invalid grant starts the approved plan instead.
 * The same state comes back when the stored grant already covers the new plan,
 * or when any approved step is not a known step, so the caller writes nothing.
 */
export function erasureWithGrant(existing: StoredErasure, grant: ErasureGrant): StoredErasure {
  if (grant.steps.some((id) => !knownErasureStep(id))) return existing;
  if (!erasureGrantOk(existing.grant, grant.subject, existing.order) || !existing.grant) {
    const fresh = requestedFrom(grant.steps);
    if (!fresh) return existing;
    return { ...fresh, grant };
  }
  if (erasureGrantOk(existing.grant, grant.subject, grant.steps)) return existing;
  const steps = [...new Set([...existing.grant.steps, ...grant.steps])];
  return { ...existing, grant: { ...grant, steps } };
}

const REPORT_MAX = 100;

function reportBound(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) return fallback;
  return Math.min(value, REPORT_MAX);
}

/**
 * Count unreadable ledgers. Ids are omitted unless includeIds is set.
 * Nothing here writes, and the result does not carry scope ids.
 */
export function reportUnreadableLedgers(
  rows: readonly { principalId: string; status: string; ledger: string }[],
  options?: { includeIds?: boolean; limit?: number; cap?: number },
): { unreadable: number; principalIds: number | readonly string[]; truncated: boolean } {
  const limit = reportBound(options?.limit, rows.length);
  const cap = reportBound(options?.cap, limit);
  const bad = rows
    .slice(0, limit)
    .filter((row) => decodeErasureLedger(row, row.principalId).status.tag === "unreadable");
  const shown = bad.slice(0, cap);
  if (options?.includeIds === true) {
    return {
      unreadable: bad.length,
      principalIds: shown.map((row) => row.principalId),
      truncated: bad.length > cap,
    };
  }
  return { unreadable: bad.length, principalIds: shown.length, truncated: false };
}

/** Receipts, the tombstone, each company scope, the personal brain, the connector, then the directory. */
export function erasurePlan(companyScopes: readonly string[]): string[] {
  if (companyScopes.some((scope) => !SCOPE_ID.test(scope))) throw new Error("invalid_scope");
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
  if (!SCOPE_ID.test(scope)) throw new Error("invalid_scope");
  return [`scope:${scope}`];
}

export function erasureOutcome(state: StoredErasure): { status: ErasureStatus["tag"]; step: string | null } {
  return { status: state.status.tag, step: incomplete(state) };
}

function allDone(order: readonly string[], mark: Record<string, StepMark>): boolean {
  return order.length > 0 && order.every((id) => mark[id] === "done");
}

function sameErasure(left: StoredErasure, right: StoredErasure): boolean {
  if (left.status.tag !== right.status.tag || left.order.length !== right.order.length) return false;
  for (let i = 0; i < left.order.length; i++) {
    const id = left.order[i];
    if (id !== right.order[i] || left.mark[id] !== right.mark[id]) return false;
  }
  return JSON.stringify(left.receipts ?? null) === JSON.stringify(right.receipts ?? null);
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

function requestedFrom(steps: readonly string[]): StoredErasure | null {
  if (steps.some((id) => !knownErasureStep(id))) return null;
  const order = [...new Set(steps)];
  const mark: Record<string, StepMark> = {};
  for (const id of order) mark[id] = "pending";
  return { status: { tag: "requested" }, order, mark, grant: null, receipts: null };
}

function addSteps(state: StoredErasure, steps: readonly string[]): StoredErasure | null {
  if (steps.some((id) => !knownErasureStep(id))) return null;
  const order = [...state.order];
  const mark = { ...state.mark };
  for (const id of steps) {
    if (order.includes(id)) continue;
    order.push(id);
    mark[id] = "pending";
  }
  return { ...state, order, mark };
}

function reopen(state: StoredErasure, steps: readonly string[]): StoredErasure | null {
  if (steps.some((id) => !knownErasureStep(id))) return null;
  const order = [...state.order];
  const mark = { ...state.mark };
  for (const id of steps) {
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
    if (event.steps.some((id) => !knownErasureStep(id)))
      return reject(MACHINE, state.status.tag, event.type, "unknown_step");
    if (
      state.status.tag === "absent" ||
      state.status.tag === "unreadable" ||
      state.order.length === 0
    ) {
      const fresh = requestedFrom(event.steps);
      if (!fresh) return reject(MACHINE, state.status.tag, event.type, "unknown_step");
      return allow(fresh, []);
    }
    if (state.status.tag === "completed") {
      const next = addSteps(state, event.steps);
      if (!next) return reject(MACHINE, state.status.tag, event.type, "unknown_step");
      if (next.order.length === state.order.length) return allow(state, []);
      return proceed(next);
    }
    const notDone = (id: string) => state.mark[id] !== "done";
    const done = state.order.filter((id) => id && !notDone(id));
    const rest: string[] = [];
    for (const id of event.steps) {
      if (!id || !notDone(id) || rest.includes(id)) continue;
      rest.push(id);
    }
    for (const id of state.order) {
      if (!id || !notDone(id) || rest.includes(id)) continue;
      rest.push(id);
    }
    const place = (id: string) =>
      id === "receipts" ? 0
      : id === "tombstone" ? 1
      : scopeIdOfStep(id) ? 2
      : id === "personal" ? 3
      : id === "connector" ? 4
      : id === "directory" ? 5
      : 6;
    const pending = rest.filter((id) => place(id) < 6).sort((a, b) => place(a) - place(b));
    const order = [...done, ...pending];
    const mark: Record<string, StepMark> = {};
    for (const id of done) mark[id] = "done";
    for (const id of pending) mark[id] = "pending";
    return allow({ ...state, order, mark }, []);
  }
  if (event.type === "resume") {
    if (state.status.tag === "absent" || state.status.tag === "unreadable")
      return reject(MACHINE, state.status.tag, event.type, "not_started");
    if (state.status.tag === "completed") return allow(state, []);
    return proceed(state);
  }
  if (event.type === "restore") {
    if (event.steps.some((id) => !knownErasureStep(id)))
      return reject(MACHINE, state.status.tag, event.type, "unknown_step");
    const empty = requestedFrom([]);
    const base =
      state.status.tag === "absent" || state.status.tag === "unreadable" ? (empty ?? state) : state;
    const reopened = reopen(base, event.steps);
    if (!reopened) return reject(MACHINE, state.status.tag, event.type, "unknown_step");
    return proceed(reopened);
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
  perform: (step: string, report: (progress: ReceiptErase) => Promise<void>) => Promise<boolean>,
  persist: (state: StoredErasure) => Promise<void>,
): Promise<StoredErasure> {
  let step = commitErasure(state, event);
  if (!step.ok) return state;
  let current = step.state;
  if (!sameErasure(state, current)) await persist(current);
  if (!step.effects.some((effect) => effect.type === "run") && current.status.tag !== "completed") {
    const prior = current;
    step = commitErasure(current, { type: "resume", now: event.now });
    if (!step.ok) return current;
    current = step.state;
    if (!sameErasure(prior, current)) await persist(current);
  }
  const report = async (progress: ReceiptErase) => {
    const next = { ...current, receipts: progress };
    await persist(next);
    current = next;
  };
  while (true) {
    const run = step.effects.find((effect) => effect.type === "run");
    if (!run) return current;
    let ok = false;
    try {
      ok = await perform(run.step, report);
    } catch {
      ok = false;
    }
    const prior = current;
    step = commitErasure(current, {
      type: ok ? "step_done" : "step_failed",
      now: event.now,
      step: run.step,
    });
    if (!step.ok) return current;
    current = step.state;
    if (!sameErasure(prior, current)) await persist(current);
  }
}
