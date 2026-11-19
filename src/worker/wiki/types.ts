// Shapes of the Living Wiki (docs/DESIGN-LIVING-WIKI.md). One wiki per workspace, stored in that
// workspace's Durable Object. Nothing in this module reads another workspace.

export const PROPOSAL_KINDS = ["wiki_ingest", "wiki_lint", "wiki_dream"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const isWikiKind = (k: string): k is ProposalKind =>
  (PROPOSAL_KINDS as readonly string[]).includes(k);

export type FactOrigin = "human" | "agent" | "connector" | "seed";
/** Where a page came from. "seed" is the dev-only synthetic seed; a human edit makes it "human". */
export type PageOrigin = "human" | "seed";

export interface Fact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  recordedAt: string;
  checkedAt: string;
  sourceIds: string[];
  sourceHashes: Record<string, string>;
  confidence: number;
  origin: FactOrigin;
  verifiedBy: string | null;
  proposalId: string | null;
}

export interface NewFact {
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  /** Set when the fact is a back-filled earlier state that a later fact already replaced. */
  invalidAt?: string | null;
  sourceIds: string[];
  sourceHashes: Record<string, string>;
  confidence: number;
  origin: FactOrigin;
  /** The words of the source this fact was drawn from. Shown to the reviewer who can read that source (L-07). */
  excerpt?: string;
}

export interface PageDraft {
  pageId: string;
  type: string;
  title: string;
  /** Revision the draft was written against. null for a new page. */
  baseRevision: number | null;
  markdown: string;
  /** A reviewer wrote this text, so it is applied as written. */
  edited?: boolean;
}

export interface Proposal {
  v: 1;
  kind: ProposalKind;
  title: string;
  rationale: string;
  origin: FactOrigin;
  pages: PageDraft[];
  facts: NewFact[];
  invalidate: { factId: number; at: string }[];
  confirm: number[];
  archive: string[];
  reingest: string[];
  sources: { id: string; hash: string; title: string }[];
  findingKey: string | null;
  /** Free text shown to the reviewer (what the finding is). */
  detail?: string;
  /**
   * Every source whose content can appear in the title, rationale, detail or fact text of this
   * proposal. A viewer who cannot read all of them sees "restricted source" instead (H-02).
   */
  titleSources?: string[];
  /** Pages a lint finding is about; their sources are added to `titleSources`. */
  subjectPages?: string[];
}

export interface PageRow {
  id: string;
  type: string;
  title: string;
  markdown: string;
  summary: string;
  revision: number;
  status: "published" | "archived";
  origin: PageOrigin;
  createdAt: number;
  updatedAt: number;
}

export interface SchemaType {
  label: string;
  required: string[];
  /** Rendered from facts. Reviewers see a diff, nobody edits the text by hand. */
  generated?: boolean;
}
export interface WikiSchema {
  types: Record<string, SchemaType>;
  tone: string;
}

export const DEFAULT_SCHEMA: WikiSchema = {
  types: {
    overview: { label: "Overview", required: ["Needs attention", "Pages"], generated: true },
    decision_log: { label: "Decision log", required: ["Decisions"], generated: true },
    commitments: { label: "Commitments", required: ["Commitments"], generated: true },
    risk_register: { label: "Risk register", required: ["Risks"], generated: true },
    topic: { label: "Topic", required: ["Summary"] },
    method: { label: "Method", required: ["Summary", "Steps"] },
    glossary: { label: "Glossary", required: ["Terms"] },
    stakeholders: { label: "Stakeholder roles", required: ["Roles"] },
  },
  tone: "Factual and short. Roles and opaque references, never names of private persons.",
};

export interface SourceInfo {
  id: string;
  kind: "item" | "source";
  title: string;
  body: string;
  hash: string;
  tags: string[];
  status: string;
  authorId: string | null;
  itemKind: string;
  updatedAt: number;
  /** The policy node a reader needs at content level before this source counts as readable. */
  gateNodeId: string;
}

export interface Finding {
  key: string;
  kind:
    | "contradiction"
    | "orphan"
    | "broken_link"
    | "source_changed"
    | "stale"
    | "uncited"
    | "schema";
  title: string;
  detail: string;
  /** What approving the finding does. */
  proposal: Omit<Proposal, "v" | "kind" | "origin" | "findingKey" | "sources" | "rationale"> &
    Partial<Pick<Proposal, "rationale">>;
}

export interface Health {
  pages: number;
  facts: number;
  unverified: number;
  openFindings: number;
  openProposals: number;
  stale: number;
  lastLintAt: number | null;
  /** 0 to 100, 100 is healthy. */
  score: number;
}

/** What a workspace id means as a policy node and a plane. */
export const nodeOfScope = (scope: string): string =>
  scope === "global" ? "core" : scope.startsWith("personal:") ? `pb:${scope.slice(9)}` : scope;
export const scopeOfNodeId = (nodeId: string): string =>
  nodeId === "core" ? "global" : nodeId.startsWith("pb:") ? `personal:${nodeId.slice(3)}` : nodeId;
export const isPersonalScope = (scope: string): boolean => scope.startsWith("personal:");
