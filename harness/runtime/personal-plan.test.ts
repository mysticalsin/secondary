import assert from "node:assert/strict";
import { test } from "node:test";
import { personalPlan } from "../../reconstruction/personal/plan.mjs";
import { renderPersonal } from "../../reconstruction/ui/pages.mjs";

test("a personal plan follows stored context and escapes it", () => {
  const empty = personalPlan({ principalId: "u_empty", tenantId: "tenant_alpha", items: [], total: 0, complete: true });
  assert.equal(empty.empty, true);
  assert.equal(empty.coverage, "full");
  assert.equal(empty.ai, "disabled");
  assert.equal(empty.write, false);
  assert.equal(empty.orgAcl, false);
  const partial = personalPlan({
    principalId: "u_ada",
    tenantId: "tenant_alpha",
    items: [{ id: "pi:1", externalId: "harbor", version: 1, text: "Ada <script>alert(1)</script>", contentSha256: "abc" }],
    total: 105,
    complete: false,
  });
  assert.equal(partial.coverage, "partial");
  assert.equal(partial.shown, 1);
  assert.equal(partial.total, 105);
  const html = renderPersonal({ status: 200, plan: partial, email: "ada@tenant-a.test" });
  assert.equal(html.includes("Deterministic plan. No model was called. AI is disabled."), true);
  assert.equal(html.includes("Ada &lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("Coverage is partial"), true);
  const denied = renderPersonal({ status: 403, plan: { error: "org_denied", context: [{ text: "hidden" }] }, email: "ada@tenant-a.test" });
  assert.equal(denied.includes("hidden"), false);
  assert.equal(denied.includes("not open to this session"), true);
});
