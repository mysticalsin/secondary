/**
 * Elevation window. No HTTP and no SQLite.
 * Six readings times three events is the whole table.
 * Only a pending window can start or be denied. Only an active window can end.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireOk } from "./require-ok.ts";
import {
  claimElevation,
  commitElevation,
  decodeElevation,
  effectiveStatus,
  type ElevationEvent,
  type ElevationState,
  transitionElevation,
} from "../../src/state/elevation.ts";

const NOW = 1_700_000_000_000;

const states = {
  pending: { tag: "pending" } as const,
  active: { tag: "active" } as const,
  denied: { tag: "denied" } as const,
  ended: { tag: "ended" } as const,
  expired: { tag: "expired" } as const,
  unknown: { tag: "unknown" } as const,
};

const events = {
  start: { type: "start", now: NOW } as const,
  deny: { type: "deny", now: NOW } as const,
  end: { type: "end", now: NOW } as const,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>(["pending:start", "pending:deny", "active:end"]);

const clockComparison = /lapses_at\s*[<>=]|lapsesAt\s*[<>=]|until\s*[<>]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...sourceFiles(full));
    else if (name.isFile() && name.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("elevation clock: only effectiveStatus compares a window with now", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const allowed = path.join(root, "src/state/elevation.ts");
  const hits: string[] = [];
  for (const file of [...sourceFiles(path.join(root, "src")), ...sourceFiles(path.join(root, "recovered-source"))]) {
    if (file === allowed) continue;
    if (clockComparison.test(readFileSync(file, "utf8"))) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, []);
  const body = readFileSync(allowed, "utf8");
  const start = body.indexOf("export function effectiveStatus");
  const end = body.indexOf("export function", start + 1);
  const only = body.slice(start, end === -1 ? undefined : end);
  assert.equal(clockComparison.test(only), true);
  assert.equal(clockComparison.test(body.slice(0, start) + body.slice(end === -1 ? body.length : end)), false);
});

test("elevation: a null until or an unknown status reads as expired", () => {
  assert.deepEqual(effectiveStatus({ status: "active", lapsesAt: NOW, until: null }, NOW), { tag: "expired" });
  assert.deepEqual(effectiveStatus({ status: "legacy", lapsesAt: NOW, until: NOW + 1 }, NOW), { tag: "expired" });
  assert.deepEqual(effectiveStatus({ status: "active", lapsesAt: NOW, until: NOW + 1 }, NOW), { tag: "active" });
  assert.deepEqual(effectiveStatus({ status: "pending", lapsesAt: NOW + 1, until: null }, NOW), { tag: "pending" });
});

test("elevation decode: a lapsed window, a null end, and an unknown word read as expired", () => {
  assert.deepEqual(decodeElevation("pending", NOW, NOW + 1, null), { tag: "pending" });
  assert.deepEqual(decodeElevation("pending", NOW, NOW, null), { tag: "expired" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, NOW + 1), { tag: "active" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, NOW), { tag: "expired" });
  assert.deepEqual(decodeElevation("active", NOW, NOW, null), { tag: "expired" });
  assert.deepEqual(decodeElevation("denied", NOW, NOW, null), { tag: "denied" });
  assert.deepEqual(decodeElevation("ended", NOW, NOW, NOW), { tag: "ended" });
  assert.deepEqual(decodeElevation("nope", NOW, NOW, null), { tag: "expired" });
});

test("elevation: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 18);
  assert.equal(legal.size, 3);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionElevation(states[stateId], events[eventId] as ElevationEvent);
      if (legal.has(id)) {
        const step = requireOk(result);
        assert.equal(step.effects.length, 1, id);
      } else {
        assert.equal(result.ok, false, id);
        if (!result.ok) {
          const reason =
            eventId === "start" ? "not_startable" : eventId === "deny" ? "not_pending" : "not_active";
          assert.equal(result.reason, reason, id);
        }
      }
    }
  }
});

test("elevation: a pending start activates, and every other status does nothing", () => {
  const started = requireOk(transitionElevation(states.pending, events.start));
  assert.deepEqual(started.state, { tag: "active" });
  assert.deepEqual(started.effects, [{ type: "activate" }]);
  for (const state of [states.active, states.denied, states.ended, states.expired, states.unknown]) {
    const step = transitionElevation(state, events.start);
    assert.equal(step.ok, false, state.tag);
  }
});

test("elevation: one matching row applies, and any other count is a replay", () => {
  assert.deepEqual(claimElevation(1), { tag: "applied" });
  assert.deepEqual(claimElevation(0), { tag: "replay" });
  assert.deepEqual(claimElevation(2), { tag: "replay" });
});

test("elevation: an unreadable clock is refused before any effect", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    for (const now of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      const step = commitElevation(states.pending, { type: "start", now });
      assert.equal(step.ok, false);
      if (!step.ok) assert.equal(step.reason, "clock_unreadable");
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(logged.length, 3);
    for (const line of logged) {
      assert.deepEqual(Object.keys(line).sort(), ["at", "event", "from", "machine", "reason"]);
      assert.equal(line.machine, "elevation");
      assert.equal(line.reason, "clock_unreadable");
    }
    assert.equal(lines.some((line) => line.includes("NaN") || line.includes("Infinity")), false);
  } finally {
    console.warn = warn;
  }
});
