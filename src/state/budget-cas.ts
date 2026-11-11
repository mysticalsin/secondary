/**
 * Compare-and-set attempts against the day token counter.
 * A cap miss stops immediately. A conflict or a missing row uses another attempt,
 * up to six, and then refuses.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export const CAS_ATTEMPTS = 6;

export type BudgetCasState =
  | { tag: "trying"; attempt: number }
  | { tag: "committed"; total: number }
  | { tag: "refused" };

export type BudgetCasEvent =
  | { type: "over_cap" }
  | { type: "wrote"; total: number }
  | { type: "retry" };

export type BudgetCasEffect = { type: "again" } | { type: "stop" };

export type BudgetCasStep =
  | { ok: true; state: BudgetCasState; effects: BudgetCasEffect[] }
  | IllegalTransition;

/** True when this attempt is not the last of the six. */
export const casAttemptsRemain = (attempt: number): boolean => attempt + 1 < CAS_ATTEMPTS;

const stop = (state: BudgetCasState): BudgetCasStep => ({
  ok: true,
  state,
  effects: [{ type: "stop" }],
});

export function transitionBudgetCas(state: BudgetCasState, event: BudgetCasEvent): BudgetCasStep {
  if (state.tag !== "trying") {
    return reject("budget_cas", state.tag, event.type, "the compare-and-set already finished");
  }
  if (event.type === "over_cap") return stop({ tag: "refused" });
  if (event.type === "wrote") return stop({ tag: "committed", total: event.total });
  if (casAttemptsRemain(state.attempt)) {
    return {
      ok: true,
      state: { tag: "trying", attempt: state.attempt + 1 },
      effects: [{ type: "again" }],
    };
  }
  return stop({ tag: "refused" });
}

export const commitBudgetCas = (state: BudgetCasState, event: BudgetCasEvent): BudgetCasStep =>
  commit(transitionBudgetCas(state, event));

export type StoredBudgetCas = { v: 1; state: BudgetCasState };

const SAFE_CAS: BudgetCasState = { tag: "refused" };

const isState = (v: unknown): v is BudgetCasState => {
  if (!v || typeof v !== "object") return false;
  const s = v as BudgetCasState;
  if (s.tag === "trying") return Number.isInteger(s.attempt) && s.attempt >= 0 && s.attempt < CAS_ATTEMPTS;
  if (s.tag === "committed") return typeof s.total === "number" && Number.isFinite(s.total);
  return s.tag === "refused";
};

export const encodeBudgetCas = (state: BudgetCasState): StoredBudgetCas => ({ v: 1, state });

/** Unknown JSON loads as refused so a reload cannot spend another attempt. */
export function decodeBudgetCas(raw: unknown): BudgetCasState {
  if (!raw || typeof raw !== "object") return SAFE_CAS;
  const rec = raw as { v?: unknown; state?: unknown };
  if (rec.v !== 1 || !isState(rec.state)) return SAFE_CAS;
  return rec.state;
}
