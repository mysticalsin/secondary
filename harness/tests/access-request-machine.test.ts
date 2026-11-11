/**
 * Access request. No HTTP and no SQLite.
 * Five readings times five events is the whole table.
 * Approve and deny start from pending. Reopen starts from approved.
 * A fulfilling change grants or denies only a pending or approved request.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimAccessRequest,
  commitAccessRequest,
  decodeAccessRequest,
  type AccessRequestEvent,
  transitionAccessRequest,
} from "../../src/state/access-request.ts";

const NOW = 1_700_000_000_000;

const states = {
  pending: { tag: "pending" } as const,
  approved: { tag: "approved" } as const,
  granted: { tag: "granted" } as const,
  denied: { tag: "denied" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  approve: { type: "approve", now: NOW } as const,
  deny: { type: "deny", now: NOW } as const,
  reopen: { type: "reopen" } as const,
  grant: { type: "grant", now: NOW } as const,
  reject: { type: "reject", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "pending:approve",
  "pending:deny",
  "pending:grant",
  "pending:reject",
  "approved:reopen",
  "approved:grant",
  "approved:reject",
]);

test("access request decode: the four stored words, and anything else is unknown", () => {
  assert.deepEqual(decodeAccessRequest("pending"), { tag: "pending" });
  assert.deepEqual(decodeAccessRequest("approved"), { tag: "approved" });
  assert.deepEqual(decodeAccessRequest("granted"), { tag: "granted" });
  assert.deepEqual(decodeAccessRequest("denied"), { tag: "denied" });
  assert.deepEqual(decodeAccessRequest("expired"), { tag: "unknown" });
  assert.deepEqual(decodeAccessRequest(null), { tag: "unknown" });
});

test("access request: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 25);
  assert.equal(legal.size, 7);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionAccessRequest(states[stateId], events[eventId] as AccessRequestEvent);
      if (legal.has(id)) {
        const step = requireOk(result);
        assert.equal(step.effects.length, 1, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) {
          const reason =
            eventId === "reopen"
              ? "not_approved"
              : eventId === "approve" || eventId === "deny"
                ? "not_pending"
                : "not_open";
          assert.equal(result.reason, reason, id);
        }
      }
    }
  }
});

test("access request: approve, deny, reopen, grant, and reject land on the documented status", () => {
  const approved = requireOk(transitionAccessRequest(states.pending, events.approve));
  assert.deepEqual(approved.state, { tag: "approved" });
  assert.deepEqual(approved.effects, [{ type: "approve" }]);
  const denied = requireOk(transitionAccessRequest(states.pending, events.deny));
  assert.deepEqual(denied.state, { tag: "denied" });
  const reopened = requireOk(transitionAccessRequest(states.approved, events.reopen));
  assert.deepEqual(reopened.state, { tag: "pending" });
  const granted = requireOk(transitionAccessRequest(states.approved, events.grant));
  assert.deepEqual(granted.state, { tag: "granted" });
  const rejected = requireOk(transitionAccessRequest(states.pending, events.reject));
  assert.deepEqual(rejected.state, { tag: "denied" });
  for (const state of [states.granted, states.denied, states.pending, states.unknown]) {
    const step = transitionAccessRequest(state, events.reopen);
    assert.equal(step.ok, false, state.tag);
    if (!step.ok) assert.equal(step.reason, "not_approved");
  }
});

test("access request: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimAccessRequest(1), { tag: "applied" });
  assert.deepEqual(claimAccessRequest(0), { tag: "replay" });
  assert.deepEqual(claimAccessRequest(2), { tag: "replay" });
});

test("access request: an unreadable clock is refused before any effect", () => {
  for (const event of [
    { type: "approve", now: Number.NaN },
    { type: "deny", now: 1.5 },
    { type: "grant", now: Number.POSITIVE_INFINITY },
    { type: "reject", now: Number.NaN },
  ] as AccessRequestEvent[]) {
    const step = transitionAccessRequest(states.pending, event);
    assert.equal(step.ok, false, event.type);
    if (!step.ok) assert.equal(step.reason, "clock_unreadable");
  }
  const reopened = requireOk(transitionAccessRequest(states.approved, { type: "reopen" }));
  assert.deepEqual(reopened.state, { tag: "pending" });
});

test("access request: commit logs a rejected transition and does not change state", () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => lines.push(line);
  try {
    const step = commitAccessRequest(states.granted, events.reopen);
    assert.equal(step.ok, false);
    if (!step.ok) {
      assert.equal(step.machine, "access_request");
      assert.equal(step.from, "granted");
      assert.equal(step.event, "reopen");
      assert.equal(step.reason, "not_approved");
    }
  } finally {
    console.warn = original;
  }
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0] ?? "{}") as Record<string, string>;
  assert.deepEqual(logged, {
    at: "illegal_transition",
    machine: "access_request",
    from: "granted",
    event: "reopen",
    reason: "not_approved",
  });
});
