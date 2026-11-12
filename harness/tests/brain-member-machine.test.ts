/**
 * Brain member. No HTTP and no SQLite.
 * Four readings times two set events is the whole table.
 * Absent, pending, and active may be set. An unknown word writes nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimMember,
  commitMember,
  decodeMember,
  type MemberEvent,
  transitionMember,
} from "../../src/state/brain-member.ts";

const NOW = 1_700_000_000_000;

const states = {
  absent: { tag: "absent" } as const,
  pending: { tag: "pending" } as const,
  active: { tag: "active" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  active: { type: "set", state: "active", now: NOW } as const,
  pending: { type: "set", state: "pending", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "absent:active",
  "absent:pending",
  "pending:active",
  "pending:pending",
  "active:active",
  "active:pending",
]);

test("brain member decode: pending and active are stored, and any other word is unknown", () => {
  assert.deepEqual(decodeMember("pending"), { tag: "pending" });
  assert.deepEqual(decodeMember("active"), { tag: "active" });
  assert.deepEqual(decodeMember("absent"), { tag: "unknown" });
  assert.deepEqual(decodeMember(null), { tag: "unknown" });
});

test("brain member: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 8);
  assert.equal(legal.size, 6);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionMember(states[stateId], events[eventId] as MemberEvent);
      if (legal.has(id)) {
        const step = requireOk(result);
        assert.equal(step.effects.length, 1, id);
        assert.equal(step.state.tag, eventId, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.reason, "state_unreadable", id);
      }
    }
  }
});

test("brain member: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimMember(1), { tag: "applied" });
  assert.deepEqual(claimMember(0), { tag: "replay" });
  assert.deepEqual(claimMember(2), { tag: "replay" });
});

test("brain member: an unreadable clock is refused before any effect", () => {
  for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
    const step = transitionMember(states.pending, { type: "set", state: "active", now });
    assert.equal(step.ok, false);
    if (!step.ok) assert.equal(step.reason, "clock_unreadable");
  }
});

test("brain member: commit logs a rejected transition and does not change state", () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => lines.push(line);
  try {
    const step = commitMember(states.unknown, events.active);
    assert.equal(step.ok, false);
    if (!step.ok) {
      assert.equal(step.machine, "brain_member");
      assert.equal(step.from, "unknown");
      assert.equal(step.event, "set");
      assert.equal(step.reason, "state_unreadable");
    }
  } finally {
    console.warn = original;
  }
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
    at: "illegal_transition",
    machine: "brain_member",
    from: "unknown",
    event: "set",
    reason: "state_unreadable",
  });
});
