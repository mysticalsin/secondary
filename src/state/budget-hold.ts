/**
 * In-memory reservation around one model call. The counter itself stays in
 * the workspace row. Settling twice is rejected so the diff cannot be applied twice.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type BudgetHoldState =
  | { tag: "idle" }
  | { tag: "held"; estimate: number }
  | { tag: "denied" }
  | { tag: "settled"; actual: number };

export type BudgetHoldEvent =
  | { type: "reserved"; estimate: number }
  | { type: "denied" }
  | { type: "settle"; actual: number };

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
  if (state.tag !== "idle" && event.type !== "settle") {
    return reject("budget_hold", state.tag, event.type, `${state.tag} does not accept ${event.type}`);
  }
  if (state.tag === "idle" && event.type === "denied") return none({ tag: "denied" });
  if (state.tag === "idle" && event.type === "reserved") {
    if (!finiteHoldNumber(event.estimate)) {
      return reject("budget_hold", "idle", "reserved", "the estimate is not a finite number");
    }
    return none({ tag: "held", estimate: event.estimate });
  }
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
  return {
    settle: async (actual) => {
      const next = commitBudgetHold(hold, { type: "settle", actual });
      if (!next.ok || next.state.tag !== "settled") return;
      hold = next.state;
      for (const effect of next.effects) {
        if (effect.type === "adjust") await store.add(effect.delta, Number.MAX_SAFE_INTEGER);
      }
    },
  };
}

