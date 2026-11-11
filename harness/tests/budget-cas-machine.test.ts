/**
 * Token-counter compare-and-set. No workspace and no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CAS_ATTEMPTS,
  casAttemptsRemain,
  commitBudgetCas,
  decodeBudgetCas,
  encodeBudgetCas,
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
  const again = transitionBudgetCas(trying(0), events.retry);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.deepEqual(again.state, trying(1));
    assert.deepEqual(again.effects, [{ type: "again" }]);
  }
  const wrote = transitionBudgetCas(trying(4), events.wrote);
  assert.equal(wrote.ok, true);
  if (wrote.ok) assert.deepEqual(wrote.state, committed);
  const cap = transitionBudgetCas(trying(2), events.over_cap);
  assert.equal(cap.ok, true);
  if (cap.ok) {
    assert.deepEqual(cap.state, refused);
    assert.deepEqual(cap.effects, [{ type: "stop" }]);
  }
  const spent = transitionBudgetCas(trying(5), events.retry);
  assert.equal(spent.ok, true);
  if (spent.ok) assert.deepEqual(spent.state, refused);
  const lastWrite = transitionBudgetCas(trying(5), events.wrote);
  assert.equal(lastWrite.ok, true);
  if (lastWrite.ok && lastWrite.state.tag === "committed") assert.equal(lastWrite.state.total, 12);
});

test("budget cas: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 12);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionBudgetCas(states[stateId], events[eventId] as BudgetCasEvent);
      if (legal.has(id)) assert.equal(result.ok, true, id);
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

test("budget cas: unknown stored value refuses and a known value round-trips", () => {
  assert.deepEqual(decodeBudgetCas({ v: 0 }), refused);
  assert.deepEqual(decodeBudgetCas({ v: 1, state: { tag: "trying", attempt: 9 } }), refused);
  const stored = encodeBudgetCas(trying(3));
  assert.deepEqual(decodeBudgetCas(JSON.parse(JSON.stringify(stored))), trying(3));
});

test("budget cas: six conflicts refuse, and a cap miss does not use the rest", () => {
  let state: BudgetCasState = trying(0);
  for (let n = 0; n < CAS_ATTEMPTS - 1; n++) {
    const step = transitionBudgetCas(state, events.retry);
    assert.equal(step.ok, true);
    if (step.ok) state = step.state;
  }
  assert.deepEqual(state, trying(5));
  const done = transitionBudgetCas(state, events.retry);
  assert.equal(done.ok, true);
  if (done.ok) assert.equal(done.state.tag, "refused");

  const early = transitionBudgetCas(trying(0), events.over_cap);
  assert.equal(early.ok, true);
  if (early.ok) assert.equal(early.state.tag, "refused");

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
