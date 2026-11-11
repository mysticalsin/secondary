/**
 * Wiki seed claim. No tenant, no workspace, no note content.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  commitWikiSeed,
  decodeSeed,
  encodeSeed,
  loadSeed,
  seedLeaseOpen,
  seedRunStatus,
  seedVersionPending,
  storeSeed,
  type SeedEvent,
  type SeedRecord,
  transitionWikiSeed,
} from "../../src/state/wiki-seed.ts";

const LEASE = 120_000;

const fresh = (): SeedRecord => ({ v: 1, completed: 0, claim: null, unreadable: false });
const current: SeedRecord = { v: 1, completed: 2, claim: null, unreadable: false };
const held: SeedRecord = {
  v: 1,
  completed: 0,
  claim: { version: 2, at: 1000 },
  unreadable: false,
};
const heldOlder: SeedRecord = {
  v: 1,
  completed: 0,
  claim: { version: 1, at: 1000 },
  unreadable: false,
};
const corrupt: SeedRecord = { v: 1, completed: 0, claim: null, unreadable: true };

const events = {
  claim2: { type: "claim", version: 2, now: 1000, leaseMs: LEASE },
  claim2late: { type: "claim", version: 2, now: 1000 + LEASE, leaseMs: LEASE },
  claim3: { type: "claim", version: 3, now: 1000, leaseMs: LEASE },
  complete2: { type: "complete", version: 2 },
  complete1: { type: "complete", version: 1 },
  reset: { type: "reset" },
} as const;

const states = { fresh: fresh(), current, held, heldOlder, corrupt };
type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "fresh:claim2",
  "fresh:claim2late",
  "fresh:claim3",
  "fresh:complete2",
  "fresh:complete1",
  "fresh:reset",
  "current:claim3",
  "current:complete2",
  "current:reset",
  "held:claim2late",
  "held:complete2",
  "held:reset",
  "heldOlder:claim2late",
  "heldOlder:complete1",
  "heldOlder:reset",
  "corrupt:reset",
]);

test("wiki seed: every legal transition", () => {
  const claimed = transitionWikiSeed(fresh(), events.claim2);
  assert.equal(claimed.ok, true);
  if (claimed.ok) {
    assert.deepEqual(claimed.state.claim, { version: 2, at: 1000 });
    assert.equal(claimed.state.completed, 0);
    assert.deepEqual(claimed.effects, [{ type: "write" }]);
  }
  const late = transitionWikiSeed(held, events.claim2late);
  assert.equal(late.ok, true);
  if (late.ok) assert.deepEqual(late.state.claim, { version: 2, at: 1000 + LEASE });
  const finished = transitionWikiSeed(held, events.complete2);
  assert.equal(finished.ok, true);
  if (finished.ok) assert.deepEqual(finished.state, { v: 1, completed: 2, claim: null, unreadable: false });
  const again = transitionWikiSeed(current, events.complete2);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.state.completed, 2);
  const higher = transitionWikiSeed(current, events.claim3);
  assert.equal(higher.ok, true);
  if (higher.ok) {
    assert.equal(higher.state.completed, 2);
    assert.equal(higher.state.claim?.version, 3);
  }
  const cleared = transitionWikiSeed(heldOlder, events.reset);
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.deepEqual(cleared.state, fresh());
  const repaired = transitionWikiSeed(corrupt, events.reset);
  assert.equal(repaired.ok, true);
  if (repaired.ok) assert.equal(repaired.state.unreadable, false);
});

test("wiki seed: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 30);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionWikiSeed(states[stateId], events[eventId] as SeedEvent);
      if (legal.has(id)) assert.equal(result.ok, true, id);
      else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.machine, "wiki_seed");
      }
    }
  }
});

test("wiki seed: guards allow and deny", () => {
  assert.equal(seedVersionPending(0, 2), true);
  assert.equal(seedVersionPending(2, 2), false);
  assert.equal(seedLeaseOpen({ version: 2, at: 1000 }, 1000, LEASE), true);
  assert.equal(seedLeaseOpen({ version: 2, at: 1000 }, 1000 + LEASE, LEASE), false);
  const badLease = transitionWikiSeed(fresh(), { type: "claim", version: 2, now: 1, leaseMs: 0 });
  assert.equal(badLease.ok, false);
});

test("wiki seed: legacy cells round-trip and unknown input does not look fresh", () => {
  const legacy = loadSeed("2", JSON.stringify({ version: 2, at: 50 }));
  assert.equal(legacy.unreadable, false);
  assert.deepEqual(storeSeed(legacy), {
    version: "2",
    claim: JSON.stringify({ version: 2, at: 50 }),
  });
  assert.deepEqual(loadSeed(null, null), fresh());
  assert.equal(loadSeed("nope", null).unreadable, true);
  assert.equal(loadSeed(null, "{").unreadable, true);
  const bad = transitionWikiSeed(loadSeed(null, "{"), events.claim2);
  assert.equal(bad.ok, false);
  assert.deepEqual(decodeSeed({ v: 9 }), { v: 1, completed: 0, claim: null, unreadable: true });
  const stored = encodeSeed(held);
  assert.deepEqual(decodeSeed(JSON.parse(JSON.stringify(stored))), held);
});

test("wiki seed: an unexpired older claim is not overwritten, and a run status stays the old mapping", () => {
  const overwritten = transitionWikiSeed(heldOlder, events.claim2);
  assert.equal(overwritten.ok, false);
  if (!overwritten.ok) assert.match(overwritten.reason, /unexpired/);
  const backwards = transitionWikiSeed(current, events.complete1);
  assert.equal(backwards.ok, false);
  if (!backwards.ok) assert.match(backwards.reason, /backwards/);

  assert.deepEqual(seedRunStatus({ enabled: false }), { status: "off" });
  assert.deepEqual(seedRunStatus({ enabled: true, hasConfig: false }), { status: "unseeded" });
  assert.deepEqual(
    seedRunStatus({ enabled: true, hasConfig: true, claimed: false, completed: 3, version: 3 }),
    { status: "current" },
  );
  assert.deepEqual(
    seedRunStatus({ enabled: true, hasConfig: true, claimed: false, completed: 1, version: 3 }),
    { status: "busy" },
  );
  assert.deepEqual(
    seedRunStatus({
      enabled: true,
      hasConfig: true,
      claimed: true,
      failed: false,
      version: 3,
      workspaces: 1,
      records: 2,
      pages: 4,
    }),
    { status: "seeded", version: 3, workspaces: 1, records: 2, pages: 4 },
  );

  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const logged = commitWikiSeed(corrupt, events.claim2);
    assert.equal(logged.ok, false);
    assert.match(lines[0] ?? "", /wiki_seed/);
  } finally {
    console.warn = original;
  }
});
