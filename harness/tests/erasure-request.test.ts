/**
 * The erasure request is one machine. These assertions describe the wiring at the
 * current head: the clock is injected, re-apply uses that machine, and the route
 * returns that machine's outcome.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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
