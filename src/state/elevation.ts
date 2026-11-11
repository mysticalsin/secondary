/**
 * Elevation window. A start is legal only from pending.
 * The caller writes with a status predicate and keeps the effect when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type ElevationState =
  | { tag: "pending" }
  | { tag: "active" }
  | { tag: "denied" }
  | { tag: "ended" }
  | { tag: "expired" }
  | { tag: "unknown" };

export type ElevationEvent =
  | { type: "start"; now: number }
  | { type: "deny"; now: number }
  | { type: "end"; now: number };

export type ElevationEffect = { type: "activate" } | { type: "deny" } | { type: "end" };

export type ElevationStep =
  | { ok: true; state: ElevationState; effects: ElevationEffect[] }
  | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not write the effect. */
export function claimElevation(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored status, with the same read-time lapse as `toElevation`. Anything else is unknown. */
export function decodeElevation(
  status: unknown,
  now: number,
  lapsesAt: number,
  until: number | null,
): ElevationState {
  if (status === "pending" && lapsesAt <= now) return { tag: "expired" };
  if (status === "active" && until !== null && until <= now) return { tag: "expired" };
  if (
    status === "pending" ||
    status === "active" ||
    status === "denied" ||
    status === "ended" ||
    status === "expired"
  ) {
    return { tag: status };
  }
  return { tag: "unknown" };
}

export function transitionElevation(state: ElevationState, event: ElevationEvent): ElevationStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("elevation", state.tag, event.type, "clock_unreadable");
  }
  if (event.type === "start") {
    if (state.tag !== "pending") return reject("elevation", state.tag, event.type, "not_startable");
    return { ok: true, state: { tag: "active" }, effects: [{ type: "activate" }] };
  }
  if (event.type === "deny") {
    if (state.tag !== "pending") return reject("elevation", state.tag, event.type, "not_pending");
    return { ok: true, state: { tag: "denied" }, effects: [{ type: "deny" }] };
  }
  if (state.tag !== "active") return reject("elevation", state.tag, event.type, "not_active");
  return { ok: true, state: { tag: "ended" }, effects: [{ type: "end" }] };
}

export const commitElevation = (state: ElevationState, event: ElevationEvent): ElevationStep =>
  commit(transitionElevation(state, event));
