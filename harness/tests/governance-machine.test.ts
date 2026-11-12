/**
 * Governance change. No HTTP and no SQLite.
 * Six readings times three events is the whole table.
 * Approve, reject, and withdraw start from pending. Anything else has no effect.
 * A pending row past its expiry reads as expired and is not written back.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimGovernance,
  commitGovernance,
  decodeGovernance,
  type GovernanceEvent,
  readGovernance,
  transitionGovernance,
} from "../../src/state/governance.ts";

const NOW = 1_700_000_000_000;

const states = {
  pending: { tag: "pending" } as const,
  applied: { tag: "applied" } as const,
  rejected: { tag: "rejected" } as const,
  withdrawn: { tag: "withdrawn" } as const,
  expired: { tag: "expired" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  approve: { type: "approve", now: NOW } as const,
  reject: { type: "reject", now: NOW } as const,
  withdraw: { type: "withdraw", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>(["pending:approve", "pending:reject", "pending:withdraw"]);

test("governance decode: the four stored words, and anything else is unknown", () => {
  assert.deepEqual(decodeGovernance("pending"), { tag: "pending" });
  assert.deepEqual(decodeGovernance("applied"), { tag: "applied" });
  assert.deepEqual(decodeGovernance("rejected"), { tag: "rejected" });
  assert.deepEqual(decodeGovernance("withdrawn"), { tag: "withdrawn" });
  assert.deepEqual(decodeGovernance("expired"), { tag: "expired" });
  assert.deepEqual(decodeGovernance("legacy"), { tag: "unknown" });
  assert.deepEqual(decodeGovernance(null), { tag: "unknown" });
});

test("governance read: a pending row past its expiry is expired, and an unknown word stays unknown", () => {
  assert.deepEqual(readGovernance("pending", NOW + 1, NOW), { tag: "pending" });
  assert.deepEqual(readGovernance("pending", NOW, NOW), { tag: "expired" });
  assert.deepEqual(readGovernance("pending", 0, NOW), { tag: "expired" });
  assert.deepEqual(readGovernance("legacy", NOW + 1, NOW), { tag: "unknown" });
  assert.deepEqual(readGovernance("applied", 0, NOW), { tag: "applied" });
});

test("governance: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 18);
  assert.equal(legal.size, 3);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionGovernance(states[stateId], events[eventId] as GovernanceEvent);
      if (legal.has(id)) {
        const step = requireOk(result);
        assert.equal(step.state.tag, eventId === "approve" ? "applied" : eventId === "reject" ? "rejected" : "withdrawn", id);
        assert.equal(step.effects.length, 1, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) {
          const reason =
            stateId === "unknown" ? "state_unreadable" : stateId === "expired" ? "expired" : "not_pending";
          assert.equal(result.reason, reason, id);
        }
      }
    }
  }
});

test("governance: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimGovernance(1), { tag: "applied" });
  assert.deepEqual(claimGovernance(0), { tag: "replay" });
  assert.deepEqual(claimGovernance(2), { tag: "replay" });
});

test("governance: an unreadable clock is refused before any effect", () => {
  for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
    const result = transitionGovernance(states.pending, { type: "approve", now });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "clock_unreadable");
  }
  const step = requireOk(transitionGovernance(states.pending, { type: "approve", now: -1 }));
  assert.equal(step.state.tag, "applied");
});

test("governance: commit logs a rejected transition and does not change state", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = commitGovernance(states.unknown, events.approve);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "state_unreadable");
    assert.equal(lines.length, 1);
    const logged = JSON.parse(lines[0] ?? "{}") as { machine?: string; from?: string; reason?: string };
    assert.equal(logged.machine, "governance");
    assert.equal(logged.from, "unknown");
    assert.equal(logged.reason, "state_unreadable");
    assert.equal(JSON.stringify(logged).includes("legacy"), false);
  } finally {
    console.warn = warn;
  }
});
