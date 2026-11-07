import type { Action, Grant, Role } from "./types.ts";

const V: Action[] = ["view_structure", "view_content"];
const G = (
  scope_type: Grant["scope_type"],
  scope_id: string,
  actions: Action[],
  conditions: Record<string, unknown> = {},
): Grant => ({ scope_type, scope_id, actions, conditions });

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

export const ROLE_ORDER = [
  "ceo",
  "head_bid",
  "acme_lead",
  "consultant",
  "reviewer",
  "platform_admin",
  "auditor",
] as const;

export type RoleId = (typeof ROLE_ORDER)[number];

/**
 * What an approved membership gives. `membership` ties the grant to scopes where the person holds a
 * membership (added by the governance console or an access request), so the role widens only as far
 * as a steward admitted them. NDA accounts need a named grant as well as the membership.
 */
const MEMBER_GRANTS: Grant[] = [
  G("department", "*", [...V, "comment", "contribute"], { membership: true }),
  G("circle", "*", [...V, "comment", "contribute"], { membership: true }),
  G("account", "*", [...V, "comment", "contribute"], {
    membership: true,
    member: true,
    nda: "named_grant",
  }),
];

const NDA_EXCL = ["personal_brain", "nda_without_grant"];

/** The seven roles, as data. No role grants anything on a personal scope (see personal.ts). */
export const ROLES: Readonly<Record<RoleId, Role>> = {
  ceo: {
    id: "ceo",
    label: "CEO",
    summary:
      "Sees all of Company Brain. Views, comments and contributes. No edit, release or membership changes by default.",
    grants: [
      G("global", "core", [...V, "comment", "contribute", "request_access"]),
      G("department", "*", [...V, "comment", "contribute"]),
      G("region", "*", ["view_structure"]),
      G("account", "*", [...V, "comment", "contribute"], { nda: "named_grant" }),
    ],
    exclusions: NDA_EXCL,
    elevation: { actions: ["edit", "review"], hours: 4 },
    never: ["Approve release or manage members, even when elevated"],
  },
  head_bid: {
    id: "head_bid",
    label: "Head of Bid & Pre-sales",
    summary: "Department steward for the Bid & Pre-sales circle, plus bids linked to accounts.",
    grants: [
      G("global", "core", [...V, "comment", "contribute"]),
      G("circle", "c_bid", STEWARD, { self_approval: false }),
      G("account", "*", [...V, "comment", "contribute"], { linked_to_bid: true }),
      ...MEMBER_GRANTS,
    ],
    exclusions: NDA_EXCL,
    never: ["Approve their own contribution"],
  },
  acme_lead: {
    id: "acme_lead",
    label: "Account lead, Acme",
    summary: "Works in the Sales & Accounts circle and owns the Acme Synthetic SA workspace.",
    grants: [
      G("global", "core", V),
      G("circle", "c_sales", [...V, "comment", "contribute", "edit"]),
      G("account", "a_acme", [...V, "comment", "contribute", "edit", "review", "manage_members"], {
        member: true,
      }),
      ...MEMBER_GRANTS,
    ],
    exclusions: NDA_EXCL,
    never: ["Global release without a distinct reviewer"],
  },
  consultant: {
    id: "consultant",
    label: "Consultant, Delivery",
    summary: "Contributor in own Delivery circles. Edits own drafts only.",
    grants: [
      G("global", "core", V),
      G("circle", "c_delivery", [...V, "comment", "contribute", "edit"], { own_drafts: true }),
      G("circle", "c_eng", [...V, "comment", "contribute", "edit"], { own_drafts: true }),
      ...MEMBER_GRANTS,
    ],
    exclusions: NDA_EXCL,
    never: ["Review their own work"],
  },
  reviewer: {
    id: "reviewer",
    label: "Knowledge reviewer",
    summary:
      "Reviews and approves items in the assigned queue, including Company Global releases (two distinct approvers). Exact-version approval only.",
    grants: [
      // A Company Global release needs two distinct approvers, neither the contributor nor an editor.
      G("global", "core", [...V, "comment", "review", "approve_release"], {
        assigned_queue: true,
        not_contributor: true,
      }),
      G("circle", "c_bid", [...V, "review", "approve_release"], {
        assigned_queue: true,
        not_contributor: true,
      }),
      G("circle", "c_delivery", [...V, "review", "approve_release"], {
        assigned_queue: true,
        not_contributor: true,
      }),
    ],
    exclusions: NDA_EXCL,
    never: ["Approve items they contributed"],
  },
  platform_admin: {
    id: "platform_admin",
    label: "Platform admin",
    summary: "Configures policy and connectors. Structure only, no content, all counts hidden.",
    grants: [
      G("global", "core", ["view_structure", "configure"]),
      G("department", "*", ["view_structure", "configure"]),
      G("region", "*", ["view_structure", "configure"]),
      G("account", "*", ["view_structure", "configure"], { nda: "named_grant" }),
    ],
    exclusions: [...NDA_EXCL, "content"],
    breakGlass: true,
    never: ["Any content, unless a break-glass grant is approved"],
  },
  auditor: {
    id: "auditor",
    label: "Auditor",
    summary: "Reads metadata and counts for audit. Item content is redacted.",
    grants: [
      G("global", "core", [...V, "comment"], { metadata_only: true }),
      G("department", "*", [...V, "comment"], { metadata_only: true }),
      G("region", "*", ["view_structure"]),
      G("account", "*", [...V, "comment"], { metadata_only: true, nda: "named_grant" }),
    ],
    exclusions: NDA_EXCL,
    never: ["Item content", "Any change to content"],
  },
};

export const ACTION_LABEL: Partial<Record<Action, string>> = {
  comment: "Comment",
  contribute: "Contribute",
  edit: "Edit",
  review: "Review",
  approve_release: "Approve release",
  manage_members: "Manage members",
  configure: "Configure",
};
