// Page lens (docs/DESIGN-V8-AMAZING.md section 3): what the right rail and the sticky header of a
// page show. Everything is for this caller: the page must be one they may read (else 404, like
// everywhere), a line counts only when every source it cites is readable, the graph reaches only
// brains they read (a page they cannot read is left out, never drawn as locked), and a person who
// opted out of expert listing is never named.

import { Hono } from "hono";
import { freshnessScore } from "../brains/insights.ts";
import { needBrain, needFlag } from "../brains/open.ts";
import { type Seen, seeBrains } from "../brains/shared.ts";
import { peopleFor, topicWeights } from "../people/routes.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { notFound, sess } from "../ux/util.ts";
import { canGlobal, filterMarkdown, readableMany, sourcesReadable } from "../wiki/routes.ts";
import { citationsOf, GENERATED, linksOf, PAGE_ID } from "../wiki/text.ts";
import type { Fact } from "../wiki/types.ts";
import { ageDays, readableBrains, roleIn, standingOf } from "./shared.ts";

const MAX_NODES = 24;
const MAX_HOP1 = 12;
const MAX_FACTS = 24;
const MAX_BACKLINKS = 30;

export interface GraphNode {
  key: string;
  brainId: string;
  brainName: string;
  id: string;
  title: string;
  type: string;
  hop: 0 | 1 | 2;
}

const keyOf = (brainId: string, id: string): string => `${brainId}:${id}`;

interface Reach {
  x: Seen;
  g: boolean;
  /** Visible, hand-written pages by id: what a neighbour can be. */
  pages: Map<string, Seen["visible"][number]>;
  /** Every visible page but journals: what a lens can be opened on (an overview has one too). */
  all: Map<string, Seen["visible"][number]>;
}

const reachOf = (x: Seen): Reach => ({
  x,
  g: canGlobal(x.brain.view),
  // Generated hubs (overview, logs) link every page; as neighbours they would only add noise.
  pages: new Map(
    x.visible.filter((p) => p.type !== "journal" && !(p.type in GENERATED)).map((p) => [p.id, p]),
  ),
  all: new Map(x.visible.filter((p) => p.type !== "journal").map((p) => [p.id, p])),
});

/** Links out of a page, on lines this caller may read. `global:` links keep their prefix. */
const outLinks = (r: Reach, md: string): string[] => linksOf(filterMarkdown(md, r.x.ok, r.g).text);

export interface FactBar {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validAt: string;
  invalidAt: string | null;
  unverified: boolean;
  /** Another fact for the same subject and predicate says something else for the same time. */
  contradiction: boolean;
  /** The fact that replaced this one (it ended when the other began). */
  replacedBy: number | null;
}

const T = (s: string | null): number => (s ? Date.parse(s) : Number.POSITIVE_INFINITY);

export function factBars(facts: Fact[]): FactBar[] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    const k = `${f.subject}\u0000${f.predicate}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const out: FactBar[] = [];
  for (const g of groups.values()) {
    g.sort((a, z) => T(a.validAt) - T(z.validAt) || a.id - z.id);
    for (const f of g) {
      const clash = g.some(
        (o) =>
          o.id !== f.id &&
          o.object !== f.object &&
          T(o.validAt) < T(f.invalidAt) &&
          T(f.validAt) < T(o.invalidAt),
      );
      const next = f.invalidAt
        ? g.find(
            (o) =>
              o.id !== f.id &&
              o.object !== f.object &&
              T(o.validAt) >= T(f.validAt) &&
              T(o.validAt) <= T(f.invalidAt) + 86_400_000,
          )
        : undefined;
      out.push({
        id: f.id,
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        validAt: f.validAt,
        invalidAt: f.invalidAt,
        unverified: f.verifiedBy === null,
        contradiction: clash,
        replacedBy: next ? next.id : null,
      });
    }
  }
  return out.sort((a, z) => T(z.validAt) - T(a.validAt) || z.id - a.id);
}

export function lensRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use(
    "/brains/:id/pages/:pid/lens",
    async (c, next) => (await needFlag(c, "brains_v3")) ?? next(),
  );

  r.get("/brains/:id/pages/:pid/lens", async (c) => {
    const pid = c.req.param("pid");
    if (!PAGE_ID.test(pid)) throw notFound();
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const [x] = await seeBrains(c, [b]);
    if (!x) throw notFound();
    const s = sess(c);
    const now = s.ctx.now;
    const here = reachOf(x);
    const page = here.all.get(pid);
    // A page with no readable source is not here for this caller.
    if (!page) throw notFound();
    const schema = await b.stub.wikiSchema();
    const labelOf = (t: string) => schema.types[t]?.label ?? t;

    // ---- the neighbourhood: this brain, and Company Global where the caller reads it ----
    const brainName = b.label;
    const node = (rc: Reach, id: string, hop: 0 | 1 | 2): GraphNode | null => {
      const p = hop === 0 ? rc.all.get(id) : rc.pages.get(id);
      if (!p) return null;
      return {
        key: keyOf(rc.x.brain.param, id),
        brainId: rc.x.brain.param,
        brainName: rc.x.brain.label,
        id,
        title: p.title,
        type: p.type,
        hop,
      };
    };
    const others = (await readableBrains(c, { personal: false })).filter(
      (o) => o.brain.param !== b.param,
    );
    // Every brain the graph may touch, by id: this one, and the others the caller reads. Company
    // Global is a destination only where the caller reads it (a link toward it is dropped otherwise).
    const reaches = new Map<string, Reach>([[b.param, here]]);
    for (const o of others) reaches.set(o.brain.param, reachOf(o));
    const coreReach = here.g ? (reaches.get("core") ?? null) : null;

    const nodes = new Map<string, GraphNode>();
    const edges = new Set<string>();
    const add = (n: GraphNode): void => {
      if (!nodes.has(n.key) && nodes.size < MAX_NODES) nodes.set(n.key, n);
    };
    const edge = (from: string, to: string) => {
      if (nodes.has(from) && nodes.has(to) && from !== to) edges.add(`${from}\u0000${to}`);
    };
    /** Pages this page links to (its own brain, or Company Global through `global:`). */
    const outOf = (rc: Reach, id: string): GraphNode[] => {
      const p = rc.pages.get(id);
      if (!p) return [];
      const out: GraphNode[] = [];
      for (const l of outLinks(rc, p.markdown)) {
        const n = l.startsWith("global:")
          ? rc.g && coreReach && rc.x.brain.param !== "core"
            ? node(coreReach, l.slice(7), 1)
            : null
          : node(rc, l, 1);
        if (n) out.push(n);
      }
      return out;
    };
    /** Pages that link to this one. Toward a Global page, pages of other readable brains too. */
    const into = (rc: Reach, id: string): GraphNode[] => {
      const out: GraphNode[] = [];
      for (const p of rc.pages.values())
        if (p.id !== id && outLinks(rc, p.markdown).includes(id)) {
          const n = node(rc, p.id, 1);
          if (n) out.push(n);
        }
      if (rc.x.brain.param === "core")
        for (const o of others) {
          const orc = reaches.get(o.brain.param) as Reach;
          for (const p of orc.pages.values())
            if (outLinks(orc, p.markdown).includes(`global:${id}`)) {
              const n = node(orc, p.id, 1);
              if (n) out.push(n);
            }
        }
      return out;
    };

    const center = node(here, pid, 0) as GraphNode;
    add(center);
    const ring: { n: GraphNode; dir: "out" | "in" }[] = [
      ...outOf(here, pid).map((n) => ({ n, dir: "out" as const })),
      ...into(here, pid).map((n) => ({ n, dir: "in" as const })),
    ];
    const first = new Set<string>();
    for (const h of ring) {
      if (first.size >= MAX_HOP1 && !first.has(h.n.key)) continue;
      first.add(h.n.key);
      add(h.n);
      if (h.dir === "out") edge(center.key, h.n.key);
      else edge(h.n.key, center.key);
    }
    // Second hop: what the first ring links to and what links to it.
    for (const key of first) {
      const n1 = nodes.get(key);
      const rc = n1 ? reaches.get(n1.brainId) : undefined;
      if (!n1 || !rc) continue;
      const next = [
        ...outOf(rc, n1.id).map((n) => ({ n, dir: "out" as const })),
        ...into(rc, n1.id).map((n) => ({ n, dir: "in" as const })),
      ];
      for (const o of next) {
        if (o.n.key === center.key) continue;
        add({ ...o.n, hop: 2 });
        if (o.dir === "out") edge(n1.key, o.n.key);
        else edge(o.n.key, n1.key);
      }
    }

    // ---- backlinks: pages that link here, this brain first, readable brains only ----
    const backlinks = into(here, pid)
      .slice(0, MAX_BACKLINKS)
      .map((n) => ({
        brainId: n.brainId,
        brainName: n.brainName,
        id: n.id,
        title: n.title,
        type: n.type,
        collection: n.type,
      }));

    // ---- facts the page stands on, for this caller ----
    const cited = new Set(citationsOf(page.markdown));
    const rawFacts = await b.stub.wikiFacts({ limit: 500 });
    const mine = rawFacts.filter((f) => f.sourceIds.some((i) => cited.has(i)));
    const okFacts = (
      await readableMany(c, [
        {
          w: { view: b.view, personal: b.personal, stub: b.stub },
          ids: mine.flatMap((f) => f.sourceIds),
        },
      ])
    )[0] as Awaited<ReturnType<typeof readableMany>>[number];
    const facts = factBars(mine.filter((f) => sourcesReadable(f.sourceIds, okFacts))).slice(
      0,
      MAX_FACTS,
    );

    // ---- who stands behind the page ----
    const revs = (await b.stub.lensRevisions()).filter((r) => r.pageId === pid);
    const contribs = new Map<string, { n: number; last: number }>();
    for (const rv of revs) {
      const e = contribs.get(rv.who) ?? { n: 0, last: 0 };
      e.n++;
      e.last = Math.max(e.last, rv.at);
      contribs.set(rv.who, e);
    }
    const contributors: {
      id: string;
      name: string;
      role: string;
      changes: number;
      lastAt: string;
    }[] = [];
    let unnamed = 0;
    for (const [who, e] of [...contribs].sort((a, z) => z[1].last - a[1].last)) {
      const st = await standingOf(c, who);
      if (st.optedOut) {
        unnamed++;
        continue;
      }
      contributors.push({
        id: st.person.id,
        name: st.person.name,
        role: await roleIn(c, b, who),
        changes: e.n,
        lastAt: new Date(e.last).toISOString(),
      });
    }
    const last = (await b.stub.lensLastChange([pid]))[0];
    let lastBy: { id: string; name: string } | null = null;
    if (last?.who) {
      const st = await standingOf(c, last.who);
      if (!st.optedOut) lastBy = st.person;
    }
    // The stamp: the latest confirmation of a fact the page stands on.
    const stamped = facts.length
      ? mine
          .filter(
            (f) =>
              f.verifiedBy &&
              !/^(svc|system):/.test(f.verifiedBy) &&
              facts.some((x) => x.id === f.id),
          )
          .sort((a, z) => z.checkedAt.localeCompare(a.checkedAt))[0]
      : undefined;
    let verified: { by: { id: string; name: string } | null; at: string } | null = null;
    if (stamped?.verifiedBy) {
      const st = await standingOf(c, stamped.verifiedBy);
      verified = { by: st.optedOut ? null : st.person, at: stamped.checkedAt };
    }

    const days = ageDays(now, page.updatedAt);
    const score = freshnessScore(
      {
        id: page.id,
        type: page.type,
        title: page.title,
        summary: page.summary,
        markdown: page.markdown,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      },
      now,
      x.freshnessDays,
    );
    const state =
      days <= x.freshnessDays / 2 ? "fresh" : days <= x.freshnessDays ? "aging" : "stale";

    const who = await peopleFor(c, x, topicWeights(x, pid), 5);
    c.header("Cache-Control", "no-store");
    return c.json({
      page: {
        id: page.id,
        title: page.title,
        type: page.type,
        collection: labelOf(page.type),
        brainId: b.param,
        brainName,
        status: "published",
        revision: page.revision,
        updatedAt: new Date(page.updatedAt).toISOString(),
        lastChange: {
          at: new Date(last?.at ?? page.updatedAt).toISOString(),
          revision: last?.revision ?? page.revision,
          by: lastBy,
        },
      },
      freshness: { state, days, score, freshnessDays: x.freshnessDays },
      verified,
      graph: {
        nodes: [...nodes.values()].map((n) => ({ ...n, collection: labelOf(n.type) })),
        edges: [...edges].map((e) => {
          const [from, to] = e.split("\u0000");
          return { from, to };
        }),
      },
      facts,
      contributors,
      unnamed,
      backlinks,
      who,
    });
  });

  return r;
}
