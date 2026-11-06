// The journal of a brain as a day of dots. A journal page holds counts and `[[page]]` links only
// (brainJournalRun), so this reads those counts back. Pure. Two kinds of dot, "gaps" and "rules", come
// from journal lines that the knowledge-gaps and rules work add (`N gaps closed`, `N rules triggered`);
// until a journal carries them they stay zero.

export const CATEGORIES = ["published", "resolved", "sources", "gaps", "rules"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Counts = Record<Category, number>;

const PATTERNS: Record<Category, RegExp> = {
  published: /(\d+) changes? published/,
  resolved: /(\d+) older facts? ended/,
  sources: /(\d+) page proposals? filed/,
  gaps: /(\d+) gaps? closed/,
  rules: /(\d+) rules? (?:triggered|fired)/,
};

export const JOURNAL_ID = /^journal-(\d{4}-\d{2}-\d{2})$/;

export interface Day {
  date: string;
  counts: Counts;
  /** Ids of the pages the journal links, before any filtering for a viewer. */
  pages: string[];
}

export function parseJournal(id: string, markdown: string): Day | null {
  const m = JOURNAL_ID.exec(id);
  if (!m) return null;
  const counts = {} as Counts;
  for (const k of CATEGORIES) {
    const n = Number(PATTERNS[k].exec(markdown)?.[1] ?? 0);
    counts[k] = Number.isFinite(n) ? Math.min(n, 9999) : 0;
  }
  const after = markdown.split(/^## Pages changed\s*$/m)[1] ?? "";
  const pages = [...after.matchAll(/\[\[([a-z0-9][a-z0-9-]{0,63})\]\]/g)].map(
    (x) => x[1] as string,
  );
  return { date: m[1] as string, counts, pages: [...new Set(pages)] };
}

export const total = (c: Counts): number => CATEGORIES.reduce((n, k) => n + c[k], 0);
