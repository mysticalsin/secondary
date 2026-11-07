/**
 * The reconstruction Env must name every binding and variable the recovered API reads.
 * This does not prove the original Wrangler config.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("reconstructed Env covers every env name read by recovered API source", () => {
  const names = new Set<string>();
  for (const file of walk(path.join(root, "recovered-source/worker"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1] as string);
  }
  const env = readFileSync(path.join(root, "reconstruction/env.d.ts"), "utf8");
  const missing = [...names].filter((name) => !new RegExp(`\\b${name}\\b`).test(env));
  assert.deepEqual(missing, []);
  assert.ok(names.has("TENANT_POLICY"));
  assert.ok(names.has("ANTHROPIC_API_KEY"));
});

test("reconstruction files are outside recovered-source", () => {
  const recovered = walk(path.join(root, "recovered-source"));
  assert.equal(
    recovered.some((file) => file.endsWith(`${path.sep}types.ts`) && file.includes(`${path.sep}worker${path.sep}src${path.sep}types.ts`)),
    false,
  );
  assert.equal(recovered.some((file) => file.endsWith("view-plan.ts")), false);
  assert.equal(recovered.some((file) => file.endsWith(`${path.sep}agent-ui${path.sep}index.ts`)), false);
});
