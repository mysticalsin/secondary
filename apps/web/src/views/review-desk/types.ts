// Review desk wire types (docs/API-CONTRACT.md "v8 Review desk"). They mirror workers/api/src/review.

export type DeskKind = "ingest" | "contradiction" | "lint" | "review" | "release";
export type What =
  | "new_page"
  | "change"
  | "contradiction"
  | "import"
  | "session_report"
  | "release"
  | "review"
  | "lint"
  | "ingest";
export type Section = "decision" | "contradictions" | "mentions" | "fyi" | "snoozed";
export type RiskKey = "client" | "personal" | "confidential" | "rule" | "unsupported";

export interface DeskRow {
  id: string;
  kind: DeskKind;
  what: What;
  title: string;
  brain: {
    id: string;
    name: string;
    type: "personal" | "team" | "account" | "global" | null;
    sensitivity: "low" | "medium" | "high";
  };
  author: { id: string; agent: boolean } | null;
  createdAt: string;
  age: { hours: number; businessDays: number; slaDays: number; state: "ok" | "near" | "overdue" };
  effortMinutes: number;
  risk: RiskKey[];
  priority: number;
  reasons: string[];
  section: Exclude<Section, "fyi">;
  snoozedUntil: string | null;
  assignedTo: string | null;
  assignedToMe: boolean;
  waitingOnAuthor: boolean;
  summary: { text: string; source: "rules" | "ai" };
  approvals: number;
  required: number;
  changeCount: number;
}

export interface FyiRow {
  id: string;
  title: string;
  brainId: string;
  brainName: string;
  decidedAt: string;
  by: string;
  status: string;
}

export interface StripDot {
  id: string;
  day: string;
  state: "waiting" | "approved" | "rejected";
  slot: number;
}

export interface Desk {
  generatedAt: string;
  sections: {
    decision: DeskRow[];
    contradictions: DeskRow[];
    mentions: DeskRow[];
    fyi: FyiRow[];
    snoozed: DeskRow[];
  };
  counts: Record<Section | "waiting", number>;
  strip: { days: string[]; dots: StripDot[] };
  kpis: {
    waiting: number;
    medianHoursToDecision: number | null;
    overdue: number;
    clearedThisWeek: number;
  };
  slaDefaultDays: number;
}

export interface Person {
  id: string;
  name: string;
  handle: string;
}

export interface Risk {
  clients: string[];
  personalData: { count: number; kinds: string[] };
  confidential: string[];
  rule: string | null;
  unsupported: number;
}

export interface DeskComment {
  id: number;
  authorId: string;
  name: string | null;
  text: string;
  at: string;
  mine: boolean;
  mentions: string[];
}

export interface DeskDetail {
  id: string;
  summary: { text: string; source: "rules" | "ai" };
  risk: Risk;
  context: {
    pageTitle: string | null;
    current: string | null;
    facts: { id: number; subject: string; predicate: string; object: string }[];
    hiddenFacts: number;
  };
  comments: DeskComment[];
  eligible: Person[];
  state: {
    snoozedUntil: string | null;
    assignedTo: { id: string; name: string | null } | null;
    waitingOnAuthor: boolean;
  };
  slaDays: number;
}

export interface SlaInfo {
  days: number;
  defaultDays: number;
  min: number;
  max: number;
  canSet: boolean;
}
