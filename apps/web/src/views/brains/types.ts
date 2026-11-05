// Shapes of the v3 brains endpoints (docs/API-CONTRACT.md "v3 brains"). The server decides every
// bound; the web only renders what comes back.

export type BrainType = "personal" | "team" | "account" | "global";
export type BrainRole = "reader" | "contributor" | "editor" | "steward" | "owner";
export type Publication = "review" | "direct";
export type Everyone = "none" | "reader" | "contributor";
export type Sensitivity = "none" | "confidential" | "personal";
export type FieldType = "text" | "number" | "date" | "select" | "email" | "phone" | "url";
export type Template = "personal" | "team" | "account" | "bid" | "practice" | "global" | "blank";

export interface Component {
  value: number;
  score: number;
}
export interface Health {
  score: number;
  components: {
    lint: Component | null;
    freshness: Component;
    orphans: Component;
    backlog: Component | null;
    coverage: Component & { have: number; want: number; missing: string[] };
  };
}

export interface BrainCard {
  id: string;
  /** The caller's effective role in this brain (nav and directory answers). */
  role?: BrainRole;
  type: BrainType;
  name: string;
  template: Template;
  readers: number;
  manages: boolean;
  restricted: boolean;
  publication: Publication;
  pages: number;
  health: { score: number };
  lastActivityAt: string | null;
}

/** `GET /v1/brains/nav` (docs/API-CONTRACT.md "v4"). Accounts is a group whose `children` are brains. */
export interface NavBrain extends BrainCard {
  role: BrainRole;
}
export interface NavItem extends NavBrain {
  group: "personal" | "governance" | "global";
  governanceId?: string;
  children?: NavBrain[];
}
/** `GET /v1/brains?scope=all`: an openable brain, or one the person can see but not open. */
export type DirectoryEntry =
  | (BrainCard & { canOpen: true })
  | {
      id: string;
      type: BrainType;
      name: string;
      canOpen: false;
      restricted: boolean;
      canRequestAccess: boolean;
    };

export interface Change {
  pageId: string;
  title: string;
  type: string;
  change: "new" | "updated";
  revision: number;
  at: string;
  actor: string | null;
  added: number;
  removed: number;
}

export interface BrainHome extends Omit<BrainCard, "health"> {
  health: Health;
  collections: { type: string; label: string; count: number; expected: boolean }[];
  changedThisWeek: { since: string; total: number; items: Change[] };
  coach: {
    available: boolean;
    suggestions: { kind: "missing_collection"; collection: string; message: string }[];
  };
}

export interface RoleInfo {
  id: BrainRole;
  label: string;
  summary: string;
  actions: string[];
}
export interface Member {
  principalId: string;
  email: string;
  role: BrainRole;
  state: "active" | "pending";
}
export interface AccessView {
  brainId: string;
  type: BrainType;
  canManage: boolean;
  publication: {
    mode: Publication;
    allowed: Publication[];
    forced: boolean;
    reason: string | null;
  };
  everyone: { level: Everyone; allowed: Everyone[]; reason: string | null };
  roles: RoleInfo[];
  members: Member[] | null;
}
export interface MemberResult {
  ok: true;
  status: "applied" | "pending";
  changeId?: string;
  member: { principalId: string; role: BrainRole };
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  sensitivity: Sensitivity;
  retentionDays: number | null;
  appliesTo: string[];
}
export interface FieldsView {
  fields: FieldDef[];
  types: FieldType[];
  sensitivities: Sensitivity[];
}

export interface Version {
  revision: number;
  at: string;
  actor?: string | null;
  hidden: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  reason?: string;
}

export type ImportFormat = "okf" | "obsidian" | "outline";
export interface ImportResult {
  ok: true;
  format: ImportFormat;
  imported: { pageId: string; title: string; state: "published" | "draft"; proposalId?: string }[];
  skipped: { path: string; reason: string }[];
  asked: number;
}

/** `POST .../import?dryRun=1`: the classifier's verdicts, nothing stored. */
export interface ImportPreview {
  ok: true;
  dryRun: true;
  format: ImportFormat;
  pages: {
    path: string;
    pageId: string;
    title: string;
    type: string;
    verdict: "ingest" | "ask";
    reason: string;
    excluded: Record<string, number>;
    replaces: boolean;
    state: "published" | "draft";
  }[];
  skipped: { path: string; reason: string }[];
  asked: number;
}

export interface JournalDays {
  days: { date: string; pageId: string }[];
}

export interface CoachQuestion {
  id: string;
  prompt: string;
  kind: "choice" | "text" | "list";
  options?: string[];
}
export interface CoachTemplate {
  id: string;
  label: string;
  collections: { type: string; label: string; required: string[] }[];
}
export interface CoachView {
  brainId: string;
  questions: CoachQuestion[];
  templates: CoachTemplate[];
  current: { template: Template; collections: string[] };
}
export interface CoachProposal {
  proposalId: string;
  hash: string;
  template: Template;
  collections: { type: string; label: string; required: string[]; action: "add" | "keep" }[];
  rationale: string;
  expiresAt: string;
}

export type HostId =
  | "claude_code"
  | "claude_ai"
  | "chatgpt"
  | "codex"
  | "dust"
  | "copilot_studio"
  | "other";
export interface AgentHost {
  id: HostId;
  label: string;
  connected: boolean;
  lastCallAt: string | null;
  calls: number;
  scopes: string[];
  connections: {
    id: string;
    lastCallAt: string | null;
    lastTool: string | null;
    scopes: string[];
    state: "active" | "revoked";
  }[];
}

export interface Cohort {
  id: string;
  name: string;
  members: string[];
  flags: Record<string, boolean>;
  createdAt: string;
}
export interface PilotView {
  cohorts: Cohort[];
  flagKeys: string[];
}

export interface BatchResult {
  results: { id: string; ok: boolean; status: string; error?: string; reason?: string }[];
  ok: number;
  failed: number;
}
