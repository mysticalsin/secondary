// Brain pulse (docs/DESIGN-V8-AMAZING.md section 6): the journal as dots per day. One brain at a
// time, built from that brain's own journal pages. A row for Home exists only for a brain the caller
// reads, and its pages are named only when the caller may read them.

import { Hono } from "hono";
import { admittedBrainParams, type Brain, brainOf, needBrain, needFlag } from "../brains/open.ts";
import { type Seen, SKIP_TYPES, seeBrains } from "../brains/shared.ts";
import { humanIdsOf } from "../human.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { bad, type C, notFound, sess } from "../ux/util.ts";
import { CATEGORIES, type Counts, type Day, parseJournal, total } from "./parse.ts";

const DAY = 86_400_000;
const MAX_DAYS = 90;
const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

const daysOf = (c: C, def: number): number => {
  const raw = c.req.query("days");
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 7 || n > MAX_DAYS) throw bad("invalid_days");
  return n;
};

async function journalDays(x: Seen, from: string): Promise<Day[]> {
  const rows = await x.brain.stub.lensJournals(MAX_DAYS + 7);
  return rows
    .map((r) => parseJournal(r.id, r.markdown))
    .filter((d): d is Day => d !== null && d.date >= from)
    .sort((a, z) => z.date.localeCompare(a.date));
}

export function pulseRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use("/brains/:id/pulse", async (c, next) => (await needFlag(c, "journal")) ?? next());
  r.use("/pulse", async (c, next) => (await needFlag(c, "journal")) ?? next());

  r.get("/brains/:id/pulse", async (c) => {
    const days = daysOf(c, 60);
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const [x] = await seeBrains(c, [b]);
    if (!x) throw notFound();
    const now = sess(c).ctx.now;
    const from = isoDay(now - (days - 1) * DAY);
    const titles = new Map(
      x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map((p) => [p.id, p.title] as const),
    );
    const list = (await journalDays(x, from)).map((d) => ({
      date: d.date,
      counts: d.counts,
      total: total(d.counts),
      // Only pages this caller may read are named.
      pages: d.pages.flatMap((id) =>
        titles.has(id) ? [{ id, title: titles.get(id) as string }] : [],
      ),
    }));
    c.header("Cache-Control", "no-store");
    return c.json({
      brainId: b.param,
      name: b.label,
      from,
      to: isoDay(now),
      categories: CATEGORIES,
      days: list,
    });
  });

  // One row per brain the caller reads (Home). Compact: counts in category order, newest first.
  r.get("/pulse", async (c) => {
    const days = daysOf(c, 30);
    const s = sess(c);
    const humanIds = await humanIdsOf(c.env, s);
    const brains = (
      await Promise.all(admittedBrainParams(c).map((p) => brainOf(c, p.param, humanIds)))
    ).filter((b): b is Brain => b !== null);
    const seen = await seeBrains(c, brains);
    const from = isoDay(s.ctx.now - (days - 1) * DAY);
    const rows = await Promise.all(
      seen.map(async (x) => ({
        brainId: x.brain.param,
        name: x.brain.label,
        type: x.brain.facts.type,
        days: (await journalDays(x, from)).map((d) => ({
          date: d.date,
          d: CATEGORIES.map((k) => d.counts[k as keyof Counts]),
        })),
      })),
    );
    c.header("Cache-Control", "no-store");
    return c.json({ categories: CATEGORIES, from, to: isoDay(s.ctx.now), brains: rows });
  });
  return r;
}
