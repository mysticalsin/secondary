// Retention and the digest line of Landing Page Studio.
//   - expireLandingPages: every page has a clock (90 days unless the owner chose another). When it runs
//     out the public object is deleted, the counts are kept on the record, and the prospect's data and
//     the copy are purged. The ops cron calls it with the other retention jobs.
//   - lpDigestItems: one line per published page for the weekly digest, with last week's counts.

import type { C } from "../ux/util.ts";
import { sess } from "../ux/util.ts";
import { deletePage, readStats } from "./stats.ts";
import { lpStub } from "./stub.ts";

const BATCH = 100;
const MAX_ROUNDS = 20;
const WEEK = 7 * 86_400_000;

export async function expireLandingPages(env: Env, tenantId: string, now: number): Promise<number> {
  const store = lpStub(env, tenantId);
  let expired = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const due = await store.due(now, BATCH);
    if (!due.length) break;
    for (const rec of due) {
      let stats = null;
      if (rec.slug) {
        stats = await readStats(env, rec.slug);
        // The object first: from here the public URL is a 404, whatever happens next.
        await deletePage(env, rec.slug);
      }
      if (await store.expire(rec.id, stats, now)) expired++;
    }
  }
  return expired;
}

export type DigestLine = { label: string; meta: string };

/** The caller's published pages with the counts of the last seven days. */
export async function lpDigestItems(c: C): Promise<DigestLine[]> {
  const s = sess(c);
  if (!s.org) return [];
  const rows = await lpStub(c.env, s.tenantId).listByOwner(s.principal.id, 50);
  const since = new Date(s.ctx.now - WEEK).toISOString().slice(0, 10);
  const out: DigestLine[] = [];
  for (const rec of rows) {
    if (rec.status !== "published") continue;
    const st = await readStats(c.env, rec.slug);
    const week = st.byDay.filter((d) => d.day > since);
    const views = week.reduce((n, d) => n + d.views, 0);
    const clicks = week.reduce((n, d) => n + d.ctaClicks, 0);
    out.push({
      label: `Landing page for ${rec.prospect.company}`,
      meta: `${views} views, ${clicks} clicks this week · expires ${new Date(rec.expiresAt).toISOString().slice(0, 10)}`,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 10);
}
