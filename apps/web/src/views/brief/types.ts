// Wire shapes of POST /v1/briefs (workers/api/src/ai/brief.ts).

export interface BriefClaim {
  text: string;
  citations: string[];
  unknown: boolean;
}

export interface BriefSection {
  heading: string;
  claims: BriefClaim[];
}

export interface BriefEvidence {
  id: string;
  nodeId: string;
  title: string;
  plane: string;
}

export interface BriefExcluded {
  evidenceId: string;
  line: number;
  category: string;
  excerpt: string;
}

export interface Brief {
  target: { accountId: string | null; nodeId: string; meetingId: string | null };
  question: string | null;
  title: string;
  sections: BriefSection[];
  evidence: BriefEvidence[];
  excluded: BriefExcluded[];
  insufficientEvidence: boolean;
  dropped: { uncited: number; badCitations: number };
  disclosure: {
    processor: string;
    model: string;
    region: string;
    generatedAt: string;
    usage: { inputTokens: number; outputTokens: number };
  };
  /** Returned by the server and sent back unchanged on save (L-04). */
  proof?: string;
}

export interface BriefResponse {
  brief: Brief;
  saved: { id: string; revision: number } | null;
}

export interface AiStatus {
  state: "ready" | "disabled" | "not_configured";
  reason: string | null;
  processor: string;
  model: string | null;
  region: string;
}

export interface BriefRequest {
  accountId?: string;
  nodeId?: string;
  meetingId?: string;
  question?: string;
  save?: boolean;
}
