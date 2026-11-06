export interface FacetRow {
  id: string;
  label: string;
  n: number;
  on: boolean;
}

export type FacetKey = "brain" | "type" | "fresh" | "status" | "role";

export interface Hit {
  brainId: string;
  brainName: string;
  id: string;
  title: string;
  type: string;
  collection: string;
  summary: string;
  updatedAt: string;
  ageDays: number;
  fresh: "lt30" | "lt90" | "lt180" | "older";
  status: "verified" | "unverified";
  role: string;
  lines: { text: string; citations: { id: string; title: string }[] }[];
  restricted: number;
}

export interface SearchResult {
  q: string;
  parsed: {
    text: string;
    brain: string[];
    type: string[];
    status: string[];
    role: string[];
    fresh: { op: "lt" | "gt"; days: number } | null;
    ignored: string[];
  };
  total: number;
  results: Hit[];
  facets: Record<FacetKey, FacetRow[]>;
}

export interface Saved {
  id: string;
  name: string;
  q: string;
  at: string;
}

/** The filters a person has picked from the facets (the words and operators live in `q`). */
export type Picked = Partial<Record<Exclude<FacetKey, "fresh">, string[]>> & { age?: string[] };
