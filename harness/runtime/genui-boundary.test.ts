/**
 * NEW reconstruction boundary. The delivered renderer is read as text only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { API_CATALOG, RENDERER_LEAVES, ViewBoundary } from "../../reconstruction/genui/boundary.ts";
import { harnessIgnoresQuery, harnessResponse, HARNESS_BANNER } from "../../reconstruction/genui/harness.ts";

const company = {
  environment: "dev",
  tenantId: "tenant_reconstruction",
  principalId: "u_consultant",
  sessionTenantId: "tenant_reconstruction",
  scope: "company" as const,
  persona: "consultant",
  admittedNodeIds: ["a_acme"],
};

const accountPlan = {
  version: 1,
  title: "Account overview",
  components: [
    { type: "AccountSummary", props: { accountId: "a_acme" } },
    { type: "KpiRow", props: { nodeId: "a_acme", metrics: ["items", "open"] } },
    { type: "KpiTile", props: { metric: "health" } },
  ],
};

test("the delivered renderer catalog is not renamed onto the API catalog", () => {
  const renderer = readFileSync("recovered-delivery/shell-six/assets/Renderer-0G0MSIPy.js", "utf8");
  const leaf = renderer.match(/pt=\[((?:"[A-Za-z]+",)*"[A-Za-z]+")\]/);
  assert.ok(leaf);
  assert.deepEqual(
    [...leaf[1].matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]),
    [...RENDERER_LEAVES],
  );
  assert.equal(API_CATALOG.includes("KpiRow"), true);
  assert.equal(API_CATALOG.includes("KpiTile"), false);
  assert.equal(RENDERER_LEAVES.includes("KpiTile"), true);
  assert.equal(RENDERER_LEAVES.includes("KpiRow"), false);
});

test("a valid API plan renders, and a renderer-only component is not shown", () => {
  const view = new ViewBoundary();
  const result = view.show(company, accountPlan);
  assert.equal(result.ok, true);
  assert.equal(result.html.includes("AccountSummary"), true);
  assert.equal(result.html.includes("KpiRow"), true);
  assert.equal(result.html.includes("KpiTile"), false);
  assert.equal(result.dropped.some((item) => item.type === "KpiTile" && item.reason === "renderer_catalog"), true);
  assert.equal(result.html.includes(HARNESS_BANNER), true);
  assert.equal(result.html.includes("<script"), false);
});

test("data props and script text do not render or survive an error", () => {
  const view = new ViewBoundary();
  const first = view.show(company, accountPlan);
  assert.equal(first.ok, true);
  const rejected = view.show(company, {
    version: 1,
    title: "<script>SECRET_TOKEN_99</script>",
    components: [
      {
        type: "NodeCard",
        props: { nodeId: "a_acme", rows: ["SECRET_TOKEN_99"], html: "<script>alert(1)</script>" },
      },
    ],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "schema_rejected");
  assert.equal(rejected.html.includes("SECRET_TOKEN_99"), false);
  assert.equal(rejected.html.includes("<script"), false);
  assert.equal(rejected.html.includes("Account overview"), false);
});

test("a context change drops the previous view", () => {
  const view = new ViewBoundary();
  const first = view.show(company, accountPlan);
  assert.equal(first.html.includes("Account overview"), true);
  const personal = view.show(
    { ...company, scope: "personal", admittedNodeIds: ["p_self"] },
    {
      version: 1,
      title: "My Secondary",
      components: [{ type: "Callout", props: { template: "personal_private", tone: "info", nodeId: "p_self" } }],
    },
  );
  assert.equal(personal.ok, true);
  assert.equal(personal.html.includes("Account overview"), false);
  assert.equal(personal.html.includes("a_acme"), false);
  assert.equal(personal.html.includes("My Secondary"), true);
});

test("cross-tenant, unknown persona, and a non-dev persona are denied", () => {
  const view = new ViewBoundary();
  view.show(company, accountPlan);
  const mismatch = view.show(
    { ...company, tenantId: "tenant_other", sessionTenantId: "tenant_reconstruction" },
    accountPlan,
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "tenant_mismatch");
  assert.equal(mismatch.html.includes("Account overview"), false);
  const outside = view.show({ ...company, environment: "reconstruction", persona: "consultant" }, accountPlan);
  assert.equal(outside.code, "persona_not_dev");
  const unknown = view.show({ ...company, persona: "not_a_role" }, accountPlan);
  assert.equal(unknown.code, "unknown_persona");
  const node = view.show(company, {
    version: 1,
    title: "Other node",
    components: [{ type: "NodeCard", props: { nodeId: "a_other" } }],
  });
  assert.equal(node.ok, false);
  assert.equal(node.html.includes("a_other"), false);
});

test("the harness ignores a query or header that tries to change permission", () => {
  const allowed = harnessResponse("company");
  assert.equal(allowed.status, 200);
  assert.equal(allowed.html.includes("Account overview"), true);
  const forged = harnessIgnoresQuery("company", new URLSearchParams("tenant=tenant_other&persona=ceo"));
  assert.equal(forged.status, 200);
  assert.equal(forged.html.includes("tenant_other"), false);
  assert.equal(forged.html.includes("u_consultant"), true);
  const denied = harnessResponse("mismatch");
  assert.equal(denied.status, 403);
  assert.equal(denied.html.includes("Account overview"), false);
});
