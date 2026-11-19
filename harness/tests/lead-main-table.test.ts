import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { ROLE_ORDER, ROLES, isBuiltInLeadRole } from "../../packages/policy/src/roles.ts";
import { collectLeadTable, type LeadDecide, type LeadPublish } from "./lead-table-matrix.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const MAIN_LEAD_ROLES = new Set(["acme_lead"]);
const SOURCE = "2d61c473d4c6f44bed2e6857c8a626f98aaa1483";

test("every seeded role's derived lead matches main's LEAD_ROLES membership", () => {
  for (const id of ROLE_ORDER) {
    assert.equal(isBuiltInLeadRole(ROLES[id]), MAIN_LEAD_ROLES.has(id), id);
  }
});

test("decide and direct publish match the table taken from main", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./lead-main-table.json", import.meta.url), "utf8"),
  ) as {
    source: string;
    mayDecide: unknown[];
    directPublish: unknown[];
  };
  assert.equal(fixture.source, SOURCE);
  const review = new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url).href;
  const open = new URL("../../recovered-source/worker/src/brains/open.ts", import.meta.url).href;
  const { mayDecide } = (await import(review)) as { mayDecide: LeadDecide };
  const { directPublish } = (await import(open)) as { directPublish: LeadPublish };
  const table = await collectLeadTable(mayDecide, directPublish);
  assert.deepEqual(table.mayDecide, fixture.mayDecide);
  assert.deepEqual(table.directPublish, fixture.directPublish);
  assert.equal(table.mayDecide.length, fixture.mayDecide.length);
  assert.equal(table.directPublish.length, fixture.directPublish.length);
});
