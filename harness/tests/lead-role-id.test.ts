import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { isBuiltInLeadRoleId } from "../../packages/policy/src/roles.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const ALL_IDS = ["__proto__", "constructor", "toString", "hasOwnProperty", "ACME_LEAD", "acme_lead "] as const;
const REJECTED_IDS = ["__proto__", "toString", "hasOwnProperty", "ACME_LEAD", "acme_lead "] as const;
const CREATED_IDS = ["constructor"] as const;

test("a role id that is not an own property of the built-in table is not a lead", async () => {
  for (const id of ALL_IDS) assert.equal(isBuiltInLeadRoleId(id), false, id);

  const review = new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url).href;
  const { mayDecide } = (await import(review)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
    ) => { allowed: boolean };
  };
  const org = buildOrg();
  for (const id of ALL_IDS) {
    const principal = { ...persona("consultant"), id: "u_probe", roleIds: [id], memberships: [] };
    const view = admittedView(principal, org, { now: NOW });
    assert.equal(mayDecide(view, principal, "c_sales").allowed, false, id);
    assert.equal(mayDecide(view, principal, "core").allowed, false, id);
  }

  const validate = new URL("../../recovered-source/worker/src/admin/validate.ts", import.meta.url).href;
  const { buildRole } = (await import(validate)) as {
    buildRole: (
      input: { id: string; label: string; grants: unknown[] },
      org: ReturnType<typeof buildOrg>,
      base: null,
    ) => { ok: true } | { ok: false; code: string };
  };
  for (const id of REJECTED_IDS) {
    const built = buildRole({ id, label: "Probe", grants: [] }, org, null);
    assert.equal(built.ok, false, id);
    if (!built.ok) assert.equal(built.code, "invalid_role", id);
  }
  for (const id of CREATED_IDS) {
    const built = buildRole({ id, label: "Probe", grants: [] }, org, null);
    assert.equal(built.ok, true, id);
    assert.equal(isBuiltInLeadRoleId(id), false, id);
  }
});
