/**
 * Wiki page visibility. No HTTP and no SQLite.
 * A save publishes a missing page and rewrites a published page.
 * Saving an archived page is refused. Unarchive is its own event.
 * An unknown stored word writes nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimPage,
  commitPage,
  decodePageStatus,
  type PageEvent,
  transitionPage,
} from "../../src/state/page-visibility.ts";

const NOW = 1_700_000_000_000;

const states = {
  absent: { tag: "absent" } as const,
  published: { tag: "published" } as const,
  archived: { tag: "archived" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  save: { type: "save", now: NOW } as const,
  archive: { type: "archive", now: NOW } as const,
  unarchive: { type: "unarchive", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Map<string, { tag: string; effect: string | null }>([
  ["absent:save", { tag: "published", effect: "insert" }],
  ["absent:archive", { tag: "absent", effect: null }],
  ["published:save", { tag: "published", effect: "update" }],
  ["published:archive", { tag: "archived", effect: "archive" }],
  ["archived:archive", { tag: "archived", effect: null }],
  ["archived:unarchive", { tag: "published", effect: "unarchive" }],
]);

const reasons = new Map<string, string>([
  ["absent:unarchive", "absent"],
  ["published:unarchive", "not_archived"],
  ["archived:save", "archived"],
  ["unknown:save", "state_unreadable"],
  ["unknown:archive", "state_unreadable"],
  ["unknown:unarchive", "state_unreadable"],
]);

test("page visibility decode: published and archived are stored, and any other word is unknown", () => {
  assert.deepEqual(decodePageStatus("published"), { tag: "published" });
  assert.deepEqual(decodePageStatus("archived"), { tag: "archived" });
  assert.deepEqual(decodePageStatus("absent"), { tag: "unknown" });
  assert.deepEqual(decodePageStatus(null), { tag: "unknown" });
  assert.deepEqual(decodePageStatus("legacy"), { tag: "unknown" });
});

test("page visibility: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 12);
  assert.equal(legal.size, 6);
  assert.equal(reasons.size, 6);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionPage(states[stateId], events[eventId] as PageEvent);
      const allowed = legal.get(id);
      if (allowed) {
        const step = requireOk(result);
        assert.equal(step.state.tag, allowed.tag, id);
        assert.equal(step.effects[0]?.type ?? null, allowed.effect, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.reason, reasons.get(id), id);
      }
    }
  }
});

test("page visibility: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimPage(1), { tag: "applied" });
  assert.deepEqual(claimPage(0), { tag: "replay" });
  assert.deepEqual(claimPage(2), { tag: "replay" });
});

test("page visibility: an unreadable clock is refused before any effect", () => {
  for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
    const step = transitionPage(states.published, { type: "save", now });
    assert.equal(step.ok, false);
    if (!step.ok) assert.equal(step.reason, "clock_unreadable");
  }
});

test("page visibility: commit logs a refused archived save and does not change state", () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => lines.push(line);
  try {
    const step = commitPage(states.archived, events.save);
    assert.equal(step.ok, false);
    if (!step.ok) {
      assert.equal(step.reason, "archived");
      assert.equal(step.from, "archived");
    }
  } finally {
    console.warn = original;
  }
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ""), {
    at: "illegal_transition",
    machine: "page_visibility",
    from: "archived",
    event: "save",
    reason: "archived",
  });
});
