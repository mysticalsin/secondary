/**
 * Workspace item release. update may set a record or review status.
 * approved is only the release transition, and that uses the shared quorum result.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";
import type { QuorumResult } from "./quorum.ts";

/** Statuses update may write. approved is not one of them. */
export const UPDATE_STATUSES = [
  "draft",
  "candidate",
  "rejected",
  "open",
  "decided",
  "in progress",
  "done",
  "mitigating",
  "closed",
  "ready",
] as const;

const UPDATABLE = new Set<string>(UPDATE_STATUSES);

export type ItemState = { status: string };

export type ItemEvent =
  | { type: "update"; status: string | null }
  | { type: "edit" }
  | { type: "approve"; quorum: QuorumResult; required: number; approvals: number };

export type ItemEffect =
  | { type: "set_status"; status: string }
  | { type: "claim_release"; from: "candidate"; to: "approved" };

/** The release write matched the candidate row, or another caller already took it. */
export type ReleaseClaim = { tag: "released" } | { tag: "replay" };

/** One matching candidate row releases. Any other count is a replay and must not emit item.released. */
export function claimRelease(matchedRows: number): ReleaseClaim {
  return matchedRows === 1 ? { tag: "released" } : { tag: "replay" };
}

export type ItemStep =
  | { ok: true; state: ItemState; effects: ItemEffect[] }
  | IllegalTransition;

export function transitionItem(state: ItemState, event: ItemEvent): ItemStep {
  if (event.type === "update") {
    if (event.status === null || event.status === state.status) {
      return { ok: true, state, effects: [] };
    }
    if (!UPDATABLE.has(event.status)) {
      return reject("item_release", state.status, event.type, "status_rejected");
    }
    return {
      ok: true,
      state: { status: event.status },
      effects: [{ type: "set_status", status: event.status }],
    };
  }
  if (event.type === "edit") {
    const status = state.status === "approved" ? "candidate" : state.status;
    const changed = status !== state.status;
    return {
      ok: true,
      state: { status },
      effects: changed ? [{ type: "set_status", status }] : [],
    };
  }
  if (state.status !== "candidate") {
    return reject("item_release", state.status, event.type, "not_pending");
  }
  if (event.quorum.tag === "same_actor" || event.quorum.tag === "replay" || event.quorum.tag === "refused") {
    return reject("item_release", state.status, event.type, event.quorum.tag);
  }
  const next = event.approvals + 1;
  const releases =
    next >= event.required &&
    (event.quorum.tag === "confirmed" || (event.quorum.tag === "recorded" && event.required <= 1));
  if (!releases) return { ok: true, state, effects: [] };
  return {
    ok: true,
    state: { status: "approved" },
    effects: [{ type: "claim_release", from: "candidate", to: "approved" }],
  };
}

export const commitItem = (state: ItemState, event: ItemEvent): ItemStep =>
  commit(transitionItem(state, event));
