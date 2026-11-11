/**
 * Wiki proposal review. Findings are effects of this machine, not a second reducer.
 * A decision or an edit starts from candidate. An unknown stored word writes nothing.
 * The caller writes with a from-status predicate and keeps the row when one row changes.
 * Approval counts distinct person ids. It does not read a clock. The same id twice
 * adds nothing. One person releases a personal proposal. Any other proposal waits
 * until that many different people have approved.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type ProposalStatus =
  | { tag: "candidate" }
  | { tag: "approved" }
  | { tag: "rejected" }
  | { tag: "unknown" };

export type FindingStatus =
  | { tag: "open" }
  | { tag: "dismissed" }
  | { tag: "resolved" }
  | { tag: "unknown" };

export type ProposalEvent =
  | { type: "approve"; required: number; approvers: readonly string[] }
  | { type: "reject" }
  | { type: "edit" };

export type FindingEvent = { type: "dismiss" } | { type: "resolve" };

export type ProposalEffect =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "edit" }
  | { type: "dismiss_finding" }
  | { type: "resolve_finding" };

export type FindingEffect = { type: "dismiss" } | { type: "resolve" };

export type ProposalStep =
  | { ok: true; state: ProposalStatus; effects: ProposalEffect[] }
  | IllegalTransition;

export type FindingStep =
  | { ok: true; state: FindingStatus; effects: FindingEffect[] }
  | IllegalTransition;

/** Distinct person ids. A repeated id adds nothing. This does not read a clock. */
export function distinctApprovers(ids: readonly string[]): number {
  return new Set(ids).size;
}

/** One changed row applies. Zero or several is a lost race and must not write the other rows. */
export function claimProposal(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored item status. Anything else, including the response word pending, writes nothing. */
export function decodeProposalStatus(status: unknown): ProposalStatus {
  if (status === "candidate" || status === "approved" || status === "rejected") return { tag: status };
  return { tag: "unknown" };
}

/** Stored finding status. Anything else writes nothing. */
export function decodeFindingStatus(status: unknown): FindingStatus {
  if (status === "open" || status === "dismissed" || status === "resolved") return { tag: status };
  return { tag: "unknown" };
}

export function transitionFinding(state: FindingStatus, event: FindingEvent): FindingStep {
  if (state.tag !== "open") return { ok: true, state, effects: [] };
  if (event.type === "dismiss") return { ok: true, state: { tag: "dismissed" }, effects: [{ type: "dismiss" }] };
  return { ok: true, state: { tag: "resolved" }, effects: [{ type: "resolve" }] };
}

const allow = (state: ProposalStatus, effects: ProposalEffect[]): ProposalStep => ({
  ok: true,
  state,
  effects,
});

export function transitionProposal(
  state: ProposalStatus,
  event: ProposalEvent,
  finding: FindingStatus | null,
): ProposalStep {
  if (state.tag === "unknown") return reject("proposal_review", state.tag, event.type, "state_unreadable");
  if (state.tag !== "candidate") return reject("proposal_review", state.tag, event.type, "not_pending");
  if (event.type === "edit") return allow(state, [{ type: "edit" }]);
  if (event.type === "reject") {
    const effects: ProposalEffect[] = [{ type: "reject" }];
    const dismissed = transitionFinding(finding ?? { tag: "unknown" }, { type: "dismiss" });
    if (dismissed.ok && dismissed.effects.length) effects.push({ type: "dismiss_finding" });
    return allow({ tag: "rejected" }, effects);
  }
  if (distinctApprovers(event.approvers) < event.required) return allow(state, []);
  const effects: ProposalEffect[] = [{ type: "approve" }];
  const resolved = transitionFinding(finding ?? { tag: "unknown" }, { type: "resolve" });
  if (resolved.ok && resolved.effects.length) effects.push({ type: "resolve_finding" });
  return allow({ tag: "approved" }, effects);
}

export const commitProposal = (
  state: ProposalStatus,
  event: ProposalEvent,
  finding: FindingStatus | null,
): ProposalStep => commit(transitionProposal(state, event, finding));
