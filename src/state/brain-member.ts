/**
 * Brain member. A set is legal from absent, pending, or active.
 * An unknown stored word is not a member and writes nothing.
 * The caller writes with a from-state predicate and keeps the log when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type MemberState =
  | { tag: "absent" }
  | { tag: "pending" }
  | { tag: "active" }
  | { tag: "unknown" };

export type MemberEvent = { type: "set"; state: "active" | "pending"; now: number };

export type MemberEffect = { type: "write"; state: "active" | "pending" };

export type MemberStep =
  | { ok: true; state: MemberState; effects: MemberEffect[] }
  | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not log. */
export function claimMember(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored state. Anything else is unknown and grants nothing. */
export function decodeMember(state: unknown): MemberState {
  if (state === "pending" || state === "active") return { tag: state };
  return { tag: "unknown" };
}

/** A membership grants its role only when the row is finished and active. A claim and a pending row do not. */
export function grantsMemberRole(state: unknown): boolean {
  return state === "active";
}

export function transitionMember(state: MemberState, event: MemberEvent): MemberStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("brain_member", state.tag, event.type, "clock_unreadable");
  }
  if (state.tag === "unknown") return reject("brain_member", state.tag, event.type, "state_unreadable");
  return {
    ok: true,
    state: { tag: event.state },
    effects: [{ type: "write", state: event.state }],
  };
}

export const commitMember = (state: MemberState, event: MemberEvent): MemberStep =>
  commit(transitionMember(state, event));
