// Shapes of the UX v2 endpoints (docs/API-CONTRACT.md "UX v2 endpoints"). Fields marked "assumed"
// are not fixed by the contract yet and are always read defensively.
import type { ViewPlan } from "../types";

export type AskEvent =
  | { event: "status"; data: { stage: string } }
  | {
      event: "citation";
      data: { pageId: string; title: string; workspaceId: string; sourceIds: string[] };
    }
  | { event: "plan"; data: ViewPlan }
  | { event: "answer"; data: { markdown: string; unknown: boolean } }
  | { event: "usage"; data: AskUsage }
  | { event: "done"; data: Record<string, never> };

export interface AskUsage {
  inputTokens: number;
  outputTokens: number;
  indexTokensRead: number;
  fullContextEstimate: number;
  savedPct: number;
  processor: "anthropic" | "deterministic";
}

export interface AskCitation {
  pageId: string;
  title: string;
  workspaceId: string;
  sourceIds: string[];
}

export interface TreeNode {
  id: string;
  label: string;
  kind: "workspace" | "folder" | "page";
  access: "full" | "partial" | "locked";
  count?: number;
  children?: TreeNode[];
}

export type BrainRoot = "personal" | "company";

export type QuestionKind = "ingest" | "contradiction" | "lint" | "review" | "release";

export interface QuestionSide {
  text: string;
  sources: string[];
}

export interface Question {
  id: string;
  kind: QuestionKind;
  title: string;
  workspaceId: string;
  createdAt: string;
  summary: string;
  options: { action: string; label: string }[];
  /**
   * Contradiction: `{current, incoming}` (contract). Ingest: `reason` (assumed). Review and release:
   * `approvals`, `required`, `revisionHash` (assumed), the two-person status.
   */
  detail?: {
    current?: QuestionSide;
    incoming?: QuestionSide;
    reason?: string;
    approvals?: number;
    required?: number;
    revisionHash?: string;
  } | null;
}

export interface Routine {
  id: string;
  name: string;
  source: { kind: "sharepoint" | "meetings" | "notes" | "manual"; ref?: string };
  schedule: "daily" | "weekly" | "manual";
  targetScopeId: string;
  guardrails: { excludePersonal: true; excludeHR: true; excludeNewsletters: boolean };
  enabled: boolean;
}

export type RoutineInput = Omit<Routine, "id">;

export interface RunItem {
  title: string;
  verdict: "ingest" | "skip" | "ask";
  reason: string;
}

export interface RoutineRun {
  id: string;
  at: string;
  ingested: number;
  skipped: number;
  asked: number;
  tokens: number;
  items: RunItem[];
}

export interface UsageBlock {
  tokens: number;
  runs: number;
  answers?: number;
  savedPct: number;
  byCapability?: { capability: string; tokens: number; runs: number }[];
}

export interface Usage {
  me: UsageBlock;
  byCapability: { capability: string; tokens: number; runs: number }[];
  tenant?: UsageBlock;
}

export interface Digest {
  weekOf: string;
  sections: { title: string; items: { label: string; pageId?: string; meta: string }[] }[];
  stats: { opportunities: number; newLeads: number; commitmentsDue: number; wins: number };
}
