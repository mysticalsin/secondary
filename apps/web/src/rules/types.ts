// v7 Brain rules: the API shapes (docs/API-CONTRACT.md "v7 Brain rules"). The rule model itself
// (RuleDraft, Condition, RuleEffect, FloorId, RuleChange, RuleIssue) comes from @secondary/policy.
import type {
  Condition,
  FloorId,
  RuleChange,
  RuleDraft,
  RuleEffect,
  RuleScope,
  RuleStatus,
} from "@secondary/policy";

export type { Condition, FloorId, RuleChange, RuleDraft, RuleEffect, RuleScope, RuleStatus };

export interface RuleRow {
  id: string;
  name: string;
  scope: RuleScope;
  scopeLabel: string;
  status: RuleStatus;
  /** The published version, 0 when the rule was never published. */
  version: number;
  effect: RuleEffect;
  updatedAt: string;
  updatedBy: string;
  hasDraft: boolean;
  editable: boolean;
  readOnly?: true;
  floor?: FloorId;
}

export interface IncidentState {
  on: boolean;
  since: string | null;
  until: string | null;
  by?: "you" | "other";
  pending: boolean;
}

export interface HoldRow {
  id: string;
  rule: string;
  action: string;
  brain: { id: string; label: string };
  requestedAt: string;
  required: number;
  approvals: number;
  group: string[];
  mine: boolean;
  canDecide: boolean;
}

export interface RulesList {
  canEdit: boolean;
  brain: { id: string; label: string } | null;
  rules: RuleRow[];
  counts: {
    total: number;
    enforced: number;
    monitor: number;
    draft: number;
    new: number;
    since: string;
  };
  incident: IncidentState;
  holds: HoldRow[];
}

export interface VersionRow {
  version: number;
  status: RuleStatus;
  by: string;
  at: string;
  rolledBackFrom?: number;
  changes: RuleChange[];
}

export interface PendingState {
  by: "you" | "other";
  at: string;
  kind: "publish" | "rollback";
  /** For a publish: the version it will create. For a rollback: the version to restore. */
  version: number;
}

export interface RuleDetail extends RuleRow {
  draft: RuleDraft;
  published: RuleDraft | null;
  nextVersion: number;
  editedBy: string;
  editedAt: string;
  needsSecond: boolean;
  pending: PendingState | null;
  history: VersionRow[];
}

export interface SimulationSample {
  /** ISO text or epoch milliseconds. */
  at: string | number;
  actor: { kind: "human" | "agent" | "connector"; host?: string | null };
  action: string;
  brain: { id: string; label: string };
  effect: RuleEffect;
}

export interface SimulationView {
  days: 7 | 30;
  total: number;
  matches: number;
  split: { approval: number; blocked: number; allowed: number };
  samples: SimulationSample[];
  addedWaitMin: number;
  approvalsPerDay: number;
  estimate: true;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  floor?: FloorId;
}

export type PublishResult =
  | { status: "published"; version: number; rule: RuleDetail }
  | { status: "pending"; needs: "second_person"; rule: RuleDetail; sameActor?: boolean };

export interface BrainChoice {
  id: string;
  label: string;
  type: string;
}
