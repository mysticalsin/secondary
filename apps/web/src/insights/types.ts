// Shapes of GET /v1/brains/:id/insights and /v1/brains/overview (docs/API-CONTRACT.md "v5 Brain
// Insights"). The server aggregates and masks; the web only draws what comes back.

export type Mode = "relevance" | "freshness";
export type ScoreKind = "freshness" | "confidence" | "evidence";
export type SourceKind = "sharepoint" | "meetings" | "agents" | "manual" | "import";
export type FlowKey = "ingested" | "proposed" | "reviewed" | "published" | "promoted";

export interface Dot {
  pageId: string | null;
  sector: string;
  /** 0 centre to 1 edge. */
  r: number;
  score: number;
  /** Pages the dot stands for. */
  k: number;
  inZone: boolean;
  title?: string;
  label?: string;
  highlight?: boolean;
}

export interface Constellation {
  mode: Mode;
  q: string;
  seed: number;
  terms: { term: string; hits: number }[];
  sectors: { id: string; label: string; count: number }[];
  dots: Dot[];
  rings: number[];
  legend: { inZone: number; below: number; perDot: number; threshold: number; total: number };
}

export interface HealthPoint {
  pageId: string | null;
  title: string | null;
  score: number;
  scores: Record<ScoreKind, number>;
  source: SourceKind;
  k: number;
}

export interface CoverageRow {
  key: string;
  label: string;
  value: number;
  target: number;
  unit: "pages" | "lines";
  state: "ok" | "low" | "missing";
}

export interface TimelineBar {
  label: string;
  start: string;
  end: string;
  kind: string;
}

export interface ActivityData {
  from: string;
  to: string;
  days: { date: string; count: number }[];
}

export interface Focus {
  kind: "brain" | "page";
  pageId: string | null;
  title: string;
  type: string;
  coverage: CoverageRow[];
  timeline: TimelineBar[];
  activity: ActivityData;
  status: { value: "active" | "watch" | "dormant"; since: string | null } | null;
}

export interface Health {
  scoreKind: ScoreKind;
  threshold: number;
  total: number;
  perPoint: number;
  points: HealthPoint[];
  above: Record<ScoreKind, number>;
  weekDelta: Record<ScoreKind, number>;
  sources: { kind: SourceKind; count: number }[];
}

export interface Flow {
  window: string;
  stages: { key: FlowKey; count: number }[];
  publishRate: number | null;
  medianDaysToReview: number | null;
  seenAllRate: number | null;
}

export interface Insights {
  brainId: string;
  name: string;
  generatedAt: string;
  window: string;
  constellation: Constellation;
  focus: Focus;
  health: Health;
  flow: Flow;
  activity: ActivityData;
  timeline: TimelineBar[];
}

export interface OverviewTile {
  id: string;
  type: string;
  name: string;
  template: string;
  pages: number;
  health: { score: number };
  zone: { inZone: number; total: number };
  seed: number;
  dots: { s: number; r: number; z: boolean; k: number }[];
  sectors: number;
  sparkline: number[];
  lastActivityAt: string | null;
}

export interface InsightQuery {
  mode?: Mode;
  q?: string;
  scoreKind?: ScoreKind;
  focus?: string | null;
  window?: string;
}
