/**
 * underRestriction does not treat contacts. restrictionOf does.
 * The policy engine file is intake bytes, so this test locks that divergence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";

test("a contacts ancestor does not block the everyone-open lift", () => {
  const org = buildOrg();
  const parent = org.nodes.get("d_amaris");
  if (!parent) throw new Error("missing department");
  parent.contacts = true;
  const person = { ...persona("consultant"), memberships: [] };
  const view = admittedView(person, org, { now: 1, openBrains: ["c_sales"], ndaGrants: [] });
  const node = view.nodes.get("c_sales");
  assert.equal(node?.level, "content");
  assert.equal(node?.access, "full");
});
