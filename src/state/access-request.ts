/**
 * Access request. Approve and deny are legal only from pending.
 * Reopen is legal only from approved.
 * A fulfilling change grants or denies a pending or approved request, and nothing else.
 * The caller writes with a status predicate and keeps the effect when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type AccessRequestState =
  | { tag: "pending" }
  | { tag: "approved" }
  | { tag: "granted" }
  | { tag: "denied" }
  | { tag: "unknown" };

export type AccessRequestEvent =
  | { type: "approve"; now: number }
  | { type: "deny"; now: number }
  | { type: "reopen" }
  | { type: "grant"; now: number }
  | { type: "reject"; now: number };

export type AccessRequestEffect =
  | { type: "approve" }
  | { type: "deny" }
  | { type: "reopen" }
  | { type: "grant" }
  | { type: "reject" };

export type AccessRequestStep =
  | { ok: true; state: AccessRequestState; effects: AccessRequestEffect[] }
  | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not write the effect. */
export function claimAccessRequest(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored status. Anything else is unknown. */
export function decodeAccessRequest(status: unknown): AccessRequestState {
  if (
    status === "pending" ||
    status === "approved" ||
    status === "granted" ||
    status === "denied"
  ) {
    return { tag: status };
  }
  return { tag: "unknown" };
}

export function transitionAccessRequest(
  state: AccessRequestState,
  event: AccessRequestEvent,
): AccessRequestStep {
  if ("now" in event && !Number.isSafeInteger(event.now)) {
    return reject("access_request", state.tag, event.type, "clock_unreadable");
  }
  if (event.type === "approve" || event.type === "deny") {
    if (state.tag !== "pending") return reject("access_request", state.tag, event.type, "not_pending");
    return event.type === "approve"
      ? { ok: true, state: { tag: "approved" }, effects: [{ type: "approve" }] }
      : { ok: true, state: { tag: "denied" }, effects: [{ type: "deny" }] };
  }
  if (event.type === "reopen") {
    if (state.tag !== "approved") return reject("access_request", state.tag, event.type, "not_approved");
    return { ok: true, state: { tag: "pending" }, effects: [{ type: "reopen" }] };
  }
  if (state.tag !== "pending" && state.tag !== "approved") {
    return reject("access_request", state.tag, event.type, "not_open");
  }
  return event.type === "grant"
    ? { ok: true, state: { tag: "granted" }, effects: [{ type: "grant" }] }
    : { ok: true, state: { tag: "denied" }, effects: [{ type: "reject" }] };
}

export const commitAccessRequest = (
  state: AccessRequestState,
  event: AccessRequestEvent,
): AccessRequestStep => commit(transitionAccessRequest(state, event));
