/**
 * Isolated tests of the recovered policy engine.
 * buildOrg() is the synthetic fixture already in the recovered package.
 * No Durable Object, network, or service binding is involved.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { admittedView, canDo, describe } from "../../recovered-source/shared/packages/policy/src/engine.ts";
import { buildOrg } from "../../recovered-source/shared/packages/policy/src/org.ts";
import { personalRootId } from "../../recovered-source/shared/packages/policy/src/personal.ts";
import { persona, TENANT_ID } from "../../recovered-source/shared/packages/policy/src/personas.ts";

const NOW = Date.UTC(2026, 10, 7);
const ctx = { now: NOW };

test("a person sees their own Personal Brain and not another person's", () => {
  const org = buildOrg();
  assert.equal(org.tenantId, TENANT_ID);
  const consultant = persona("consultant");
  const ceo = persona("ceo");
  const view = admittedView(consultant, org, ctx);
  const own = personalRootId(consultant.id);
  const other = personalRootId(ceo.id);

  assert.equal(view.nodes.get(own)?.level, "content");
  assert.equal(view.nodes.get(own)?.access, "full");
  assert.equal(view.nodes.has(other), false);
  assert.equal(canDo(consultant, org, own, "view_content", ctx).allowed, true);
  assert.equal(canDo(consultant, org, other, "view_content", ctx).allowed, false);
  assert.equal(canDo(consultant, org, own, "approve_release", ctx).allowed, false);
  assert.ok(describe(consultant, org).never.some((line) => line.includes("Personal Brain")));
});

test("a principal from another tenant is admitted to nothing", () => {
  const org = buildOrg();
  const stranger = { ...persona("ceo"), tenantId: "tenant_other" };
  const view = admittedView(stranger, org, ctx);
  assert.equal(view.nodes.size, 0);
  assert.deepEqual(view.roots, []);
  assert.equal(view.roles.length, 0);
});

test("a platform admin gets structure only and cannot read item content", () => {
  const org = buildOrg();
  const admin = persona("platform_admin");
  const view = admittedView(admin, org, ctx);
  const core = [...view.nodes.values()].find((node) => node.kind === "core");
  assert.ok(core);
  assert.equal(core.level, "structure");
  assert.equal(core.leaf, null);
  assert.equal(canDo(admin, org, core.id, "view_content", ctx).allowed, false);
  assert.equal(canDo(admin, org, core.id, "configure", ctx).allowed, true);
});

test("an auditor's view redacts item text that a content role still receives", () => {
  const org = buildOrg();
  const audited = admittedView(persona("auditor"), org, ctx);
  const full = admittedView(persona("ceo"), org, ctx);
  const hit = [...audited.nodes.values()].find((node) => {
    const ceoNode = full.nodes.get(node.id);
    return node.leaf?.redacted === true && ceoNode?.leaf?.redacted === false && ceoNode.leaf.itemList;
  });
  assert.ok(hit);
  assert.equal(hit.leaf?.itemList, null);
  assert.equal(hit.leaf?.story, null);
  assert.ok(full.nodes.get(hit.id)?.leaf?.itemList?.length);
});
