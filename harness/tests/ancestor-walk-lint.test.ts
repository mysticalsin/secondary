/**
 * The only ancestor walks are restrictionOf and underRestriction.
 * The erasure runner matches a scope step with scopeIdOfStep, not a prefix.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED = new Set(["src/worker/brains/open.ts", "packages/policy/src/engine.ts"]);
const HEADER = /for\s*\([^)]*parentId[^)]*\)/;
const STEP = /parentId\s*=\s*[A-Za-z0-9_]+\.parentId/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("ancestor walks stay inside restrictionOf and underRestriction", () => {
  const roots = ["src", "packages/policy/src"].map((rel) => path.join(root, rel));
  const found: string[] = [];
  for (const dir of roots) {
    for (const full of filesUnder(dir)) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      const text = readFileSync(full, "utf8");
      if (HEADER.test(text) || STEP.test(text)) found.push(rel);
    }
  }
  assert.deepEqual(found.sort(), [...ALLOWED].sort());
});

test("erasure scope matching does not use a prefix", () => {
  const rights = readFileSync(path.join(root, "src/worker/ops-rights.ts"), "utf8");
  const request = readFileSync(path.join(root, "src/state/erasure-request.ts"), "utf8");
  assert.equal(rights.includes("scopeIdOfStep(step)"), true);
  assert.equal(rights.includes('startsWith("scope:'), false);
  assert.equal(request.includes("scopeIdOfStep("), true);
  assert.equal(request.includes('startsWith("scope:'), false);
});
