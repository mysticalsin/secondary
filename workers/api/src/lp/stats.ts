// Page statistics. The pages worker keeps the numbers (it has no other way to hand them over) and writes
// a small summary next to the pages: `stats/<slug>.json`. The API reads that file from the shared
// bucket. It holds counts only. consentRate is consented views over page loads.

import type { Stats } from "./types.ts";

const ZERO: Stats = { views: 0, ctaClicks: 0, consentRate: 0, byDay: [] };
const MAX_DAYS = 90;

interface Summary {
  loads?: unknown;
  views?: unknown;
  ctaClicks?: unknown;
  byDay?: unknown;
}
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

export const statsKey = (slug: string): string => `stats/${slug}.json`;
export const pageKey = (slug: string): string => `p/${slug}.html`;
export const imageKey = (slug: string, n: number): string => `p/${slug}/i/${n}`;

/** Everything a published page put in the bucket: the page, its images and its counts. */
export async function deletePage(env: Env, slug: string): Promise<void> {
  const keys = [pageKey(slug), statsKey(slug)];
  const l = await env.PAGES.list({ prefix: `p/${slug}/` });
  await env.PAGES.delete([...keys, ...l.objects.map((o) => o.key)]);
}

export function toStats(s: Summary): Stats {
  const views = num(s.views);
  const loads = num(s.loads);
  const byDay = (Array.isArray(s.byDay) ? s.byDay : [])
    .flatMap((d: { day?: unknown; views?: unknown; ctaClicks?: unknown }) =>
      typeof d?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day)
        ? [{ day: d.day, views: num(d.views), ctaClicks: num(d.ctaClicks) }]
        : [],
    )
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-MAX_DAYS);
  return {
    views,
    ctaClicks: num(s.ctaClicks),
    // A consented view cannot outnumber the loads it came from.
    consentRate: loads > 0 ? Math.min(1, Math.round((views / loads) * 1000) / 1000) : 0,
    byDay,
  };
}

/** The counts of one slug, zeros when the page has none yet. */
export async function readStats(env: Env, slug: string | null): Promise<Stats> {
  if (!slug) return { ...ZERO, byDay: [] };
  const o = await env.PAGES.get(statsKey(slug));
  if (!o) return { ...ZERO, byDay: [] };
  try {
    return toStats((await o.json()) as Summary);
  } catch {
    return { ...ZERO, byDay: [] };
  }
}
