// Types for the policy engine. Contract shapes come from docs/API-CONTRACT.md.

export type ScopeType = "personal" | "global" | "department" | "circle" | "account" | "region";

export type Action =
  | "view_structure"
  | "view_content"
  | "comment"
  | "contribute"
  | "edit"
  | "review"
  | "approve_release"
  | "manage_members"
  | "configure"
  | "request_access";

export const ACTIONS: readonly Action[] = [
  "view_structure",
  "view_content",
  "comment",
  "contribute",
  "edit",
  "review",
  "approve_release",
  "manage_members",
  "configure",
  "request_access",
];

export interface Grant {
  scope_type: ScopeType;
  /** A scope id, or '*' for every scope of that type. */
  scope_id: string;
  actions: Action[];
  conditions: Record<string, unknown>;
}

export interface Role {
  id: string;
  label: string;
  summary: string;
  grants: Grant[];
  exclusions: string[];
  never: string[];
  elevation?: { actions: Action[]; hours: number };
  breakGlass?: boolean;
}

export interface Principal {
  id: string;
  email: string;
  tenantId: string;
  roleIds: string[];
  memberships: { scope_type: ScopeType; scope_id: string }[];
}

export interface Ctx {
  /** Account ids for which the principal holds a named NDA grant. */
  ndaGrants?: string[];
  /** Epoch ms. Elevation is active while now < elevatedUntil (and within the role's hours). */
  elevatedUntil?: number;
  /** Epoch ms. The engine never reads a clock. */
  now: number;
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

export interface Description {
  see: string[];
  do: string[];
  never: string[];
}

/** structure: names only. metadata: counts, freshness, facts, no item content. content: everything. */
export type Level = "structure" | "metadata" | "content";

/** Plane names follow common.schema.json (plane_hosted). */
export type Plane =
  | "PERSONAL_HOSTED"
  | "TEAM_RESTRICTED"
  | "GLOBAL_NONPERSONAL"
  | "ACCOUNT_RESTRICTED";

export type Access = "full" | "partial" | "locked";

export type NodeKind =
  | "core"
  | "coretopic"
  | "department"
  | "circle"
  | "topic"
  | "theme"
  | "themedept"
  | "themeitem"
  | "governance"
  | "cluster"
  | "usecase"
  | "region"
  | "country"
  | "account"
  | "branch"
  | "accleaf"
  | "meeting"
  | "bid"
  | "sector"
  | "personal"
  | "personalitem";

export type Lens = "departments" | "accounts" | "topics" | "governances";
export const LENSES: readonly Lens[] = ["departments", "accounts", "topics", "governances"];

export type Evidence = "supported" | "partial" | "unsupported";

/** Scope fields the policy matches grants against. */
export interface ScopeRef {
  dept?: string;
  circle?: string;
  region?: string;
  account?: string;
  restricted?: boolean;
  nda?: boolean;
  bid?: boolean;
  /** Contacts subspace: members of the account only. */
  contacts?: boolean;
  /** Personal Brain nodes only: the single principal admitted. */
  ownerId?: string;
}

export interface ItemRow {
  title: string;
  source: string;
  ownerRole: string;
  /** Integer (errata ERR-12). */
  revision: number;
  evidence: Evidence;
  plane: Plane;
  reviewedBy2: boolean;
}

export interface Story {
  internal: boolean;
  lesson: boolean;
  extPermission: boolean;
  external: boolean;
}

export interface LeafData {
  type: string;
  /** approved | candidate | draft for knowledge items, the maturity stage for use cases. */
  status: string;
  evidence: Evidence;
  ownerRole: string;
  ownerGroup: string;
  days: number;
  gap: boolean;
  /** Item count behind this leaf (shown as a count at metadata level). */
  items: number;
  open: boolean;
  star: boolean;
  tags: string[];
  revision: number;
  reviewedBy2: boolean;
  sector: string | null;
  /** Principal id of the contributor while the item awaits release. */
  authorId: string | null;
  lineage: string;
  story: Story | null;
  /** null when redacted (metadata level). */
  itemList: ItemRow[] | null;
  redacted: boolean;
  stage?: number;
  note?: string;
}

/** Raw organisation node. Only admittedView reads these. */
export interface OrgNode extends ScopeRef {
  id: string;
  label: string;
  kind: NodeKind;
  plane: Plane;
  parentId: string | null;
  childIds: string[];
  group?: "bl" | "cf";
  facts: Record<string, string>;
  leaf: LeafData | null;
}

export interface OrgLink {
  from: string;
  to: string;
  kind: "replication";
  label: string;
  /** The node the link is derived from; the link is admitted only if that node is. */
  via: string;
}

export interface Org {
  tenantId: string;
  seed: number;
  /** Insertion order is canonical display order. */
  nodes: ReadonlyMap<string, OrgNode>;
  roots: readonly string[];
  links: readonly OrgLink[];
  /** Role definitions for this tenant (grants as data). */
  roles: ReadonlyMap<string, Role>;
}

export interface ViewNode extends ScopeRef {
  id: string;
  label: string;
  kind: NodeKind;
  plane: Plane;
  parentId: string | null;
  childIds: readonly string[];
  level: Level;
  access: Access;
  group?: "bl" | "cf";
  facts: Readonly<Record<string, string>>;
  leaf: LeafData | null;
}

export interface ViewLink {
  from: string;
  to: string;
  kind: "replication" | "in-sector";
  label?: string;
}

export interface AdmittedView {
  tenantId: string;
  principalId: string;
  /** Hash of what this principal can see. Differs between views, never between lenses. */
  scopeHash: string;
  ctx: Ctx;
  /** The principal's roles, resolved against the tenant's role table. Unknown role ids are dropped. */
  roles: readonly Role[];
  nodes: ReadonlyMap<string, ViewNode>;
  ids: ReadonlySet<string>;
  roots: readonly string[];
  links: readonly ViewLink[];
}

// ---- API shapes (docs/API-CONTRACT.md) ----

export interface Counts {
  items: number;
  topics: number;
  open: number;
  gaps: number;
  stars: number;
}

export interface MapNode {
  id: string;
  label: string;
  kind: NodeKind;
  plane: Plane;
  access: Access;
  counts: Counts | null;
  freshnessDays: number | null;
  signals: { open: boolean; star: boolean; gap: boolean };
  children?: MapNode[];
}

export interface Hub {
  id: string;
  label: string;
  kind: "department" | "region" | "theme" | "governance";
  group?: string;
  access: Access;
  counts: Counts | null;
  children: MapNode[];
}

export interface MapLink {
  from: string;
  to: string;
  kind: "replication" | "in-sector";
  label?: string;
}

export interface MapView {
  lens: Lens;
  viewerScopeHash: string;
  core: { id: string; label: string; topicCount: number };
  hubs: Hub[];
  links: MapLink[];
}

export interface NodeAction {
  action: Action;
  label: string;
  group: "Collaborate" | "Govern" | "Admin";
  allowed: boolean;
  reason: string;
}

export interface NodeDetail {
  node: MapNode & { facts: Record<string, string>; badges: string[] };
  items: ItemRow[];
  backlinks: { id: string; label: string; type: string }[];
  actions: NodeAction[];
}
