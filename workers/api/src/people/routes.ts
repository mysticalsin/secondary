// Who knows (docs/DESIGN-V8-AMAZING.md section 4) and the expert-listing choice. Computed only from
// brains the caller reads, only from pages the caller may read, never from a Personal Brain, and
// never naming a person who opted out. Work activity only: approved changes, nothing about people.

import { Hono } from "hono";
import { needBrain, needFlag } from "../brains/open.ts";
import { rateLimit, type Seen, SKIP_TYPES, seeBrains } from "../brains/shared.ts";
import { clean, readableBrains, roleIn, standingOf } from "../lens/shared.ts";
import { personalScope } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, readObject, sess } from "../ux/util.ts";
import { canGlobal, filterMarkdown } from "../wiki/routes.ts";
import { linksOf, matchOfTokens, PAGE_ID, tokensOf } from "../wiki/text.ts";
import { rankPeople } from "./rank.ts";

export interface PersonRow {
  id: string;
  name: string;
  role: string;
  brainId: string;
  brainName: string;
  contributions: number;
  pages: number;
  lastAt: string;
  score: number;
}

const MAX_LIMIT = 20;
const limitOf = (c: C): number => {
  const raw = c.req.query("limit");
  if (raw === undefined) return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw bad("invalid_limit");
  return n;
};

/** The people for pages in scope of one brain, listed brains only. Opted-out people are dropped. */
export async function peopleFor(
  c: C,
  x: Seen,
  weights: ReadonlyMap<string, number>,
  limit: number,
): Promise<PersonRow[]> {
  if (x.brain.personal || !weights.size) return [];
  const now = sess(c).ctx.now;
  const revisions = await x.brain.stub.lensRevisions();
  const ranked = rankPeople(revisions, weights, now);
  const rows: PersonRow[] = [];
  for (const r of ranked) {
    if (rows.length >= limit) break;
    const st = await standingOf(c, r.who);
    if (st.optedOut) continue;
    rows.push({
      id: st.person.id,
      name: st.person.name,
      role: await roleIn(c, x.brain, r.who),
      brainId: x.brain.param,
      brainName: x.brain.label,
      contributions: r.contributions,
      pages: r.pages,
      lastAt: new Date(r.lastAt).toISOString(),
      score: r.score,
    });
  }
  return rows;
}

/** A search hit counts only when a token stands in text the caller can read (not in a dropped line). */
function readableHits(x: Seen, hits: { id: string }[], tokens: string[]): Map<string, number> {
  const byId = new Map(x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map((p) => [p.id, p]));
  const g = canGlobal(x.brain.view);
  const out = new Map<string, number>();
  for (const h of hits) {
    const p = byId.get(h.id);
    if (!p) continue;
    const hay = `${p.title}\n${filterMarkdown(p.markdown, x.ok, g).text}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) out.set(p.id, 1);
  }
  return out;
}

const visibleIds = (x: Seen): Set<string> =>
  new Set(x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map((p) => p.id));

/** The page and the pages it links to, in the brain, that the caller may read (the page counts three times). */
export function topicWeights(x: Seen, pageId: string): Map<string, number> {
  const ids = visibleIds(x);
  const w = new Map<string, number>();
  const page = x.visible.find((p) => p.id === pageId);
  if (!page || !ids.has(pageId)) return w;
  w.set(pageId, 3);
  const g = canGlobal(x.brain.view);
  const near = (md: string) => linksOf(filterMarkdown(md, x.ok, g).text);
  for (const l of near(page.markdown)) if (ids.has(l) && l !== pageId) w.set(l, 1);
  for (const p of x.visible)
    if (ids.has(p.id) && p.id !== pageId && near(p.markdown).includes(pageId)) w.set(p.id, 1);
  return w;
}

export function peopleRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // The person's own choice. Stored in their Personal Brain's object, never in a shared one.
  r.get("/me/expert-listing", async (c) => {
    const s = sess(c);
    const optedOut = await workspaceStub(
      c.env,
      s.tenantId,
      personalScope(s.principal.id),
    ).lensOptedOut();
    c.header("Cache-Control", "no-store");
    return c.json({ listed: !optedOut });
  });
  r.put("/me/expert-listing", async (c) => {
    const b = await readObject(c);
    if (typeof b.listed !== "boolean") throw bad("invalid_listed");
    if (
      !(await audit(c, {
        action: "personal.expert_listing",
        nodeId: null,
        scopeId: null,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const s = sess(c);
    await workspaceStub(c.env, s.tenantId, personalScope(s.principal.id)).lensSetOptOut(!b.listed);
    return c.json({ listed: b.listed });
  });

  // Who knows, inside one brain: for a page (and what it links to), for a collection, or for a question.
  r.get("/brains/:id/who-knows", async (c) => {
    const flag = await needFlag(c, "brains_v3");
    if (flag) return flag;
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const limit = limitOf(c);
    const [x] = await seeBrains(c, [b]);
    if (!x) return c.json({ scope: null, people: [] });
    const pageId = c.req.query("page");
    const collection = c.req.query("collection");
    const text = clean(c.req.query("q") ?? "", 120);
    let weights = new Map<string, number>();
    let scope: { kind: "page" | "collection" | "query" | "brain"; label: string };
    const schema = await b.stub.wikiSchema();
    if (pageId !== undefined) {
      if (!PAGE_ID.test(pageId)) throw bad("invalid_page");
      const page = x.visible.find((p) => p.id === pageId);
      if (!page) return c.json({ scope: null, people: [] }, 404);
      weights = topicWeights(x, pageId);
      scope = { kind: "page", label: page.title };
    } else if (collection !== undefined) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(collection)) throw bad("invalid_collection");
      for (const p of x.visible)
        if (p.type === collection && !SKIP_TYPES.has(p.type)) weights.set(p.id, 1);
      scope = { kind: "collection", label: schema.types[collection]?.label ?? collection };
    } else if (text) {
      const tokens = tokensOf(text);
      if (!tokens.length) throw bad("invalid_query");
      weights = readableHits(x, await b.stub.wikiSearch(matchOfTokens(tokens), 30), tokens);
      scope = { kind: "query", label: text };
    } else {
      for (const id of visibleIds(x)) weights.set(id, 1);
      scope = { kind: "brain", label: b.label };
    }
    c.header("Cache-Control", "no-store");
    return c.json({ scope, people: await peopleFor(c, x, weights, limit) });
  });

  // Who knows, across the brains the caller reads (My Agent and the palette). Personal Brains never.
  r.get("/who-knows", async (c) => {
    const flag = await needFlag(c, "brains_v3");
    if (flag) return flag;
    const limit = limitOf(c);
    const text = clean(c.req.query("q") ?? "", 120);
    const tokens = tokensOf(text);
    if (!tokens.length) throw bad("invalid_query");
    const refused = await rateLimit(c, "lens_whoknows", 60);
    if (refused) return refused;
    const only = (c.req.query("brain") ?? "").toLowerCase();
    const seen = (await readableBrains(c, { personal: false })).filter(
      (x) =>
        !only || x.brain.param.toLowerCase() === only || x.brain.label.toLowerCase().includes(only),
    );
    const all: PersonRow[] = [];
    for (const x of seen) {
      const weights = readableHits(
        x,
        await x.brain.stub.wikiSearch(matchOfTokens(tokens), 30),
        tokens,
      );
      all.push(...(await peopleFor(c, x, weights, limit)));
    }
    all.sort((a, z) => z.score - a.score || a.name.localeCompare(z.name));
    c.header("Cache-Control", "no-store");
    return c.json({ scope: { kind: "query", label: text }, people: all.slice(0, limit) });
  });

  return r;
}
