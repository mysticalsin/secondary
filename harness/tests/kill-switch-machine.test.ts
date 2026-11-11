/**
 * Kill-switch flag. No HTTP and no SQLite.
 * Three stored readings times seven events is the whole table.
 * Prod re-enable is a quorum result, not a second flag state.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  commitSwitch,
  decodeSwitchEnabled,
  type SwitchEvent,
  type SwitchFlag,
  type SwitchStep,
  transitionSwitch,
} from "../../src/state/kill-switch.ts";
import type { QuorumResult } from "../../src/state/quorum.ts";

const NOW = 1_700_000_000_000;

const on: SwitchFlag = { tag: "on" };
const off: SwitchFlag = { tag: "off" };
const corrupt: SwitchFlag = { tag: "corrupt" };

const quorum = (tag: QuorumResult["tag"]): QuorumResult => ({ tag });

const events = {
  turn_off: { type: "turn_off", now: NOW } as const,
  turn_on: { type: "turn_on", now: NOW, twoPerson: false } as const,
  recorded: { type: "turn_on", now: NOW, twoPerson: true, quorum: quorum("recorded") } as const,
  same_actor: { type: "turn_on", now: NOW, twoPerson: true, quorum: quorum("same_actor") } as const,
  confirmed: { type: "turn_on", now: NOW, twoPerson: true, quorum: quorum("confirmed") } as const,
  replay: { type: "turn_on", now: NOW, twoPerson: true, quorum: quorum("replay") } as const,
  refused: { type: "turn_on", now: NOW, twoPerson: true, quorum: quorum("refused") } as const,
};

const states = { on, off, corrupt };

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "on:turn_off",
  "off:turn_off",
  "corrupt:turn_off",
  "on:turn_on",
  "on:recorded",
  "on:same_actor",
  "on:confirmed",
  "on:replay",
  "on:refused",
  "off:turn_on",
  "off:recorded",
  "off:same_actor",
  "off:confirmed",
  "off:replay",
  "off:refused",
]);

test("kill switch decode: 1 is on, 0 is off, and every other value is corrupt", () => {
  assert.deepEqual(decodeSwitchEnabled(1), { tag: "on" });
  assert.deepEqual(decodeSwitchEnabled(0), { tag: "off" });
  for (const value of [2, 1.5, "1", "yes", true, false, null, undefined]) {
    assert.deepEqual(decodeSwitchEnabled(value), { tag: "corrupt" }, String(value));
  }
});

test("kill switch: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 21);
  assert.equal(legal.size, 15);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionSwitch(states[stateId], events[eventId] as SwitchEvent);
      if (legal.has(id)) requireOk(result);
      else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.reason, "corrupt_value");
      }
    }
  }
});

test("kill switch: turn off writes canonical off and clears the ask", () => {
  for (const state of [on, off, corrupt]) {
    const step = requireOk(transitionSwitch(state, events.turn_off));
    assert.deepEqual(step.state, { tag: "off" });
    assert.equal(step.status, "applied");
    assert.deepEqual(step.effects, [
      { type: "write", enabled: false },
      { type: "clear_pending" },
    ]);
  }
});

test("kill switch: an already-on flag does not write", () => {
  for (const event of [
    events.turn_on,
    events.recorded,
    events.same_actor,
    events.confirmed,
    events.replay,
    events.refused,
  ]) {
    const step: Extract<SwitchStep, { ok: true }> = requireOk(transitionSwitch(on, event));
    assert.deepEqual(step.state, { tag: "on" });
    assert.equal(step.status, "applied");
    assert.deepEqual(step.effects, []);
  }
});

test("kill switch: a direct turn-on writes on and leaves the ask", () => {
  const step = requireOk(transitionSwitch(off, events.turn_on));
  assert.deepEqual(step.state, { tag: "on" });
  assert.equal(step.status, "applied");
  assert.deepEqual(step.effects, [{ type: "write", enabled: true }]);
});

test("kill switch: only a confirmed second person turns an off flag on", () => {
  const confirmed = requireOk(transitionSwitch(off, events.confirmed));
  assert.equal(confirmed.status, "applied");
  assert.deepEqual(confirmed.effects, [{ type: "write", enabled: true }]);
  for (const event of [events.recorded, events.same_actor]) {
    const step: Extract<SwitchStep, { ok: true }> = requireOk(transitionSwitch(off, event));
    assert.deepEqual(step.state, { tag: "off" });
    assert.equal(step.status, "pending");
    assert.deepEqual(step.effects, []);
    assert.equal(step.sameActor, event.quorum.tag === "same_actor");
  }
});

test("kill switch: replay and a quorum refusal are not a pending ask", () => {
  const replay = requireOk(transitionSwitch(off, events.replay));
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.state, { tag: "off" });
  assert.deepEqual(replay.effects, []);
  const refused = requireOk(transitionSwitch(off, events.refused));
  assert.equal(refused.status, "refused");
  assert.deepEqual(refused.state, { tag: "off" });
  assert.deepEqual(refused.effects, []);
});

test("kill switch: an unreadable clock is refused before any write", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      const step = commitSwitch(off, { type: "turn_off", now });
      assert.equal(step.ok, false);
      if (!step.ok) assert.equal(step.reason, "clock_unreadable");
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(logged.length, 3);
    for (const line of logged) {
      assert.deepEqual(Object.keys(line).sort(), ["at", "event", "from", "machine", "reason"]);
      assert.equal(line.at, "illegal_transition");
      assert.equal(line.machine, "kill_switch");
      assert.equal(line.from, "off");
      assert.equal(line.event, "turn_off");
      assert.equal(line.reason, "clock_unreadable");
    }
    assert.equal(lines.some((line) => line.includes("NaN") || line.includes("Infinity")), false);
  } finally {
    console.warn = warn;
  }
});
