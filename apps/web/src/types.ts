// Types mirror docs/API-CONTRACT.md ("workers/api: final shapes"). Lists are bare arrays.

export type Plane =
  | "GLOBAL_NONPERSONAL"
  | "TEAM_RESTRICTED"
  | "ACCOUNT_RESTRICTED"
  | "PERSONAL_HOSTED";
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
  links: { from: string; to: string; kind: "replication" | "in-sector"; label?: string }[];
}

export interface NodeItem {
  title: string;
  source: string;
  ownerRole: string;
  revision: number;
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

export interface NodeRecord {
  revision: number;
  status: string;
  approvals: number;
  required: number;
  mine: boolean;
}

export interface NodeComment {
  id: string;
  text: string;
  at: string | number;
  mine: boolean;
}

export interface NodeDetail {
  node: MapNode & { facts: Record<string, string>; badges: string[] };
  items: NodeItem[];
  backlinks: { id: string; label: string; type: string }[];
  actions: NodeAction[];
  /** Mutable record overlay (revision for edit, approvals). Null for structure nodes and locked nodes. */
  record?: NodeRecord | null;
  comments?: NodeComment[];
}

export interface Principal {
  id: string;
  email: string;
  roleIds: string[];
}

export interface Me {
  principal: Principal;
  tenantId: string;
  /** False until /v1/admin/seed has loaded the synthetic org for this tenant. */
  seeded: boolean;
  persona: string | null;
  describe: { see: string[]; do: string[]; never: string[] };
  env: "dev" | "prod" | string;
  /** Advice for the rail. The server re-checks every action. */
  capabilities: { configure: boolean; review: boolean };
  /** Claims from the Microsoft account, when the sign-in carried them. Every field is optional. */
  profile?: {
    name?: string;
    jobTitle?: string;
    department?: string;
    office?: string;
    country?: string;
  };
}

export interface SearchResult {
  id: string;
  label: string;
  kind: string;
  plane: Plane;
}

/** A file synced from SharePoint or OneDrive (GET /v1/sources/:id). */
export interface SourceRecordView {
  id: string;
  title: string;
  kind: "source";
  plane: Plane;
  webUrl: string | null;
  mime: string | null;
  size: number;
  /** Text extract, only for UTF-8 text and Markdown files. */
  body: string | null;
  syncedAt: number;
}

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
  /** Integer revision as a string. */
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
  /** Always null in B1: the directory holds no per-account member list. */
  members: null;
  sections: AccountSection[];
}

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

/** A flag on a review candidate (server scan, stored when the candidate was created). */
export interface SensitivityFlag {
  kind: string;
  span: string;
  reason: string;
}

/** The server's detector output for a text a person is about to contribute. */
export interface PersonalFlag {
  id: string;
  type: "email" | "phone" | "health" | "family" | "hr";
  field: "title" | "body";
  start: number;
  excerpt: string;
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
  origin: string;
  release: "scope" | "global";
  /** Wiki proposals (wiki_ingest, wiki_lint, wiki_dream) come with their kind. */
  kind?: string;
}

export type PersonalKind = "note" | "brief" | "view" | "draft";

export interface PersonalItem {
  id: string;
  title: string;
  body: string;
  kind: PersonalKind;
  tags?: string[];
  updatedAt: string;
  contributedTo?: { scopeId: string; candidateId: string; at: string }[];
  revision: number;
  status: string;
  sensitivity_flags: PersonalFlag[];
}

export interface ContributeTarget {
  id: string;
  label: string;
  group: string;
}

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

export const STRUCTURE_ONLY_ROLES = ["platform_admin", "auditor"];

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
  revision?: number;
  released?: boolean;
  approvals?: number;
  required?: number;
}

export interface ContributeResult {
  ok: boolean;
  receiptId: string;
  candidateId: string;
  status: string;
  sensitivity_flags: PersonalFlag[];
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

export const CALLOUT_TEMPLATES = [
  "no_access",
  "empty",
  "stale",
  "gap",
  "nda_locked",
  "personal_private",
  "candidate_pending",
] as const;
export type CalloutTemplate = (typeof CALLOUT_TEMPLATES)[number];

export interface ViewPlan {
  version: 1;
  title: string;
  components: { type: string; props: Record<string, unknown> }[];
}

// ---- B2 UX endpoints (workers/api/src/ux) ----

export interface Prefs {
  lang: "en" | "fr" | null;
  tourDone: boolean;
}

export interface RevisionRow {
  revision: number;
  title: string;
  body: string;
  at: string;
  current: boolean;
}

export interface Draft {
  key: string;
  title: string;
  body: string;
  kind: PersonalKind;
  baseRevision: number;
  at: string;
}

export interface ContributionStatus {
  candidateId: string;
  scopeLabel: string;
  at: string;
  status: "in_review" | "changes_requested" | "released" | "withdrawn" | "unknown";
  revision: number;
  approvals?: number;
  required?: number;
  feedback: { id: number; text: string; at: string }[];
}

export interface ReviewText {
  revision: number;
  title: string;
  body: string;
  at: string;
}

export interface ReviewDetail {
  id: string;
  current: ReviewText;
  previous: ReviewText | null;
  revisions: { revision: number; at: string }[];
  comments: { id: number; authorId: string; text: string; at: string; mine: boolean }[];
  decisions: {
    actorId: string;
    kind: "approved" | "changes_requested" | "accept" | "reviewed";
    at: string;
    mine: boolean;
  }[];
  twoPerson: { required: boolean; approvals: number; needed: number };
}

export type RecordSection = "dec" | "com" | "risk" | "out";

export interface AccountRec {
  id: string;
  section: RecordSection;
  title: string;
  status: string;
  revision: number;
  ownerRole: string;
  due: string | null;
  overdue: boolean;
  note: string;
  updatedAt: string;
  story?: {
    internal: string;
    lesson: string;
    external: { available: boolean; text: string | null; reason: string };
    permission: { reference: string; by: string; at: string } | null;
  };
}

export interface AccountRecords {
  canEdit: boolean;
  ownerRoles: string[];
  records: AccountRec[];
}

export interface AttentionItem {
  id: string;
  kind: "decision" | "commitment" | "risk";
  title: string;
  accountId: string;
  accountName: string;
  due: string | null;
  overdue: boolean;
  ownerRole: string;
}
