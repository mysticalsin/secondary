/**
 * Governance change. Approve, reject, and withdraw are legal only from pending.
 * Expired is a read of a pending row whose expiry has passed. It is not written back.
 * An unknown stored word has no effect. The caller writes with a status predicate
 * and keeps the effect when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type GovernanceState =
  | { tag: "pending" }
  | { tag: "applied" }
  | { tag: "rejected" }
  | { tag: "withdrawn" }
  | { tag: "expired" }
  | { tag: "unknown" };

export type GovernanceEvent =
  | { type: "approve"; now: number }
  | { type: "reject"; now: number }
  | { type: "withdraw"; now: number };

export type GovernanceEffect = { type: "apply" } | { type: "reject" } | { type: "withdraw" };

export type GovernanceStep =
  | { ok: true; state: GovernanceState; effects: GovernanceEffect[] }
  | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not write the effect. */
export function claimGovernance(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored status. A word this table does not know is unknown and has no effect. */
export function decodeGovernance(status: unknown): GovernanceState {
  if (
    status === "pending" ||
    status === "applied" ||
    status === "rejected" ||
    status === "withdrawn" ||
    status === "expired"
  ) {
    return { tag: status };
  }
  return { tag: "unknown" };
}

/**
 * The only clock comparison for a governance change. A pending row at or past its expiry
 * reads as expired. The stored word is left as it was.
 */
export function readGovernance(status: unknown, expiresAt: number, now: number): GovernanceState {
  const decoded = decodeGovernance(status);
  if (decoded.tag !== "pending") return decoded;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { tag: "expired" };
  return { tag: "pending" };
}

export function transitionGovernance(
  state: GovernanceState,
  event: GovernanceEvent,
): GovernanceStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("governance", state.tag, event.type, "clock_unreadable");
  }
  if (state.tag === "unknown") {
    return reject("governance", state.tag, event.type, "state_unreadable");
  }
  if (state.tag === "expired") return reject("governance", state.tag, event.type, "expired");
  if (state.tag !== "pending") return reject("governance", state.tag, event.type, "not_pending");
  if (event.type === "approve") {
    return { ok: true, state: { tag: "applied" }, effects: [{ type: "apply" }] };
  }
  if (event.type === "reject") {
    return { ok: true, state: { tag: "rejected" }, effects: [{ type: "reject" }] };
  }
  return { ok: true, state: { tag: "withdrawn" }, effects: [{ type: "withdraw" }] };
}

export const commitGovernance = (
  state: GovernanceState,
  event: GovernanceEvent,
): GovernanceStep => commit(transitionGovernance(state, event));
