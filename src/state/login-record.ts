/**
 * One-shot Entra login record. Issued once, then consumed by every terminal
 * callback. A consumed record accepts nothing, so the same state cannot be replayed.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type LoginRecordState = { tag: "issued" } | { tag: "consumed" };

export type LoginRecordEvent =
  | { type: "idp_error" }
  | { type: "missing_state" }
  | { type: "state_mismatch" }
  | { type: "exchange_failed" }
  | { type: "accepted" };

export type LoginRecordEffect = { type: "take" };

export type LoginRecordStep =
  | { ok: true; state: LoginRecordState; effects: LoginRecordEffect[] }
  | IllegalTransition;

const consume = (): LoginRecordStep => ({
  ok: true,
  state: { tag: "consumed" },
  effects: [{ type: "take" }],
});

export function transitionLoginRecord(
  state: LoginRecordState,
  event: LoginRecordEvent,
): LoginRecordStep {
  if (state.tag === "consumed") {
    return reject("login_record", state.tag, event.type, "the login state was already used");
  }
  return consume();
}

export const commitLoginRecord = (
  state: LoginRecordState,
  event: LoginRecordEvent,
): LoginRecordStep => commit(transitionLoginRecord(state, event));
