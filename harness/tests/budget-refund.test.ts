import assert from "node:assert/strict";
import test from "node:test";
import { openHold } from "../../src/state/budget-hold.ts";

test("budget refund: a null refund stays owed and a later success is applied once", async () => {
  const adds: number[] = [];
  let refundsLeft = 1;
  const hold = await openHold(
    {
      async add(tokens: number) {
        adds.push(tokens);
        if (tokens < 0 && refundsLeft > 0) {
          refundsLeft -= 1;
          return null;
        }
        return 0;
      },
    },
    10,
    100,
  );
  assert.ok(hold);
  await hold.settle(7);
  await hold.settle(7);
  await hold.settle(7);
  assert.deepEqual(adds, [10, -3, -3]);
});
