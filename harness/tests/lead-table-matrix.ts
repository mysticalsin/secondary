import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLE_ORDER, ROLES } from "../../packages/policy/src/roles.ts";
import type { Principal, Role } from "../../packages/policy/src/types.ts";

export const LEAD_TABLE_NOW = 1_700_000_000_000;
export const LEAD_TABLE_WORKSPACES = ["c_sales", "a_acme", "core"] as const;

export type LeadDecide = (
  view: ReturnType<typeof admittedView>,
  principal: Principal,
  nodeId: string,
) => { allowed: boolean };

export type LeadPublish = (c: unknown, w: Record<string, unknown>) => Promise<boolean>;

export type MayRow = { who: string; node: string; lead: boolean; allowed: boolean };
export type PublishRow = {
  who: string;
  lead: boolean;
  workspace: string;
  canDecide: boolean;
  stored: "none" | "editor";
  allowed: boolean;
};

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

function leadOf(ids: readonly string[]): boolean {
  return ids.some((id) => id === "acme_lead");
}

function publishContext(principal: Principal, org: ReturnType<typeof buildOrg>) {
  const tenant = {
    jurisdiction() {
      return tenant;
    },
    idFromName() {
      return "id";
    },
    get() {
      return { humanIds: async () => [principal.id] };
    },
  };
  return {
    get: (key: string) =>
      key === "session"
        ? {
            principal,
            internal: undefined,
            tenantId: principal.tenantId,
            ctx: { now: LEAD_TABLE_NOW },
            org,
          }
        : undefined,
    env: {
      ENVIRONMENT: "dev",
      DO_JURISDICTION: "off",
      DEV_AUTH_BYPASS_EMAIL: principal.email,
      TENANT_POLICY: tenant,
    },
  };
}

function publishStub(stored: "none" | "editor") {
  return {
    brainConfig: async () => ({ publication: "direct" }),
    brainMemberRead: async () => null,
    brainRoleOf: async () => (stored === "none" ? null : "editor"),
  };
}

export async function collectLeadTable(mayDecide: LeadDecide, directPublish: LeadPublish): Promise<{
  mayDecide: MayRow[];
  directPublish: PublishRow[];
}> {
  const org = buildOrg();
  const ref = admittedView(persona("acme_lead"), org, { now: LEAD_TABLE_NOW });
  const mayDecideRows: MayRow[] = [];

  const record = (who: string, ids: readonly string[], principal: Principal, view: ReturnType<typeof admittedView>) => {
    for (const node of [...view.nodes.keys()].sort()) {
      mayDecideRows.push({
        who,
        node,
        lead: leadOf(ids),
        allowed: mayDecide(view, principal, node).allowed,
      });
    }
  };

  for (const id of ROLE_ORDER) {
    const principal = persona(id);
    record(id, principal.roleIds, principal, admittedView(principal, org, { now: LEAD_TABLE_NOW }));
  }

  const edited: Role = {
    ...ROLES.acme_lead,
    grants: [
      ...ROLES.acme_lead.grants,
      {
        scope_type: "circle",
        scope_id: "c_delivery",
        actions: ["view_structure", "view_content", "comment", "contribute", "edit"],
        conditions: {},
      },
      {
        scope_type: "circle",
        scope_id: "c_bid",
        actions: ["view_structure", "view_content", "edit", "review", "manage_members"],
        conditions: {},
      },
    ],
  };
  const editedPrincipal = persona("acme_lead");
  const editedView = admittedView(
    editedPrincipal,
    buildOrg({ roles: { ...ROLES, acme_lead: edited } }),
    { now: LEAD_TABLE_NOW },
  );
  record("acme_lead+governance_grants", editedPrincipal.roleIds, editedPrincipal, editedView);

  const secondRole: Role = {
    id: "circle_steward",
    label: "Circle steward",
    summary: "Edits, reviews, and manages one circle. Not a built-in lead.",
    grants: [
      {
        scope_type: "circle",
        scope_id: "c_bid",
        actions: ["view_structure", "view_content", "edit", "review", "manage_members"],
        conditions: {},
      },
    ],
    exclusions: [],
    never: [],
  };
  const lead = persona("acme_lead");
  const withSecond: Principal = {
    ...lead,
    roleIds: ["acme_lead", "circle_steward"],
    memberships: lead.memberships,
  };
  const secondView = admittedView(
    withSecond,
    buildOrg({ roles: { ...ROLES, circle_steward: secondRole } }),
    { now: LEAD_TABLE_NOW },
  );
  record("acme_lead+second_role", withSecond.roleIds, withSecond, secondView);

  const consultant = persona("consultant");
  const both: Principal = {
    ...lead,
    roleIds: ["acme_lead", "consultant"],
    memberships: [...lead.memberships, ...consultant.memberships],
  };
  record("acme_lead+consultant", both.roleIds, both, admittedView(both, org, { now: LEAD_TABLE_NOW }));

  const editor: Principal = {
    ...persona("consultant"),
    id: "u_editor",
    roleIds: ["circle_editor"],
    memberships: [],
  };
  record(
    "circle_editor",
    editor.roleIds,
    editor,
    admittedView(editor, buildOrg({ roles: { ...ROLES, circle_editor: editorRole } }), { now: LEAD_TABLE_NOW }),
  );

  const directPublishRows: PublishRow[] = [];
  const callers: { who: string; ids: readonly string[]; principal: Principal }[] = ROLE_ORDER.map((id) => {
    const principal = persona(id);
    return { who: id, ids: principal.roleIds, principal };
  });
  callers.push(
    { who: "acme_lead+governance_grants", ids: editedPrincipal.roleIds, principal: editedPrincipal },
    { who: "acme_lead+second_role", ids: withSecond.roleIds, principal: withSecond },
    { who: "acme_lead+consultant", ids: both.roleIds, principal: both },
    { who: "circle_editor", ids: editor.roleIds, principal: editor },
  );
  for (const caller of callers) {
    for (const workspace of LEAD_TABLE_WORKSPACES) {
      for (const canDecide of [true, false]) {
        for (const stored of ["none", "editor"] as const) {
          const allowed = await directPublish(publishContext(caller.principal, org), {
            personal: false,
            vn: ref.nodes.get(workspace),
            stub: publishStub(stored),
            can: { edit: true, decide: canDecide },
          });
          directPublishRows.push({
            who: caller.who,
            lead: leadOf(caller.ids),
            workspace,
            canDecide,
            stored,
            allowed,
          });
        }
      }
    }
  }

  return { mayDecide: mayDecideRows, directPublish: directPublishRows };
}
