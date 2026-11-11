/**
 * Import publish outcome. No HTTP and no SQLite.
 * A personal auto-accept stays a draft. Publishing is an explicit action.
 * An unknown stored word writes nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimImport,
  decodeImportStatus,
  type ImportEvent,
  publishMode,
  transitionImport,
} from "../../src/state/import-outcome.ts";

const states = {
  draft: { tag: "draft" } as const,
  published: { tag: "published" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  auto_accept: { type: "auto_accept" } as const,
  publish: { type: "publish" } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Map<string, { tag: string; effect: string | null }>([
  ["draft:auto_accept", { tag: "draft", effect: null }],
  ["draft:publish", { tag: "published", effect: "publish" }],
  ["published:auto_accept", { tag: "published", effect: null }],
]);

const reasons = new Map<string, string>([
  ["published:publish", "not_draft"],
  ["unknown:auto_accept", "state_unreadable"],
  ["unknown:publish", "state_unreadable"],
]);

test("import outcome decode: candidate is a draft, approved is published, and any other word is unknown", () => {
  assert.deepEqual(decodeImportStatus("candidate"), { tag: "draft" });
  assert.deepEqual(decodeImportStatus("approved"), { tag: "published" });
  assert.deepEqual(decodeImportStatus("draft"), { tag: "unknown" });
  assert.deepEqual(decodeImportStatus("published"), { tag: "unknown" });
  assert.deepEqual(decodeImportStatus(null), { tag: "unknown" });
  assert.deepEqual(decodeImportStatus("legacy"), { tag: "unknown" });
});

test("import outcome: publishMode defaults to draft and publishes only when asked", () => {
  assert.equal(publishMode(false), "draft");
  assert.equal(publishMode(true), "published");
});

test("import outcome: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 6);
  assert.equal(legal.size, 3);
  assert.equal(reasons.size, 3);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionImport(states[stateId], events[eventId] as ImportEvent);
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

test("import outcome: one changed row applies, and zero or several is a replay", () => {
  assert.deepEqual(claimImport(1), { tag: "applied" });
  assert.deepEqual(claimImport(0), { tag: "replay" });
  assert.deepEqual(claimImport(2), { tag: "replay" });
});
