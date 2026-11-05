// Shapes of the Living Wiki API (workers/api/src/wiki/routes.ts, docs/API-CONTRACT.md "Living Wiki").

export interface WikiHealth {
  pages: number;
  facts: number;
  unverified: number;
  openFindings: number;
  openProposals: number;
  stale: number;
  lastLintAt: number | null;
  score: number;
}

export interface WikiPageRow {
  id: string;
  title: string;
  type: string;
  summary: string;
  revision: number;
  updatedAt: string;
  restricted: number;
}

export interface WikiIndex {
  ws: string;
  nodeId: string;
  label: string;
  personal: boolean;
  pages: WikiPageRow[];
  schema: { types: Record<string, { label: string; required: string[]; generated?: boolean }> };
  health: WikiHealth | null;
  settings: { autoAccept: boolean; freshnessDays: number };
  can: { contribute: boolean; edit: boolean; decide: boolean; promote: boolean };
}

export interface WikiCitation {
  title: string;
  kind: "item" | "source";
}

export interface WikiPage {
  id: string;
  type: string;
  title: string;
  revision: number;
  current: number;
  markdown: string;
  summary: string;
  citations: Record<string, WikiCitation>;
  restricted: number;
  links: { id: string; title: string; local: boolean; broken?: boolean }[];
  uncited: number;
  updatedAt: string;
}

export interface WikiDiffLine {
  type: "add" | "del" | "same";
  text: string;
}

export interface WikiRevision {
  revision: number;
  title: string;
  actor: string | null;
  at: string;
  proposalId: string | null;
  diff: WikiDiffLine[];
}

export interface WikiFact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  recordedAt: string;
  sources: { id: string; title: string }[];
  confidence: number;
  origin: "human" | "agent" | "connector";
  verifiedBy: string | null;
  unverified: boolean;
}

export interface WikiLogEntry {
  id: number;
  at: string;
  actor: string;
  kind: string;
  detail: unknown;
}

export interface WikiProposalRow {
  id: string;
  kind: "wiki_ingest" | "wiki_lint" | "wiki_dream";
  title: string;
  status: string;
  authorId: string | null;
  createdAt: string;
  detail: string;
}

export interface WikiProposal {
  id: string;
  kind: WikiProposalRow["kind"];
  status: string;
  title: string;
  rationale: string;
  detail: string;
  authorId: string | null;
  createdAt: string;
  /** Moves on with every edit; `revisionHash` is what an approval binds. */
  revision: number;
  revisionHash: string;
  approvals: number;
  required: number;
  pages: {
    pageId: string;
    type: string;
    title: string;
    before: string | null;
    after: string;
    edited: boolean;
    stale: boolean;
    diff: WikiDiffLine[];
  }[];
  facts: {
    subject: string;
    predicate: string;
    object: string;
    validAt: string;
    invalidAt?: string | null;
    origin: string;
    sources: { id: string; title: string }[];
    /** The source's own words this fact was drawn from, when the reader may see that source. */
    excerpt?: string;
  }[];
  invalidate: { factId: number; at: string; subject: string; predicate: string; object: string }[];
  confirm: number[];
  archive: string[];
  reingest: string[];
  sources: { id: string; hash: string; title: string }[];
}

export interface WikiHealthRow extends WikiHealth {
  ws: string;
  nodeId: string;
  label: string;
}

export interface WikiSearchHit {
  ws: string;
  label: string;
  pageId: string;
  title: string;
  type: string;
  summary: string;
  lines: { text: string; citations: { id: string; title: string }[] }[];
  restricted: number;
}

export interface WikiAnswer {
  unknown: boolean;
  answer:
    | {
        text: string;
        ws: string;
        pageId: string;
        page: string;
        citations: { id: string; title: string }[];
      }[]
    | null;
  reason: string | null;
  pages: { ws: string; id: string; title: string }[];
}

export interface MeetingInput {
  title: string;
  date?: string;
  decisions?: { title: string; owner?: string; status?: string }[];
  commitments?: { title: string; owner?: string; due?: string }[];
  risks?: { title: string; severity?: string }[];
}
