import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";
import type { Role } from "../../packages/policy/src/types.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

const editorRole: Role = {
  id: "circle_editor",
  label: "Circle editor",
  summary: "Edits the sales circle and is not its lead.",
  grants: [
    {
      scope_type: "circle",
      scope_id: "c_sales",
      actions: ["view_structure", "view_content", "comment", "contribute", "edit", "review"],
      conditions: {},
    },
  ],
  exclusions: [],
  never: [],
};

test("lead grant: who decides stays, and the lead is not a role-id list", async () => {
  const specifier = new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url).href;
  const openSpecifier = new URL("../../recovered-source/worker/src/brains/open.ts", import.meta.url).href;
  const { mayDecide } = (await import(specifier)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
      authorId?: string | null,
      aliasIds?: readonly string[],
    ) => { allowed: boolean };
  };
  const { directPublish } = (await import(openSpecifier)) as {
    directPublish: (c: unknown, w: Record<string, unknown>) => Promise<boolean>;
  };

  const org = buildOrg({ roles: { ...ROLES, circle_editor: editorRole } });
  const editor = { ...persona("consultant"), id: "u_editor", roleIds: ["circle_editor"], memberships: [] };
  const editorView = admittedView(editor, org, { now: NOW });
  assert.equal(mayDecide(editorView, editor, "c_sales").allowed, false);

  const lead = persona("acme_lead");
  const leadView = admittedView(lead, org, { now: NOW });
  assert.equal(mayDecide(leadView, lead, "a_acme").allowed, true);
  assert.equal(mayDecide(leadView, lead, "c_sales").allowed, true);
  assert.equal(mayDecide(leadView, lead, "core").allowed, false);
  assert.equal(mayDecide(leadView, lead, "a_acme", lead.id).allowed, false);
  assert.equal(mayDecide(leadView, { ...lead, id: "Ada" }, "a_acme", "ada").allowed, false);
  assert.equal(mayDecide(leadView, lead, "a_acme", "alias-1", [lead.id]).allowed, false);
  assert.equal(mayDecide(leadView, { ...lead, id: "Ada" }, "a_acme", "alias-1", ["ada"]).allowed, false);

  const reviewer = persona("reviewer");
  const reviewerView = admittedView(reviewer, buildOrg(), { now: NOW });
  assert.equal(mayDecide(reviewerView, reviewer, "core").allowed, true);

  const ceo = persona("ceo");
  const elevated = admittedView(ceo, buildOrg(), { now: NOW, elevatedUntil: NOW + 3_600_000 });
  const topic = [...elevated.nodes.values()].find(
    (node) => node.kind === "topic" && node.level === "content" && !!node.dept && node.access === "full",
  );
  assert.equal(topic === undefined, false);
  assert.equal(mayDecide(elevated, ceo, topic?.id ?? "").allowed, false);

  const session = {
    get: (key: string) =>
      key === "session"
        ? { principal: lead, internal: undefined, tenantId: lead.tenantId, ctx: { now: NOW } }
        : undefined,
  };
  const held = await directPublish(session, {
    personal: false,
    nodeId: "c_sales",
    view: leadView,
    role: null,
    vn: leadView.nodes.get("c_sales"),
    stub: { brainConfig: async () => ({ publication: "review" }) },
    can: { edit: true, decide: true },
  });
  assert.equal(held, false);

  const narrowed = await directPublish(session, {
    personal: false,
    nodeId: "c_sales",
    view: leadView,
    role: "editor",
    vn: leadView.nodes.get("c_sales"),
    stub: { brainConfig: async () => ({ publication: "direct" }) },
    can: { edit: true, decide: false },
  });
  assert.equal(narrowed, false);

  let loose: boolean | "threw" = "threw";
  try {
    loose = await directPublish(session, {
      personal: false,
      nodeId: "c_sales",
      view: editorView,
      role: null,
      vn: editorView.nodes.get("c_sales"),
      stub: { brainConfig: async () => ({ publication: "direct" }) },
      can: { edit: true, decide: true },
    });
  } catch {
    loose = "threw";
  }
  assert.equal(loose, false);

  const review = readFileSync(new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url), "utf8");
  const open = readFileSync(new URL("../../recovered-source/worker/src/brains/open.ts", import.meta.url), "utf8");
  const roles = readFileSync(new URL("../../packages/policy/src/roles.ts", import.meta.url), "utf8");
  assert.equal(review.includes("LEAD_ROLES"), false);
  assert.equal(open.includes("w.can.decide"), false);
  assert.equal(roles.includes("lead: true"), true);
});
