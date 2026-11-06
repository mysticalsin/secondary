// Who knows: ranking by approved contributions, newest counting most. Pure. Weight 1 is a page in
// scope; a revision loses half its weight every HALF_LIFE_DAYS.

import type { LensRevision } from "../lens/store.ts";

export const HALF_LIFE_DAYS = 180;
const DAY = 86_400_000;

export interface Ranked {
  who: string;
  /** Approved changes by this person on pages in scope. */
  contributions: number;
  /** Distinct pages in scope they changed. */
  pages: number;
  lastAt: number;
  score: number;
}

/**
 * `weights` holds the pages in scope (page id to weight). A revision on any other page counts for
 * nothing, so the caller decides what is in scope after it has removed what the viewer may not read.
 */
export function rankPeople(
  revisions: readonly LensRevision[],
  weights: ReadonlyMap<string, number>,
  now: number,
): Ranked[] {
  const by = new Map<string, { n: number; pages: Set<string>; last: number; score: number }>();
  for (const r of revisions) {
    const w = weights.get(r.pageId);
    if (!w) continue;
    const age = Math.max(0, (now - r.at) / DAY);
    const e = by.get(r.who) ?? { n: 0, pages: new Set<string>(), last: 0, score: 0 };
    e.n++;
    e.pages.add(r.pageId);
    e.last = Math.max(e.last, r.at);
    e.score += w * 0.5 ** (age / HALF_LIFE_DAYS);
    by.set(r.who, e);
  }
  return [...by.entries()]
    .map(([who, e]) => ({
      who,
      contributions: e.n,
      pages: e.pages.size,
      lastAt: e.last,
      score: Math.round(e.score * 100) / 100,
    }))
    .sort((a, z) => z.score - a.score || z.lastAt - a.lastAt || a.who.localeCompare(z.who));
}
