// Types mirror docs/API-CONTRACT.md. Shapes marked "ASSUMED" are not in the contract yet
// (see apps/web/README notes in the handoff) and must be confirmed with workers/api.

export type Plane = "GLOBAL" | "DEPARTMENT" | "TEAM" | "ACCOUNT_RESTRICTED" | "PERSONAL";
export type Access = "full" | "partial" | "locked";
export type Lens = "departments" | "accounts" | "topics" | "governances";
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

export interface Counts {
  items: number;
  topics: number;
  open: number;
  gaps: number;
  stars: number;
}

export interface Signals {
  open: boolean;
  star: boolean;
  gap: boolean;
}

export interface MapNode {
  id: string;
  label: string;
  kind: string;
  plane: Plane;
  access: Access;
  counts: Counts | null;
  freshnessDays: number | null;
  signals: Signals;
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

export interface MapView {
  lens: Lens;
  viewerScopeHash: string;
  core: { id: string; label: string; topicCount: number };
  hubs: Hub[];
  links: { from: string; to: string; label?: string }[];
}

export interface NodeItem {
  title: string;
  source: string;
  ownerRole: string;
  revision: string;
  evidence: "supported" | "partial" | "unsupported";
  plane: Plane;
  reviewedBy2: boolean;
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
  items: NodeItem[];
  backlinks: { id: string; label: string; type: string }[];
  actions: NodeAction[];
}

export interface Principal {
  id: string;
  email: string;
  roleIds: string[];
}

export interface Me {
  principal: Principal;
  persona: string | null;
  describe: { see: string[]; do: string[]; never: string[] };
  env: "dev" | "prod" | string;
  /** ASSUMED: server-side canDo summary used to show Admin and Review in the rail. */
  capabilities?: { configure?: boolean; review?: boolean };
}

export interface SearchResult {
  id: string;
  label: string;
  kind: string;
  plane: Plane;
}

// ASSUMED: /v1/accounts and /v1/accounts/:id
export interface AccountCard {
  id: string;
  name: string;
  country: string;
  region: string;
  sector: string;
  status: string;
  aiProcessing: "allowed" | "not allowed" | "unknown";
  openItems: number;
  stars: number;
  plane: Plane;
}

export interface AccountRecord {
  id: string;
  title: string;
  status: string;
  revision: string;
  note?: string;
  story?: {
    internal: boolean;
    lesson: boolean;
    external: { available: boolean; reason: string };
  };
}

export interface AccountSection {
  key: string;
  label: string;
  items: AccountRecord[];
}

export interface AccountDetail {
  account: AccountCard;
  members: string[] | null;
  sections: AccountSection[];
}

// ASSUMED: /v1/governances and /v1/governances/:id
export const STAGES = ["Discover", "In design", "Building", "Piloting", "Deployed"] as const;
export type Stage = (typeof STAGES)[number];

export interface GovernanceCard {
  id: string;
  label: string;
  group: "Business line" | "Corporate function";
  useCases: number;
  stages: Record<Stage, number>;
}

export interface UseCase {
  id: string;
  title: string;
  stage: Stage;
  evidence: "supported" | "partial" | "unsupported";
}

export interface GovernanceDetail {
  governance: GovernanceCard;
  useCases: UseCase[];
}

// ASSUMED: /v1/review
export interface SensitivityFlag {
  kind: string;
  span: string;
  reason: string;
}

export interface DiffLine {
  type: "add" | "del" | "same";
  text: string;
}

export interface Candidate {
  id: string;
  nodeId: string;
  title: string;
  scopeLabel: string;
  plane: Plane;
  author: string;
  revision: string;
  previousRevision: string | null;
  submittedAt: string;
  diff: DiffLine[];
  flags: SensitivityFlag[];
  twoPerson: { required: boolean; approvals: number; needed: number };
  approve: { allowed: boolean; reason: string };
  requestChanges: { allowed: boolean; reason: string };
}

// ASSUMED: /v1/personal/items
export type PersonalKind = "note" | "brief" | "view" | "draft";

export interface PersonalItem {
  id: string;
  title: string;
  body: string;
  kind: PersonalKind;
  updatedAt: string;
  contributedTo?: { scopeId: string; candidateId: string; at: string }[];
}

export interface ContributeTarget {
  id: string;
  label: string;
  group: string;
}

// ASSUMED: /v1/admin/roles, /v1/admin/audit
export interface AdminGrant {
  scope_type: string;
  scope_id: string;
  actions: Action[];
  conditions: Record<string, unknown>;
}

export interface AdminRole {
  id: string;
  label: string;
  summary: string;
  grants: AdminGrant[];
  exclusions: string[];
  never: string[];
  members: number;
}

export interface AuditReceipt {
  id: string;
  at: string;
  actor: string;
  action: string;
  scope: string;
  result: string;
}

export interface ActivityEntry {
  id: string;
  title: string;
  scopeLabel: string;
  revision: string;
  at: string;
  nodeId: string;
}

export interface ActionResult {
  ok: boolean;
  receiptId: string;
}

// GenUI
export const CATALOG_TYPES = [
  "KpiRow",
  "NodeCard",
  "ItemList",
  "AccountSummary",
  "StageBoard",
  "MapMini",
  "Callout",
  "Table",
] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

export interface ViewPlan {
  version: 1;
  title: string;
  components: { type: string; props: Record<string, unknown> }[];
}
