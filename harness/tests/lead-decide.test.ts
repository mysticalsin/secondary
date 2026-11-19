import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

test("wiki decide: a lead is allowed in their brain, and elevation or self-approval is not", async () => {
  const specifier = new URL("../../src/worker/wiki/review.ts", import.meta.url).href;
  const { mayDecide } = (await import(specifier)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
      authorId?: string | null,
    ) => { allowed: boolean };
  };
  const org = buildOrg();
  const lead = persona("acme_lead");
  const leadView = admittedView(lead, org, { now: NOW });
  assert.equal(leadView.nodes.has("a_acme"), true);
  assert.equal(leadView.nodes.has("c_sales"), true);
  assert.equal(mayDecide(leadView, lead, "a_acme").allowed, true);
  assert.equal(mayDecide(leadView, lead, "c_sales").allowed, true);
  assert.equal(mayDecide(leadView, lead, "core").allowed, false);
  assert.equal(mayDecide(leadView, lead, "a_acme", lead.id).allowed, false);

  const reviewer = persona("reviewer");
  const reviewerView = admittedView(reviewer, org, { now: NOW });
  assert.equal(mayDecide(reviewerView, reviewer, "core", reviewer.id).allowed, false);

  const ceo = persona("ceo");
  const elevated = admittedView(ceo, org, { now: NOW, elevatedUntil: NOW + 3_600_000 });
  const topic = [...elevated.nodes.values()].find(
    (node) => node.kind === "topic" && node.level === "content" && !!node.dept && node.access === "full",
  );
  assert.equal(topic === undefined, false);
  assert.equal(mayDecide(elevated, ceo, topic?.id ?? "").allowed, false);

  for (const role of Object.values(ROLES)) {
    assert.equal(role.elevation?.actions.includes("approve_release") ?? false, false, role.id);
  }
});
