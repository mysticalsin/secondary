// Shapes of the v8 page lens and Who knows (docs/API-CONTRACT.md "v8 lens").

export interface PersonRef {
  id: string;
  name: string;
}

export interface GraphNode {
  key: string;
  brainId: string;
  brainName: string;
  id: string;
  title: string;
  type: string;
  collection: string;
  hop: 0 | 1 | 2;
}

export interface FactBar {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  unverified: boolean;
  contradiction: boolean;
  replacedBy: number | null;
}

export interface PersonRow {
  id: string;
  name: string;
  role: string;
  brainId: string;
  brainName: string;
  contributions: number;
  pages: number;
  lastAt: string;
  score: number;
}

export interface Contributor {
  id: string;
  name: string;
  role: string;
  changes: number;
  lastAt: string;
}

export interface Backlink {
  brainId: string;
  brainName: string;
  id: string;
  title: string;
  type: string;
  collection: string;
}

export type FreshState = "fresh" | "aging" | "stale";

export interface LensData {
  page: {
    id: string;
    title: string;
    type: string;
    collection: string;
    brainId: string;
    brainName: string;
    status: "published";
    revision: number;
    updatedAt: string;
    lastChange: { at: string; revision: number; by: PersonRef | null };
  };
  freshness: { state: FreshState; days: number; score: number; freshnessDays: number };
  verified: { by: PersonRef | null; at: string } | null;
  graph: { nodes: GraphNode[]; edges: { from: string; to: string }[] };
  facts: FactBar[];
  contributors: Contributor[];
  /** People who contributed and asked not to be named: a count, nothing more. */
  unnamed: number;
  backlinks: Backlink[];
  who: PersonRow[];
}

export interface WhoKnows {
  scope: { kind: "page" | "collection" | "query" | "brain"; label: string } | null;
  people: PersonRow[];
}
