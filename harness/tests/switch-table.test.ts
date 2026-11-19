import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { collectSwitchTable } from "./switch-table-matrix.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

// Pinned after normalized switch paths. Bare prefixes and a trailing contribute slash are 503 when that switch is off.
const SOURCE = "normalized-switch-path";

test("switch gate matches the pinned table", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./switch-main-table.json", import.meta.url), "utf8"),
  ) as { source: string; rows: unknown[] };
  assert.equal(fixture.source, SOURCE);
  const rows = await collectSwitchTable();
  assert.deepEqual(rows, fixture.rows);
  assert.equal(rows.length, fixture.rows.length);
});

test("kill-switch paths and handler names are declared once", () => {
  const root = new URL("../../src/worker/", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, root), "utf8");
  assert.equal(read("ops-admin.ts").includes("personal/items"), false);
  assert.equal(read("switches.ts").includes("personal\\/items"), true);
  for (const file of [
    "routes.ts",
    "wiki/routes.ts",
    "uxv2/routines.ts",
    "ai/routes.ts",
    "agent/turn.ts",
    "uxv2/ask.ts",
  ]) {
    assert.equal(read(file).includes("s.switches."), false, file);
  }
  assert.equal(read("wiki/engine.ts").includes("switches.ai"), true);
});
