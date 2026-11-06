export const CATEGORIES = ["published", "resolved", "sources", "gaps", "rules"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface PulseDay {
  date: string;
  counts: Record<Category, number>;
  total: number;
  pages: { id: string; title: string }[];
}

export interface BrainPulse {
  brainId: string;
  name: string;
  from: string;
  to: string;
  categories: Category[];
  days: PulseDay[];
}

export interface PulseRow {
  brainId: string;
  name: string;
  type: string;
  /** `d` holds the five counts in category order. */
  days: { date: string; d: number[] }[];
}

export interface PulseAll {
  categories: Category[];
  from: string;
  to: string;
  brains: PulseRow[];
}
