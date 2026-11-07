// One counter per published page (Durable Object named by the slug). It holds numbers only: page loads,
// consented views, call-to-action clicks and scroll depth buckets, per UTC day. No address, no user agent,
// no identifier of any visitor is ever written. A short alarm after the first count writes a small summary
// next to the pages (`stats/<slug>.json`), which is how the API reads the numbers without this worker
// having any way to reach the brain.

import { DurableObject } from "cloudflare:workers";

export type CountKey = "load" | "view" | "cta" | "s25" | "s50" | "s75" | "s100";
const KEYS = new Set<string>(["load", "view", "cta", "s25", "s50", "s75", "s100"]);
const DAY = 86_400_000;
const KEEP_DAYS = 120;
const FLUSH_AFTER_MS = 10_000;

export type Summary = {
  v: 1;
  slug: string;
  loads: number;
  views: number;
  ctaClicks: number;
  scroll: { "25": number; "50": number; "75": number; "100": number };
  byDay: { day: string; loads: number; views: number; ctaClicks: number }[];
  updatedAt: string;
};

export const statsKey = (slug: string): string => `stats/${slug}.json`;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class PageCounter extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS counts (
          day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, k));
        CREATE TABLE IF NOT EXISTS window (minute INTEGER PRIMARY KEY, n INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `);
    });
  }

  /**
   * Counts one thing. `limit` is the page-wide events per minute: past it nothing is counted and the
   * answer says so. A page load (no event, no visitor input) is not limited.
   */
  async count(
    slug: string,
    key: string,
    now: number,
    limit: number,
  ): Promise<{ limited: boolean }> {
    if (!KEYS.has(key)) return { limited: false };
    if (key !== "load") {
      const minute = Math.floor(now / 60_000);
      this.sql.exec("DELETE FROM window WHERE minute < ?", minute);
      const row = this.sql.exec("SELECT n FROM window WHERE minute = ?", minute).toArray()[0];
      const used = (row?.n as number | undefined) ?? 0;
      if (used >= limit) return { limited: true };
      this.sql.exec(
        "INSERT INTO window (minute, n) VALUES (?, 1) ON CONFLICT(minute) DO UPDATE SET n = n + 1",
        minute,
      );
    }
    this.sql.exec(
      "INSERT INTO counts (day, k, n) VALUES (?, ?, 1) ON CONFLICT(day, k) DO UPDATE SET n = n + 1",
      dayOf(now),
      key,
    );
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('slug', ?)", slug);
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(now + FLUSH_AFTER_MS);
    return { limited: false };
  }

  summary(now: number): Summary | null {
    const slug = this.sql.exec("SELECT v FROM meta WHERE k = 'slug'").toArray()[0]?.v as
      | string
      | undefined;
    if (!slug) return null;
    const first = dayOf(now - KEEP_DAYS * DAY);
    const rows = this.sql
      .exec("SELECT day, k, n FROM counts WHERE day >= ? ORDER BY day", first)
      .toArray() as { day: string; k: string; n: number }[];
    const days = new Map<
      string,
      { day: string; loads: number; views: number; ctaClicks: number }
    >();
    const scroll = { "25": 0, "50": 0, "75": 0, "100": 0 };
    let loads = 0;
    let views = 0;
    let ctaClicks = 0;
    for (const r of rows) {
      const d = days.get(r.day) ?? { day: r.day, loads: 0, views: 0, ctaClicks: 0 };
      days.set(r.day, d);
      if (r.k === "load") {
        d.loads += r.n;
        loads += r.n;
      } else if (r.k === "view") {
        d.views += r.n;
        views += r.n;
      } else if (r.k === "cta") {
        d.ctaClicks += r.n;
        ctaClicks += r.n;
      } else if (r.k.startsWith("s")) scroll[r.k.slice(1) as keyof typeof scroll] += r.n;
    }
    return {
      v: 1,
      slug,
      loads,
      views,
      ctaClicks,
      scroll,
      byDay: [...days.values()],
      updatedAt: new Date(now).toISOString(),
    };
  }

  override async alarm(): Promise<void> {
    const s = this.summary(Date.now());
    if (s) await this.env.PAGES.put(statsKey(s.slug), JSON.stringify(s));
  }
}
