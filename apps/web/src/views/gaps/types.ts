// Knowledge gap wire types (docs/API-CONTRACT.md "v8 Knowledge gaps"). They mirror workers/api/src/gaps.

export type GapStatus = "open" | "assigned" | "drafted" | "closed" | "dismissed";
export type DismissReason =
  | "not_relevant"
  | "answered_elsewhere"
  | "out_of_scope"
  | "duplicate"
  | "other";
export const DISMISS_REASONS: readonly DismissReason[] = [
  "not_relevant",
  "answered_elsewhere",
  "out_of_scope",
  "duplicate",
  "other",
];

export interface Gap {
  id: string;
  text: string;
  count: number;
  askers: number;
  byRole: Record<string, number>;
  bySource: { ask: number; agent: number; search: number };
  /** Last 14 days, oldest first. */
  days: { date: string; count: number }[];
  firstAt: string;
  lastAt: string;
  score: number;
  status: GapStatus;
  assignedTo: { id: string; name: string | null } | null;
  due: string | null;
  overdue: boolean;
  proposalId: string | null;
  pageId: string | null;
  dismissedReason: DismissReason | null;
  mergedFrom: number;
  reopened: number;
}

export interface GapKpi {
  windowDays: number;
  /** Percent, or null when nothing needed an answer in the window. */
  closureRate: number | null;
  open: number;
  assigned: number;
  drafted: number;
  closed: number;
  dismissed: number;
  overdue: number;
}

export interface GapList {
  brain: { id: string; name: string };
  canSteward: boolean;
  gaps: Gap[];
  kpi: GapKpi;
  /** Contributors a steward may assign to. Empty for a non-steward. */
  eligible: { id: string; name: string }[];
}

export interface TopGap extends Gap {
  brainId: string;
  brainName: string;
}

export interface TopGaps {
  gaps: TopGap[];
  kpi: GapKpi;
  /** False when the caller stewards no brain with gaps: the Home card stays away. */
  stewards: boolean;
}
