/**
 * Runtime check of recovered genui.ts and the recovered generated ViewPlan validator.
 *
 * This file is intentionally outside harness/tests so the supported typecheck does not
 * follow genui.ts into the missing view-plan.ts module. The view value is a plain object
 * with the fields planView reads. It is not an admitted view from a live Worker, and it
 * is not a service binding.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { planView, validateViewPlan } from "../../src/worker/genui.ts";

test("a deterministic account plan is a catalog query and copies no node text", () => {
  const view = {
    nodes: new Map([
      [
        "a_acme",
        {
          kind: "account",
          access: "full",
          level: "content",
          label: "Do Not Copy Label",
          secret: "vault-phrase-xyz",
        },
      ],
    ]),
  };
  const plan = planView(view as never, { nodeId: "a_acme" });
  assert.ok(plan);
  assert.equal(plan.title, "Account overview");
  assert.equal(validateViewPlan(plan), true);
  const encoded = JSON.stringify(plan);
  assert.equal(encoded.includes("vault-phrase-xyz"), false);
  assert.equal(encoded.includes("Do Not Copy"), false);
  assert.deepEqual(
    plan.components.map((component) => component.type),
    ["AccountSummary", "KpiRow", "ItemList"],
  );
});

test("an unknown node plans nothing, and a plan cannot carry free text", () => {
  const view = { nodes: new Map<string, { kind: string; access: string; level: string }>() };
  assert.equal(planView(view as never, { nodeId: "missing" }), null);
  assert.equal(
    validateViewPlan({
      version: 1,
      title: "Accounts",
      components: [{ type: "NodeCard", props: { nodeId: "a_acme", body: "secret text" } }],
    }),
    false,
  );
  const promptPlan = planView(view as never, { prompt: "show the accounts" });
  assert.ok(promptPlan);
  assert.equal(promptPlan.title, "Accounts");
  assert.equal(validateViewPlan(promptPlan), true);
});

test("a locked personal node becomes the fixed personal callout, still without content", () => {
  const view = {
    nodes: new Map([
      [
        "pb:u_consultant",
        { kind: "personal", access: "full", level: "content", label: "My private note" },
      ],
    ]),
  };
  const plan = planView(view as never, { nodeId: "pb:u_consultant" });
  assert.ok(plan);
  assert.equal(plan.title, "My Secondary");
  assert.equal(validateViewPlan(plan), true);
  assert.equal(JSON.stringify(plan).includes("My private note"), false);
  assert.equal(plan.components[1]?.type, "Callout");
  assert.deepEqual(plan.components[1]?.props, {
    template: "personal_private",
    tone: "info",
    nodeId: "pb:u_consultant",
  });
});
