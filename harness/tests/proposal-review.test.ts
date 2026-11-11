/**
 * Wiki proposal review. No HTTP and no SQLite.
 * A decision starts from candidate. An unknown word writes nothing.
 * Findings are effects: only an open finding is dismissed or resolved.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimProposal,
  decodeFindingStatus,
  decodeProposalStatus,
  type ProposalEvent,
  transitionFinding,
  transitionProposal,
} from "../../src/state/proposal-review.ts";

const states = {
  candidate: { tag: "candidate" } as const,
  approved: { tag: "approved" } as const,
  rejected: { tag: "rejected" } as const,
  unknown: { tag: "unknown" } as const,
};

const finding = {
  open: { tag: "open" } as const,
  dismissed: { tag: "dismissed" } as const,
  resolved: { tag: "resolved" } as const,
  unknown: { tag: "unknown" } as const,
};

const release: ProposalEvent = {
  type: "approve",
  quorum: { tag: "recorded" },
  required: 1,
  approvals: 0,
};

test("proposal review decode: candidate, approved, and rejected are stored, and any other word is unknown", () => {
  assert.deepEqual(decodeProposalStatus("candidate"), { tag: "candidate" });
  assert.deepEqual(decodeProposalStatus("approved"), { tag: "approved" });
  assert.deepEqual(decodeProposalStatus("rejected"), { tag: "rejected" });
  assert.deepEqual(decodeProposalStatus("pending"), { tag: "unknown" });
  assert.deepEqual(decodeProposalStatus("legacy"), { tag: "unknown" });
  assert.deepEqual(decodeProposalStatus(null), { tag: "unknown" });
});

test("finding decode: open, dismissed, and resolved are stored, and any other word is unknown", () => {
  assert.deepEqual(decodeFindingStatus("open"), { tag: "open" });
  assert.deepEqual(decodeFindingStatus("dismissed"), { tag: "dismissed" });
  assert.deepEqual(decodeFindingStatus("resolved"), { tag: "resolved" });
  assert.deepEqual(decodeFindingStatus("legacy"), { tag: "unknown" });
  assert.deepEqual(decodeFindingStatus(null), { tag: "unknown" });
});

test("proposal review: reject and edit are legal only from candidate", () => {
  for (const state of Object.values(states)) {
    for (const event of [{ type: "reject" } as const, { type: "edit" } as const]) {
      const result = transitionProposal(state, event, finding.open);
      const id = `${state.tag}:${event.type}`;
      if (state.tag === "candidate") {
        const step = requireOk(result);
        assert.equal(step.state.tag, event.type === "reject" ? "rejected" : "candidate", id);
        assert.equal(step.effects.some((effect) => effect.type === event.type), true, id);
        if (event.type === "reject")
          assert.equal(step.effects.some((effect) => effect.type === "dismiss_finding"), true, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok)
          assert.equal(result.reason, state.tag === "unknown" ? "state_unreadable" : "not_pending", id);
      }
    }
  }
});

test("proposal review: one recorded approval publishes a single-person proposal and waits when two are required", () => {
  const one = requireOk(transitionProposal(states.candidate, release, finding.open));
  assert.equal(one.state.tag, "approved");
  assert.equal(one.effects.some((effect) => effect.type === "approve"), true);
  assert.equal(one.effects.some((effect) => effect.type === "resolve_finding"), true);
  const waiting = requireOk(
    transitionProposal(
      states.candidate,
      { type: "approve", quorum: { tag: "recorded" }, required: 2, approvals: 0 },
      finding.open,
    ),
  );
  assert.equal(waiting.state.tag, "candidate");
  assert.equal(waiting.effects.length, 0);
  const confirmed = requireOk(
    transitionProposal(
      states.candidate,
      { type: "approve", quorum: { tag: "confirmed" }, required: 2, approvals: 1 },
      null,
    ),
  );
  assert.equal(confirmed.state.tag, "approved");
  assert.equal(confirmed.effects.some((effect) => effect.type === "resolve_finding"), false);
});

test("proposal review: the same person cannot confirm, and a decided or unknown row writes nothing", () => {
  const same = transitionProposal(
    states.candidate,
    { type: "approve", quorum: { tag: "same_actor" }, required: 2, approvals: 1 },
    finding.open,
  );
  assert.equal(same.ok, false);
  if (!same.ok) assert.equal(same.reason, "same_actor");
  for (const state of [states.approved, states.rejected, states.unknown]) {
    const result = transitionProposal(state, release, finding.open);
    assert.equal(result.ok, false, state.tag);
    if (!result.ok) assert.equal(result.reason, state.tag === "unknown" ? "state_unreadable" : "not_pending");
  }
});

test("finding effect: dismiss and resolve write only from open", () => {
  const legal = new Map<string, { tag: string; effect: string | null }>([
    ["open:dismiss", { tag: "dismissed", effect: "dismiss" }],
    ["open:resolve", { tag: "resolved", effect: "resolve" }],
    ["dismissed:dismiss", { tag: "dismissed", effect: null }],
    ["dismissed:resolve", { tag: "dismissed", effect: null }],
    ["resolved:dismiss", { tag: "resolved", effect: null }],
    ["resolved:resolve", { tag: "resolved", effect: null }],
    ["unknown:dismiss", { tag: "unknown", effect: null }],
    ["unknown:resolve", { tag: "unknown", effect: null }],
  ]);
  const ids = Object.keys(finding) as (keyof typeof finding)[];
  for (const stateId of ids) {
    for (const event of ["dismiss", "resolve"] as const) {
      const id = `${stateId}:${event}`;
      const result = transitionFinding(finding[stateId], { type: event });
      const allowed = legal.get(id);
      const step = requireOk(result);
      assert.equal(step.state.tag, allowed?.tag, id);
      assert.equal(step.effects[0]?.type ?? null, allowed?.effect, id);
    }
  }
});

test("proposal review: one changed row applies, and zero or several is a replay", () => {
  assert.deepEqual(claimProposal(1), { tag: "applied" });
  assert.deepEqual(claimProposal(0), { tag: "replay" });
  assert.deepEqual(claimProposal(2), { tag: "replay" });
});
