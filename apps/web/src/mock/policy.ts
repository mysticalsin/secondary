// Tiny stand-in for packages/policy, only for the dev mock. The real UI never decides access.
import { PERSONAS } from "../personas";
import type { Action, AdminRole } from "../types";
import type { Leaf } from "./org";

type G = AdminRole["grants"][number];
const V: Action[] = ["view_structure", "view_content"];
const g = (
  scope_type: string,
  scope_id: string,
  actions: Action[],
  conditions: Record<string, unknown> = {},
): G => ({
  scope_type,
  scope_id,
  actions,
  conditions,
});
const STEWARD: Action[] = [
  ...V,
  "comment",
  "contribute",
  "edit",
  "review",
  "approve_release",
  "manage_members",
  "request_access",
];

export const ROLES: Record<string, AdminRole & { elevation?: string }> = {
  ceo: {
    id: "ceo",
    label: "CEO",
    members: 1,
    summary:
      "Sees all of Company Brain. Views, comments and contributes. No edit, release or membership changes by default.",
    grants: [
      g("global", "core", [...V, "comment", "contribute", "request_access"]),
      g("department", "*", [...V, "comment", "contribute"]),
      g("region", "*", ["view_structure"]),
      g("account", "*", [...V, "comment", "contribute"], { nda: "named_grant" }),
    ],
    exclusions: ["personal_brain", "nda_without_grant"],
    never: ["Approve release or manage members, even when elevated"],
    elevation: "Edit and review for 4 hours, on request.",
  },
  head_bid: {
    id: "head_bid",
    label: "Head of Bid & Pre-sales",
    members: 2,
    summary: "Steward for the Bid & Pre-sales circle, plus bids linked to accounts.",
    grants: [
      g("global", "core", [...V, "comment", "contribute"]),
      g("circle", "c_bid", STEWARD, { self_approval: false }),
      g("account", "*", [...V, "comment", "contribute"], { linked_to_bid: true }),
    ],
    exclusions: ["personal_brain", "nda_without_grant"],
    never: ["Approve their own contribution"],
  },
  acme_lead: {
    id: "acme_lead",
    label: "Account lead, Acme",
    members: 1,
    summary: "Works in the Sales & Accounts circle and owns the Acme Synthetic SA workspace.",
    grants: [
      g("global", "core", V),
      g("circle", "c_sales", [...V, "comment", "contribute", "edit"]),
      g("account", "a_acme", [...V, "comment", "contribute", "edit", "review", "manage_members"], {
        member: true,
      }),
    ],
    exclusions: ["personal_brain", "nda_without_grant"],
    never: ["Global release without a distinct reviewer"],
  },
  consultant: {
    id: "consultant",
    label: "Consultant, Delivery",
    members: 38,
    summary: "Contributor in own Delivery circles. Edits own drafts only.",
    grants: [
      g("global", "core", V),
      g("circle", "c_delivery", [...V, "comment", "contribute", "edit"], { own_drafts: true }),
      g("circle", "c_eng", [...V, "comment", "contribute", "edit"], { own_drafts: true }),
    ],
    exclusions: ["personal_brain", "nda_without_grant"],
    never: ["Review their own work"],
  },
  reviewer: {
    id: "reviewer",
    label: "Knowledge reviewer",
    members: 6,
    summary: "Reviews and approves items in the assigned queue. Exact revision approval only.",
    grants: [
      g("global", "core", [...V, "comment"]),
      g("circle", "c_bid", [...V, "review", "approve_release"], {
        assigned_queue: true,
        not_contributor: true,
      }),
      g("circle", "c_delivery", [...V, "review", "approve_release"], {
        assigned_queue: true,
        not_contributor: true,
      }),
    ],
    exclusions: ["personal_brain", "nda_without_grant"],
    never: ["Approve items they contributed"],
  },
  platform_admin: {
    id: "platform_admin",
    label: "Platform admin",
    members: 2,
    summary: "Configures policy and connectors. Structure only: no content, all counts hidden.",
    grants: [
      g("global", "core", ["view_structure", "configure"]),
      g("department", "*", ["view_structure", "configure"]),
      g("region", "*", ["view_structure", "configure"]),
      g("account", "*", ["view_structure", "configure"], { nda: "named_grant" }),
    ],
    exclusions: ["personal_brain", "nda_without_grant", "content"],
    never: ["Any content, unless a break-glass grant is approved"],
  },
  auditor: {
    id: "auditor",
    label: "Auditor",
    members: 2,
    summary: "Reads structure and audit receipts. No content, no changes.",
    grants: [
      g("global", "core", ["view_structure"]),
      g("department", "*", ["view_structure"]),
      g("account", "*", ["view_structure"]),
    ],
    exclusions: ["personal_brain", "content"],
    never: ["Read content, approve, edit or change membership"],
  },
};

export function roleOf(persona: string | null): string {
  return persona && ROLES[persona] ? persona : "head_bid";
}
export const roleLabel = (id: string) => PERSONAS.find((p) => p.id === id)?.label ?? id;

export type Vis = "full" | "locked" | "structure" | "hidden";

const OWN_CIRCLES: Record<string, string[]> = {
  ceo: ["*"],
  head_bid: ["c_bid"],
  acme_lead: ["c_sales"],
  consultant: ["c_delivery", "c_eng"],
  reviewer: ["c_bid", "c_delivery"],
};

export function vis(role: string, n: Leaf): Vis {
  if (n.kind === "core") return "full";
  const structureOnly = role === "platform_admin" || role === "auditor";
  if (n.kind === "account" || n.kind === "country" || n.kind === "region") {
    if (n.kind === "account") {
      if (structureOnly) return n.nda ? "locked" : "structure";
      if (role === "ceo") return n.nda ? "locked" : "full";
      if (role === "head_bid") return n.bid ? "full" : "hidden";
      if (role === "acme_lead") return n.id === "a_acme" ? "full" : "hidden";
      return "hidden";
    }
    return structureOnly ? "structure" : "full";
  }
  if (structureOnly) return "structure";
  if (n.kind === "usecase" || n.kind === "governance") {
    return role === "consultant" && n.gov !== "g_amaris" ? "locked" : "full";
  }
  if (n.kind === "theme" || n.kind === "themeitem") return "full";
  // department, circle, topic
  const own = OWN_CIRCLES[role] ?? [];
  if (n.kind === "department") return "full";
  if (n.restricted && role !== "ceo") return "locked";
  return own.includes("*") || (n.circle !== undefined && own.includes(n.circle))
    ? "full"
    : "locked";
}

function scopeRefs(n: Leaf): { type: string; id: string }[] {
  if (
    n.kind === "core" ||
    n.kind === "usecase" ||
    n.kind === "governance" ||
    n.kind === "theme" ||
    n.kind === "themeitem"
  ) {
    return [{ type: "global", id: "core" }];
  }
  if (n.kind === "department") return [{ type: "department", id: n.id }];
  if (n.kind === "circle" || n.kind === "topic") {
    return [
      { type: "circle", id: n.circle ?? n.id },
      { type: "department", id: n.dept ?? "" },
    ];
  }
  if (n.kind === "account") return [{ type: "account", id: n.id }];
  return [{ type: "region", id: n.region ?? n.id }];
}

export function canDo(role: string, n: Leaf, action: Action): { allowed: boolean; reason: string } {
  const r = ROLES[role];
  if (!r) return { allowed: false, reason: "Unknown role. Access is denied by default." };
  if (n.nda) {
    return { allowed: false, reason: "This workspace is under NDA. A named grant is needed." };
  }
  const refs = scopeRefs(n);
  const hit = r.grants.some(
    (gr) =>
      refs.some(
        (ref) => ref.type === gr.scope_type && (gr.scope_id === "*" || gr.scope_id === ref.id),
      ) && gr.actions.includes(action),
  );
  if (hit) return { allowed: true, reason: `Granted by the ${r.label} role.` };
  if (r.elevation && (action === "edit" || action === "review") && role === "ceo") {
    return { allowed: false, reason: "Needs a time-boxed elevation (4 hours). Request one first." };
  }
  if (role === "platform_admin" && action !== "configure") {
    return { allowed: false, reason: "Platform admins see structure only, never content." };
  }
  return {
    allowed: false,
    reason: `The ${r.label} role has no "${action.replace("_", " ")}" grant here.`,
  };
}
