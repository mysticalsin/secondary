/**
 * Token-counter compare-and-set. No workspace and no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk, requireTag } from "./require-ok.ts";
import {
  CAS_ATTEMPTS,
  casAttemptsRemain,
  commitBudgetCas,
  type BudgetCasEvent,
  type BudgetCasState,
  transitionBudgetCas,
} from "../../src/state/budget-cas.ts";

const trying = (attempt: number): BudgetCasState => ({ tag: "trying", attempt });
const committed: BudgetCasState = { tag: "committed", total: 12 };
const refused: BudgetCasState = { tag: "refused" };

const events = {
  over_cap: { type: "over_cap" } as const,
  wrote: { type: "wrote", total: 12 } as const,
  retry: { type: "retry" } as const,
};

const states = {
  first: trying(0),
  last: trying(CAS_ATTEMPTS - 1),
  committed,
  refused,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "first:over_cap",
  "first:wrote",
  "first:retry",
  "last:over_cap",
  "last:wrote",
  "last:retry",
]);

test("budget cas: every legal transition", () => {
  const again = requireOk(transitionBudgetCas(trying(0), events.retry));
  assert.deepEqual(again.state, trying(1));
  assert.deepEqual(again.effects, [{ type: "again" }]);
  assert.deepEqual(requireOk(transitionBudgetCas(trying(4), events.wrote)).state, committed);
  const cap = requireOk(transitionBudgetCas(trying(2), events.over_cap));
  assert.deepEqual(cap.state, refused);
  assert.deepEqual(cap.effects, [{ type: "stop" }]);
  assert.deepEqual(requireOk(transitionBudgetCas(trying(5), events.retry)).state, refused);
  assert.equal(requireTag(requireOk(transitionBudgetCas(trying(5), events.wrote)).state, "committed").total, 12);
});

test("budget cas: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 12);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionBudgetCas(states[stateId], events[eventId] as BudgetCasEvent);
      if (legal.has(id)) requireOk(result);
      else assert.equal(result.ok, false, id);
    }
  }
});

test("budget cas: guards allow and deny", () => {
  assert.equal(casAttemptsRemain(0), true);
  assert.equal(casAttemptsRemain(4), true);
  assert.equal(casAttemptsRemain(5), false);
  assert.equal(CAS_ATTEMPTS, 6);
});

test("budget cas: six conflicts refuse, and a cap miss does not use the rest", () => {
  let state: BudgetCasState = trying(0);
  for (let n = 0; n < CAS_ATTEMPTS - 1; n++) {
    state = requireTag(requireOk(transitionBudgetCas(state, events.retry)).state, "trying");
  }
  assert.deepEqual(state, trying(5));
  assert.equal(requireTag(requireOk(transitionBudgetCas(state, events.retry)).state, "refused").tag, "refused");
  assert.equal(requireTag(requireOk(transitionBudgetCas(trying(0), events.over_cap)).state, "refused").tag, "refused");

  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const rejected = commitBudgetCas(committed, events.retry);
    assert.equal(rejected.ok, false);
    assert.match(lines[0] ?? "", /budget_cas/);
  } finally {
    console.warn = original;
  }
});
