/**
 * Elevation window. No HTTP and no SQLite.
 * Six readings times three events is the whole table.
 * Only a pending window can start or be denied. Only an active window can end.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimElevation,
  commitElevation,
  decodeElevation,
  type ElevationEvent,
  type ElevationState,
  transitionElevation,
} from "../../src/state/elevation.ts";

const NOW = 1_700_000_000_000;

const states = {
  pending: { tag: "pending" } as const,
  active: { tag: "active" } as const,
  denied: { tag: "denied" } as const,
  ended: { tag: "ended" } as const,
  expired: { tag: "expired" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  start: { type: "start", now: NOW } as const,
  deny: { type: "deny", now: NOW } as const,
  end: { type: "end", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>(["pending:start", "pending:deny", "active:end"]);

test("elevation decode: a lapsed pending or active window is expired, and any other word is unknown", () => {
  assert.deepEqual(decodeElevation("pending", NOW, NOW + 1, null), { tag: "pending" });
  assert.deepEqual(decodeElevation("pending", NOW, NOW, null), { tag: "expired" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, NOW + 1), { tag: "active" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, NOW), { tag: "expired" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, null), { tag: "active" });
  assert.deepEqual(decodeElevation("denied", NOW, NOW, null), { tag: "denied" });
  assert.deepEqual(decodeElevation("ended", NOW, NOW, NOW), { tag: "ended" });
  assert.deepEqual(decodeElevation("nope", NOW, NOW, null), { tag: "unknown" });
});

test("elevation: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 18);
  assert.equal(legal.size, 3);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionElevation(states[stateId], events[eventId] as ElevationEvent);
      if (legal.has(id)) {
        const step = requireOk(result);
        assert.equal(step.effects.length, 1, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) {
          const reason =
            eventId === "start" ? "not_startable" : eventId === "deny" ? "not_pending" : "not_active";
          assert.equal(result.reason, reason, id);
        }
      }
    }
  }
});

test("elevation: a pending start activates, and every other status does nothing", () => {
  const started = requireOk(transitionElevation(states.pending, events.start));
  assert.deepEqual(started.state, { tag: "active" });
  assert.deepEqual(started.effects, [{ type: "activate" }]);
  for (const state of [states.active, states.denied, states.ended, states.expired, states.unknown]) {
    const step = transitionElevation(state, events.start);
    assert.equal(step.ok, false, state.tag);
  }
});

test("elevation: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimElevation(1), { tag: "applied" });
  assert.deepEqual(claimElevation(0), { tag: "replay" });
  assert.deepEqual(claimElevation(2), { tag: "replay" });
});

test("elevation: an unreadable clock is refused before any effect", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      const step = commitElevation(states.pending, { type: "start", now });
      assert.equal(step.ok, false);
      if (!step.ok) assert.equal(step.reason, "clock_unreadable");
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(logged.length, 3);
    for (const line of logged) {
      assert.deepEqual(Object.keys(line).sort(), ["at", "event", "from", "machine", "reason"]);
      assert.equal(line.machine, "elevation");
      assert.equal(line.reason, "clock_unreadable");
    }
    assert.equal(lines.some((line) => line.includes("NaN") || line.includes("Infinity")), false);
  } finally {
    console.warn = warn;
  }
});
