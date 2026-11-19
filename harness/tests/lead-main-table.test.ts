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
  const review = new URL("../../src/worker/wiki/review.ts", import.meta.url).href;
  const open = new URL("../../src/worker/brains/open.ts", import.meta.url).href;
  const { mayDecide } = (await import(review)) as { mayDecide: LeadDecide };
  const { directPublish } = (await import(open)) as { directPublish: LeadPublish };
  const table = await collectLeadTable(mayDecide, directPublish);
  assert.deepEqual(table.mayDecide, fixture.mayDecide);
  assert.deepEqual(table.directPublish, fixture.directPublish);
  const named = (who: string, node: string) =>
    table.mayDecide.find((row) => row.who === who && row.node === node);
  for (const node of ["c_bid", "c_delivery", "c_sales", "a_acme", "pb:u_acme_lead:1", "pb:u_acme_lead:2", "pb:u_acme_lead:3"]) {
    assert.equal(named("acme_lead+governance_grants", node)?.allowed, true, node);
  }
  assert.equal(named("acme_lead+governance_grants", "core")?.allowed, false);
  for (const node of ["c_bid", "c_sales", "a_acme", "pb:u_acme_lead:1"]) {
    assert.equal(named("acme_lead+second_role", node)?.allowed, true, node);
  }
  for (const node of ["pb:u_acme_lead:1", "pb:u_acme_lead:2", "pb:u_acme_lead:3"]) {
    assert.equal(named("acme_lead", node)?.allowed, true, node);
  }
  assert.equal(named("consultant", "pb:u_consultant:1")?.allowed, false);
});
