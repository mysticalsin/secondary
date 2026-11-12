/**
 * Wiki seed claim. No tenant, no workspace, no note content.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireFail, requireOk } from "./require-ok.ts";
import {
  commitWikiSeed,
  decodeSeed,
  encodeSeed,
  loadSeed,
  readSeedVersion,
  RESEED_NEEDED,
  seedLeaseOpen,
  seedRunStatus,
  seedVersionPending,
  seedWrites,
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
  claim: { version: 2, at: 1000, owner: "a" },
  unreadable: false,
};
const heldOlder: SeedRecord = {
  v: 1,
  completed: 0,
  claim: { version: 1, at: 1000, owner: "b" },
  unreadable: false,
};
const corrupt: SeedRecord = { v: 1, completed: 0, claim: null, unreadable: true };

const events = {
  claim2: { type: "claim", version: 2, now: 1000, leaseMs: LEASE, owner: "a" },
  claim2late: { type: "claim", version: 2, now: 1000 + LEASE, leaseMs: LEASE, owner: "a" },
  claim3: { type: "claim", version: 3, now: 1000, leaseMs: LEASE, owner: "a" },
  complete2: { type: "complete", version: 2, owner: "a" },
  complete1: { type: "complete", version: 1, owner: "b" },
  reset: { type: "reset" },
} as const;

const states = { fresh: fresh(), current, held, heldOlder, corrupt };
type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "fresh:claim2",
  "fresh:claim2late",
  "fresh:claim3",
  "fresh:reset",
  "current:claim3",
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
  const claimed = requireOk(transitionWikiSeed(fresh(), events.claim2));
  assert.deepEqual(claimed.state.claim, { version: 2, at: 1000, owner: "a" });
  assert.equal(claimed.state.completed, 0);
  assert.deepEqual(claimed.effects, [{ type: "write" }]);
  assert.deepEqual(requireOk(transitionWikiSeed(held, events.claim2late)).state.claim, {
    version: 2,
    at: 1000 + LEASE,
    owner: "a",
  });
  assert.deepEqual(requireOk(transitionWikiSeed(held, events.complete2)).state, {
    v: 1,
    completed: 2,
    claim: null,
    unreadable: false,
  });
  const higher = requireOk(transitionWikiSeed(current, events.claim3));
  assert.equal(higher.state.completed, 2);
  assert.equal(higher.state.claim?.version, 3);
  assert.deepEqual(requireOk(transitionWikiSeed(heldOlder, events.reset)).state, fresh());
  assert.equal(requireOk(transitionWikiSeed(corrupt, events.reset)).state.unreadable, false);
});

test("wiki seed: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 30);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionWikiSeed(states[stateId], events[eventId] as SeedEvent);
      if (legal.has(id)) requireOk(result);
      else assert.equal(requireFail(result).machine, "wiki_seed", id);
    }
  }
});

test("wiki seed: guards allow and deny", () => {
  assert.equal(seedVersionPending(0, 2), true);
  assert.equal(seedVersionPending(2, 2), false);
  assert.equal(seedLeaseOpen({ version: 2, at: 1000, owner: "a" }, 1000, LEASE), true);
  assert.equal(seedLeaseOpen({ version: 2, at: 1000, owner: "a" }, 1000 + LEASE, LEASE), false);
  assert.equal(requireFail(transitionWikiSeed(fresh(), { type: "claim", version: 2, now: 1, leaseMs: 0, owner: "a" })).from, "idle");
  assert.equal(
    requireFail(transitionWikiSeed(held, { type: "claim", version: 2, now: 1, leaseMs: 0, owner: "a" })).from,
    "claimed",
  );
});

test("wiki seed: legacy cells round-trip and unknown input does not look fresh", () => {
  const legacy = loadSeed("2", JSON.stringify({ version: 2, at: 50, owner: "a" }));
  assert.equal(legacy.unreadable, false);
  assert.deepEqual(storeSeed(legacy), {
    version: "2",
    claim: JSON.stringify({ version: 2, at: 50, owner: "a" }),
  });
  assert.equal(loadSeed("2", JSON.stringify({ version: 2, at: 50 })).unreadable, true);
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
  assert.match(requireFail(transitionWikiSeed(heldOlder, events.claim2)).reason, /unexpired/);
  assert.match(
    requireFail(
      transitionWikiSeed(
        { v: 1, completed: 3, claim: { version: 2, at: 1, owner: "a" }, unreadable: false },
        events.complete2,
      ),
    ).reason,
    /backwards/,
  );

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

test("wiki seed: completion matches the owner, and a missing claim cannot complete", () => {
  const expired = requireOk(
    transitionWikiSeed(held, { type: "claim", version: 2, now: 1000 + LEASE, leaseMs: LEASE, owner: "b" }),
  );
  assert.equal(expired.state.claim?.owner, "b");
  const stolen = requireFail(transitionWikiSeed(expired.state, { type: "complete", version: 2, owner: "a" }));
  assert.equal(stolen.from, "claimed");
  assert.match(stolen.reason, /token/);
  assert.equal(requireFail(transitionWikiSeed(fresh(), events.complete2)).from, "idle");
  assert.match(requireFail(transitionWikiSeed(fresh(), events.complete2)).reason, /no claim/);
  assert.equal(seedWrites([{ type: "write" }]), true);
  assert.equal(seedWrites([{ type: "skip" }]), false);
});

test("wiki seed: a corrupt cell is reseed needed and the log omits the cell", () => {
  const secret = "not-a-version-SECRET";
  const bad = readSeedVersion(secret, null);
  assert.equal(bad.completed, RESEED_NEEDED);
  assert.deepEqual(bad.keys, ["seed_version"]);
  assert.equal(JSON.stringify(bad).includes(secret), false);
  const claimSecret = '{"owner":"SECRET-CLAIM"}';
  const badClaim = readSeedVersion("1", claimSecret);
  assert.equal(badClaim.completed, RESEED_NEEDED);
  assert.deepEqual(badClaim.keys, ["seed_claim"]);
  assert.equal(JSON.stringify(badClaim).includes("SECRET-CLAIM"), false);
  assert.deepEqual(readSeedVersion(null, null), { completed: 0, keys: [] });
  assert.deepEqual(readSeedVersion("", ""), { completed: 0, keys: [] });
  assert.deepEqual(readSeedVersion("4", null), { completed: 4, keys: [] });
  assert.equal(readSeedVersion("-1", null).completed, RESEED_NEEDED);
  assert.equal(readSeedVersion("NaN", null).completed, RESEED_NEEDED);
  assert.deepEqual(seedRunStatus({ enabled: true, hasConfig: true, reseed: true }), { status: RESEED_NEEDED });
});
