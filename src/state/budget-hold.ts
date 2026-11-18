/**
 * In-memory reservation around one model call. The counter itself stays in
 * the workspace row. Settling twice is rejected so the diff cannot be applied twice.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type BudgetHoldState =
  | { tag: "idle" }
  | { tag: "held"; estimate: number }
  | { tag: "denied" }
  | { tag: "refund"; delta: number }
  | { tag: "settled"; actual: number };

export type BudgetHoldEvent =
  | { type: "reserved"; estimate: number }
  | { type: "denied" }
  | { type: "settle"; actual: number }
  | { type: "refund_due"; delta: number }
  | { type: "cleared" };

export type BudgetHoldEffect = { type: "adjust"; delta: number } | { type: "none" };

export type BudgetHoldStep =
  | { ok: true; state: BudgetHoldState; effects: BudgetHoldEffect[] }
  | IllegalTransition;

export const finiteHoldNumber = (n: number): boolean => typeof n === "number" && Number.isFinite(n);

const none = (state: BudgetHoldState): BudgetHoldStep => ({
  ok: true,
  state,
  effects: [{ type: "none" }],
});

export function transitionBudgetHold(
  state: BudgetHoldState,
  event: BudgetHoldEvent,
): BudgetHoldStep {
  if (
    state.tag !== "idle" &&
    event.type !== "settle" &&
    event.type !== "refund_due" &&
    event.type !== "cleared"
  ) {
    return reject("budget_hold", state.tag, event.type, `${state.tag} does not accept ${event.type}`);
  }
  if (state.tag === "idle" && event.type === "denied") return none({ tag: "denied" });
  if (state.tag === "idle" && event.type === "reserved") {
    if (!finiteHoldNumber(event.estimate)) {
      return reject("budget_hold", "idle", "reserved", "the estimate is not a finite number");
    }
    return none({ tag: "held", estimate: event.estimate });
  }
  if (state.tag === "held" && event.type === "refund_due") {
    if (!finiteHoldNumber(event.delta) || event.delta >= 0) {
      return reject("budget_hold", "held", "refund_due", "the refund is not a negative finite number");
    }
    return none({ tag: "refund", delta: event.delta });
  }
  if (state.tag === "refund" && event.type === "refund_due") return none(state);
  if (state.tag === "refund" && event.type === "cleared")
    return none({ tag: "settled", actual: state.delta });
  if (state.tag === "held" && event.type === "settle") {
    if (!finiteHoldNumber(event.actual)) {
      return reject("budget_hold", "held", "settle", "the actual total is not a finite number");
    }
    const delta = Math.round(event.actual) - state.estimate;
    return {
      ok: true,
      state: { tag: "settled", actual: event.actual },
      effects: delta === 0 ? [{ type: "none" }] : [{ type: "adjust", delta }],
    };
  }
  if (event.type === "settle") {
    return reject(
      "budget_hold",
      state.tag,
      "settle",
      state.tag === "settled" ? "this hold was already settled" : "nothing is held",
    );
  }
  return reject("budget_hold", state.tag, event.type, "that event does not apply");
}

export const commitBudgetHold = (state: BudgetHoldState, event: BudgetHoldEvent): BudgetHoldStep =>
  commit(transitionBudgetHold(state, event));

export interface HoldStore {
  add(tokens: number, cap: number): Promise<number | null>;
}

/** Log a refund that did not land. The line has no amounts. Idempotent repair is later. */
export function logIfRefundFailed(refunded: number | null): void {
  if (refunded === null) console.warn(JSON.stringify({ at: "budget_refund_failed" }));
}

/** Reserve, then settle at most once. A non-finite estimate never reaches the store. */
export async function openHold(
  store: HoldStore,
  estimate: number,
  cap: number,
): Promise<{ settle: (actual: number) => Promise<void> } | null> {
  if (!finiteHoldNumber(estimate)) {
    commitBudgetHold({ tag: "idle" }, { type: "reserved", estimate });
    return null;
  }
  const total = await store.add(estimate, cap);
  const held = commitBudgetHold(
    { tag: "idle" },
    total === null ? { type: "denied" } : { type: "reserved", estimate },
  );
  if (!held.ok || held.state.tag !== "held") return null;
  let hold: BudgetHoldState = held.state;
  let writing = false;
  return {
    settle: async (actual) => {
      if (writing) return;
      writing = true;
      try {
        if (hold.tag === "refund") {
          const wrote = await store.add(hold.delta, Number.MAX_SAFE_INTEGER);
          if (wrote === null) {
            console.warn(JSON.stringify({ at: "budget_refund_failed" }));
            return;
          }
          const cleared = commitBudgetHold(hold, { type: "cleared" });
          if (cleared.ok) hold = cleared.state;
          return;
        }
        const next = commitBudgetHold(hold, { type: "settle", actual });
        if (!next.ok || next.state.tag !== "settled") return;
        for (const effect of next.effects) {
          if (effect.type !== "adjust") continue;
          const wrote = await store.add(effect.delta, Number.MAX_SAFE_INTEGER);
          if (wrote === null && effect.delta < 0) {
            const owed = commitBudgetHold(hold, { type: "refund_due", delta: effect.delta });
            if (owed.ok) hold = owed.state;
            console.warn(JSON.stringify({ at: "budget_refund_failed" }));
            return;
          }
          if (wrote === null) console.warn(JSON.stringify({ at: "budget_adjust_failed" }));
        }
        hold = next.state;
      } finally {
        writing = false;
      }
    },
  };
}

