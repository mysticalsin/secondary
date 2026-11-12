/**
 * Kill switch flag. Absence is on. The stored cell is 0 or 1.
 * Anything else is corrupt. Prod re-enable is the quorum result, not a second flag machine.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";
import { quorumConfirmed, type QuorumResult } from "./quorum.ts";

export type SwitchFlag = { tag: "on" } | { tag: "off" } | { tag: "corrupt" };

export type SwitchEvent =
  | { type: "turn_off"; now: number }
  | { type: "turn_on"; now: number; twoPerson: false }
  | { type: "turn_on"; now: number; twoPerson: true; quorum: QuorumResult };

export type SwitchEffect = { type: "write"; enabled: boolean } | { type: "clear_pending" };

export type SwitchStep =
  | {
      ok: true;
      state: { tag: "on" } | { tag: "off" };
      effects: SwitchEffect[];
      status: "applied" | "pending" | "replay" | "refused";
      sameActor?: boolean;
    }
  | IllegalTransition;

/** 1 is on, 0 is off. Every other stored value is corrupt. */
export function decodeSwitchEnabled(value: unknown): SwitchFlag {
  if (value === 1) return { tag: "on" };
  if (value === 0) return { tag: "off" };
  return { tag: "corrupt" };
}

function appliedOff(): SwitchStep {
  return {
    ok: true,
    state: { tag: "off" },
    effects: [
      { type: "write", enabled: false },
      { type: "clear_pending" },
    ],
    status: "applied",
  };
}

function appliedOn(effects: SwitchEffect[]): SwitchStep {
  return { ok: true, state: { tag: "on" }, effects, status: "applied" };
}

export function transitionSwitch(state: SwitchFlag, event: SwitchEvent): SwitchStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("kill_switch", state.tag, event.type, "clock_unreadable");
  }
  if (event.type === "turn_off") return appliedOff();
  if (state.tag === "corrupt") return reject("kill_switch", "corrupt", event.type, "corrupt_value");
  if (state.tag === "on") return appliedOn([]);
  if (!event.twoPerson || quorumConfirmed(event.quorum)) {
    return appliedOn([{ type: "write", enabled: true }]);
  }
  if (event.quorum.tag === "replay" || event.quorum.tag === "refused") {
    return { ok: true, state, effects: [], status: event.quorum.tag };
  }
  return {
    ok: true,
    state,
    effects: [],
    status: "pending",
    sameActor: event.quorum.tag === "same_actor",
  };
}

export const commitSwitch = (state: SwitchFlag, event: SwitchEvent): SwitchStep =>
  commit(transitionSwitch(state, event));
