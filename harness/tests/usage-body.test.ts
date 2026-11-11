/**
 * Day-counter body. A bad cell is the cap reached, and the log names the key only.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { decodeUsageBody } from "../../src/state/usage-body.ts";

const KEY = "usage:2026-11-11";

test("usage body: valid integers are the stored total", () => {
  assert.deepEqual(decodeUsageBody("0", KEY), { ok: true, used: 0 });
  assert.deepEqual(decodeUsageBody("42", KEY), { ok: true, used: 42 });
});

test("usage body: empty is zero", () => {
  assert.deepEqual(decodeUsageBody(null, KEY), { ok: true, used: 0 });
  assert.deepEqual(decodeUsageBody(undefined, KEY), { ok: true, used: 0 });
  assert.deepEqual(decodeUsageBody("", KEY), { ok: true, used: 0 });
});

test("usage body: corrupt, negative, and NaN are the cap reached and do not log the body", () => {
  const secret = "not-a-total-SECRET";
  for (const body of [secret, "-1", "-0", "NaN", Number.NaN, "1.5", "Infinity", " 12"]) {
    const read = decodeUsageBody(body, KEY);
    assert.deepEqual(read, { ok: false, at: "usage_unreadable", key: KEY });
    assert.equal(JSON.stringify(read).includes(secret), false);
    assert.equal(JSON.stringify(read).includes("NaN"), false);
  }
});
