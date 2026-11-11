/**
 * The erasure request is one machine. These assertions describe the wiring at the
 * current head: the clock is injected, re-apply uses that machine, and the route
 * returns that machine's outcome.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { requireFail, requireOk } from "./require-ok.ts";
import {
  absentErasure,
  commitErasure,
  decodeErasureLedger,
  decodeErasureStatus,
  decodeStepMark,
  erasurePlan,
  runErasure,
  stepsForRestore,
  type StoredErasure,
} from "../../src/state/erasure-request.ts";

const root = new URL("../../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function between(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return src.slice(from, to);
}

test("erasure request: eraseSubject does not read the clock", () => {
  const body = between(
    source("recovered-source/worker/src/ops-rights.ts"),
    "export async function eraseSubject",
    "export async function reapplyErasures",
  );
  assert.doesNotMatch(body, /Date\.now\(\)/);
});

test("erasure request: re-apply runs the same machine", () => {
  const body = source("recovered-source/worker/src/ops-rights.ts").slice(
    source("recovered-source/worker/src/ops-rights.ts").indexOf("export async function reapplyErasures"),
  );
  assert.match(body, /runErasure\(/);
});

test("erasure request: re-apply has no second direct path", () => {
  const body = source("recovered-source/worker/src/ops-rights.ts").slice(
    source("recovered-source/worker/src/ops-rights.ts").indexOf("export async function reapplyErasures"),
  );
  assert.doesNotMatch(body, /kind === "tenant"/);
});

test("erasure request: the route returns the machine outcome", () => {
  const body = between(source("recovered-source/worker/src/ops-admin.ts"), 'r.post("/rights/erase"', "return r;");
  assert.match(body, /outcome\.status/);
  assert.doesNotMatch(body, /if \(!done\)/);
});

test("erasure request: the reducer is a state module", () => {
  assert.equal(existsSync(new URL("src/state/erasure-request.ts", root)), true);
});

const NOW = 1_700_000_000_000;

test("erasure request: legacy and unknown words decode to partial_failed, and a missing row is absent", () => {
  assert.deepEqual(decodeErasureStatus("legacy"), { tag: "partial_failed" });
  assert.deepEqual(decodeErasureStatus("unknown"), { tag: "partial_failed" });
  assert.deepEqual(decodeErasureStatus(null), { tag: "partial_failed" });
  assert.equal(decodeStepMark("legacy"), "failed");
  assert.deepEqual(decodeErasureLedger(null), absentErasure());
  const corrupt = decodeErasureLedger({ status: "completed", ledger: "not-json" });
  assert.equal(corrupt.status.tag, "partial_failed");
  assert.deepEqual(corrupt.order, []);
});

test("erasure request: a failed step stops the attempt and a resume continues it", async () => {
  const seen: string[] = [];
  const saved: StoredErasure[] = [];
  const stopped = await runErasure(
    absentErasure(),
    { type: "request", now: NOW, steps: erasurePlan(["acme"]) },
    async (step) => {
      seen.push(step);
      return step !== "receipts";
    },
    async (state) => {
      saved.push(state);
    },
  );
  assert.deepEqual(seen, ["receipts"]);
  assert.equal(stopped.status.tag, "partial_failed");
  assert.equal(stopped.mark.receipts, "failed");
  assert.equal(stopped.mark.tombstone, "pending");
  const continued = await runErasure(
    stopped,
    { type: "resume", now: NOW + 1 },
    async (step) => {
      seen.push(step);
      return true;
    },
    async (state) => {
      saved.push(state);
    },
  );
  assert.equal(continued.status.tag, "completed");
  assert.deepEqual(seen, [
    "receipts",
    "receipts",
    "tombstone",
    "scope:acme",
    "personal",
    "connector",
    "directory",
  ]);
  assert.equal(saved.at(-1)?.status.tag, "completed");
});

test("erasure request: a restore reopens the restored step and leaves finished steps done", async () => {
  const finished = requireOk(
    commitErasure(absentErasure(), {
      type: "request",
      now: NOW,
      steps: ["receipts", "directory"],
    }),
  ).state;
  let current = requireOk(commitErasure(finished, { type: "resume", now: NOW })).state;
  current = requireOk(commitErasure(current, { type: "step_done", now: NOW, step: "receipts" })).state;
  current = requireOk(commitErasure(current, { type: "step_done", now: NOW, step: "directory" })).state;
  assert.equal(current.status.tag, "completed");
  const seen: string[] = [];
  const restored = await runErasure(
    current,
    { type: "restore", now: NOW + 2, steps: stepsForRestore("tenant", "tenant", "p1") },
    async (step) => {
      seen.push(step);
      return true;
    },
    async () => {},
  );
  assert.deepEqual(seen, ["directory"]);
  assert.equal(restored.mark.receipts, "done");
  assert.equal(restored.status.tag, "completed");
  assert.deepEqual(stepsForRestore("workspace", "personal:p1", "p1"), ["personal"]);
  assert.deepEqual(stepsForRestore("workspace", "personal:other", "p1"), []);
  assert.deepEqual(stepsForRestore("workspace", "acme", "p1"), ["scope:acme"]);
});

test("erasure request: an unreadable clock does not start, and the module does not read one", () => {
  const refused = requireFail(commitErasure(absentErasure(), { type: "request", now: Number.NaN, steps: ["receipts"] }));
  assert.equal(refused.reason, "clock_unreadable");
  assert.doesNotMatch(source("src/state/erasure-request.ts"), /Date\.now\(\)/);
});
