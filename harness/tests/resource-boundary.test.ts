/**
 * Recovered policy detail: a node outside the caller's view, or a principal from
 * another tenant, is the same answer as a missing node.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { admittedView } from "../../recovered-source/shared/packages/policy/src/engine.ts";
import { toNodeDetail } from "../../recovered-source/shared/packages/policy/src/map.ts";
import { buildOrg } from "../../recovered-source/shared/packages/policy/src/org.ts";
import { personalRootId } from "../../recovered-source/shared/packages/policy/src/personal.ts";
import { persona } from "../../recovered-source/shared/packages/policy/src/personas.ts";

const NOW = Date.UTC(2026, 10, 7);

test("node detail is null across tenants and for another person's Personal Brain", () => {
  const org = buildOrg();
  const consultant = persona("consultant");
  const ceo = persona("ceo");
  const view = admittedView(consultant, org, { now: NOW });
  const own = personalRootId(consultant.id);
  assert.equal(toNodeDetail(view, own, consultant)?.node.id, own);
  assert.equal(toNodeDetail(view, personalRootId(ceo.id), consultant), null);
  assert.equal(toNodeDetail(view, own, { ...consultant, tenantId: "tenant_other" }), null);
});
