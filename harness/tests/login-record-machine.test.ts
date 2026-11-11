/**
 * One-shot login record. No HTTP and no SQLite.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  commitLoginRecord,
  type LoginRecordEvent,
  type LoginRecordState,
  type LoginRecordStep,
  transitionLoginRecord,
} from "../../src/state/login-record.ts";

const issued: LoginRecordState = { tag: "issued" };
const consumed: LoginRecordState = { tag: "consumed" };

const events = {
  idp_error: { type: "idp_error" } as const,
  missing_state: { type: "missing_state" } as const,
  state_mismatch: { type: "state_mismatch" } as const,
  exchange_failed: { type: "exchange_failed" } as const,
  accepted: { type: "accepted" } as const,
};

const states = { issued, consumed };

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "issued:idp_error",
  "issued:missing_state",
  "issued:state_mismatch",
  "issued:exchange_failed",
  "issued:accepted",
]);

test("login record: every terminal callback consumes the row", () => {
  for (const event of Object.values(events) as LoginRecordEvent[]) {
    const done: Extract<LoginRecordStep, { ok: true }> = requireOk(
      transitionLoginRecord(issued, event),
    );
    assert.deepEqual(done.state, consumed);
    assert.deepEqual(done.effects, [{ type: "take" }]);
  }
});

test("login record: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 10);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionLoginRecord(states[stateId], events[eventId] as LoginRecordEvent);
      if (legal.has(id)) requireOk(result);
      else assert.equal(result.ok, false, id);
    }
  }
});

test("login record: a consumed state logs the refusal and does not take", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const step = commitLoginRecord(consumed, events.accepted);
    assert.equal(step.ok, false);
    assert.deepEqual(lines, [
      JSON.stringify({
        at: "illegal_transition",
        machine: "login_record",
        from: "consumed",
        event: "accepted",
        reason: "the login state was already used",
      }),
    ]);
  } finally {
    console.warn = warn;
  }
});
