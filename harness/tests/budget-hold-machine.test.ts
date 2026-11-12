/**
 * Token-budget hold. The store is an in-memory fake. No workspace and no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireFail, requireOk } from "./require-ok.ts";
import {
  commitBudgetHold,
  finiteHoldNumber,
  logIfRefundFailed,
  openHold,
  type BudgetHoldEvent,
  type BudgetHoldState,
  transitionBudgetHold,
} from "../../src/state/budget-hold.ts";

const idle: BudgetHoldState = { tag: "idle" };
const held: BudgetHoldState = { tag: "held", estimate: 10 };
const denied: BudgetHoldState = { tag: "denied" };
const settled: BudgetHoldState = { tag: "settled", actual: 4 };

const events = {
  reserved: { type: "reserved", estimate: 10 } as const,
  denied: { type: "denied" } as const,
  settle: { type: "settle", actual: 4 } as const,
};

const states = { idle, held, denied, settled };
type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>(["idle:reserved", "idle:denied", "held:settle"]);

const fakeStore = () => {
  const adds: number[] = [];
  return {
    adds,
    async add(tokens: number) {
      adds.push(tokens);
      return 100;
    },
  };
};

test("budget hold: every legal transition", () => {
  assert.deepEqual(requireOk(transitionBudgetHold(idle, events.reserved)).state, held);
  assert.deepEqual(requireOk(transitionBudgetHold(idle, events.denied)).state, denied);
  const once = requireOk(transitionBudgetHold(held, { type: "settle", actual: 7.6 }));
  assert.deepEqual(once.state, { tag: "settled", actual: 7.6 });
  assert.deepEqual(once.effects, [{ type: "adjust", delta: -2 }]);
  assert.deepEqual(requireOk(transitionBudgetHold(held, { type: "settle", actual: 10 })).effects, [
    { type: "none" },
  ]);
});

test("budget hold: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 12);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionBudgetHold(states[stateId], events[eventId] as BudgetHoldEvent);
      if (legal.has(id)) requireOk(result);
      else assert.equal(requireFail(result).reason.length > 0, true, id);
    }
  }
});

test("budget hold: guards allow and deny", () => {
  assert.equal(finiteHoldNumber(10), true);
  assert.equal(finiteHoldNumber(Number.NaN), false);
  assert.equal(finiteHoldNumber(Number.POSITIVE_INFINITY), false);
  const badEstimate = transitionBudgetHold(idle, { type: "reserved", estimate: Number.NaN });
  const badActual = transitionBudgetHold(held, { type: "settle", actual: Number.POSITIVE_INFINITY });
  assert.equal(badEstimate.ok, false);
  assert.equal(badActual.ok, false);
});

test("budget hold: a second settle does not adjust the counter again", async () => {
  const store = fakeStore();
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const hold = await openHold(store, 10, 100);
    assert.ok(hold);
    await hold.settle(7);
    await hold.settle(7);
    assert.deepEqual(store.adds, [10, -3]);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /already settled/);

    const cappedAdds: number[] = [];
    assert.equal(
      await openHold(
        {
          async add(tokens) {
            cappedAdds.push(tokens);
            return null;
          },
        },
        10,
        100,
      ),
      null,
    );
    assert.deepEqual(cappedAdds, [10]);

    const nan = fakeStore();
    assert.equal(await openHold(nan, Number.NaN, 100), null);
    assert.deepEqual(nan.adds, []);
    const logged = commitBudgetHold(settled, events.settle);
    assert.equal(logged.ok, false);
  } finally {
    console.warn = original;
  }
});

test("budget hold: a failed adjust is logged without amounts", async () => {
  const adds: number[] = [];
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const hold = await openHold(
      {
        async add(tokens: number) {
          adds.push(tokens);
          return tokens === 10 ? 10 : null;
        },
      },
      10,
      100,
    );
    assert.ok(hold);
    await hold.settle(7);
    await hold.settle(1);
    assert.deepEqual(adds, [10, -3]);
    assert.match(lines[0] ?? "", /budget_adjust_failed/);
    assert.equal((lines[0] ?? "").includes("-3"), false);
    assert.equal((lines[0] ?? "").includes("7"), false);
    logIfRefundFailed(null);
    assert.match(lines.at(-1) ?? "", /budget_refund_failed/);
    assert.equal((lines.at(-1) ?? "").includes("9"), false);
    const before = lines.length;
    logIfRefundFailed(9);
    assert.equal(lines.length, before);
  } finally {
    console.warn = original;
  }
});
