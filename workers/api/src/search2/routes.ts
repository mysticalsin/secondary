// Faceted search (docs/DESIGN-V8-AMAZING.md section 5): `GET /v1/search/pages` and saved searches.
// Everything is for this caller. Each brain answers for itself; a hit stands only on text the caller
// can read; the counts of a facet are counts of those hits, so a brain the caller cannot open is not
// there, not even as a zero. Operators narrow, they never widen.

import { Hono } from "hono";
import { rateLimit } from "../brains/shared.ts";
import { ageDays, clean, standingOf } from "../lens/shared.ts";
import { MAX_SAVED, type SavedSearch } from "../lens/store.ts";
import { personalScope } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, notFound, readObject, sess } from "../ux/util.ts";
import {
  admittedWikis,
  canGlobal,
  filterMarkdown,
  pageVisible,
  type Readable,
  readableMany,
} from "../wiki/routes.ts";
import {
  citationsOf,
  claimLines,
  matchOfTokens,
  sha256Hex,
  snippetOf,
  summaryOf,
  tokensOf,
} from "../wiki/text.ts";
import type { PageRow } from "../wiki/types.ts";
import {
  bucketOfAge,
  FRESH_BUCKETS,
  type FreshBucket,
  MAX_QUERY,
  parseFresh,
  parseQuery,
  ROLES,
  STATUSES,
} from "./query.ts";

const PER_BRAIN = 40;
const BROWSE_PER_BRAIN = 60;
const MAX_RESULTS = 50;
const LINES = 4;

export interface Hit {
  key: string;
  brainId: string;
  brainName: string;
  id: string;
  title: string;
  type: string;
  collection: string;
  summary: string;
  updatedAt: string;
  ageDays: number;
  fresh: FreshBucket;
  status: "verified" | "unverified";
  role: string;
  lines: { text: string; citations: { id: string; title: string }[] }[];
  restricted: number;
  rank: number;
}

const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[\p{L}\p{N}_.:<>-]{1,64}$/u.test(x))
    .slice(0, 12);

interface Filters {
  brain: string[];
  type: string[];
  status: string[];
  role: string[];
  age: FreshBucket[];
  fresh: { op: "lt" | "gt"; days: number } | null;
}

const brainOk = (h: Hit, f: Filters): boolean =>
  !f.brain.length ||
  f.brain.some(
    (v) =>
      h.brainId.toLowerCase() === v ||
      slug(h.brainName) === slug(v) ||
      (v === "personal" && h.brainId === "me"),
  );
const typeOk = (h: Hit, f: Filters): boolean =>
  !f.type.length || f.type.some((v) => h.type === v || slug(h.collection) === slug(v));
const statusOk = (h: Hit, f: Filters): boolean => !f.status.length || f.status.includes(h.status);
const roleOk = (h: Hit, f: Filters): boolean => !f.role.length || f.role.includes(h.role);
const ageOk = (h: Hit, f: Filters): boolean => {
  if (f.age.length && !f.age.includes(h.fresh)) return false;
  if (!f.fresh) return true;
  return f.fresh.op === "lt" ? h.ageDays < f.fresh.days : h.ageDays > f.fresh.days;
};

export function search2Routes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/search/pages", async (c) => {
    const raw = c.req.query("q") ?? "";
    if (raw.length > MAX_QUERY) throw bad("invalid_query");
    const parsed = parseQuery(raw);
    const tokens = tokensOf(parsed.text);
    const limit = Math.min(
      MAX_RESULTS,
      Math.max(1, Number(c.req.query("limit") ?? MAX_RESULTS) || MAX_RESULTS),
    );
    const withFacets = c.req.query("facets") !== "0";
    const age = list(c.req.query("age")).filter((x): x is FreshBucket =>
      (FRESH_BUCKETS as readonly string[]).includes(x),
    );
    const f: Filters = {
      brain: [...parsed.brain, ...list(c.req.query("brain"))],
      type: [...parsed.type, ...list(c.req.query("type"))],
      status: [
        ...parsed.status,
        ...list(c.req.query("status")).filter((x) => (STATUSES as readonly string[]).includes(x)),
      ],
      role: [
        ...parsed.role,
        ...list(c.req.query("role")).filter((x) => (ROLES as readonly string[]).includes(x)),
      ],
      age,
      fresh: parsed.fresh ?? parseFresh(c.req.query("fresh") ?? ""),
    };
    const browse = tokens.length === 0;
    // Nothing to look for: no words and no operator.
    const anyFilter =
      f.brain.length ||
      f.type.length ||
      f.status.length ||
      f.role.length ||
      f.age.length ||
      f.fresh;
    const empty = { q: raw, parsed, total: 0, results: [], facets: emptyFacets() };
    if (browse && !anyFilter) return c.json(empty);
    const refused = await rateLimit(c, "lens_search", 120);
    if (refused) return refused;

    const s = sess(c);
    const now = s.ctx.now;
    const targets = admittedWikis(c);
    const perBrain = await Promise.all(
      targets.map(async (t) => {
        const stub = workspaceStub(c.env, s.tenantId, t.scope);
        const [meta, schema] = await Promise.all([stub.wikiMeta(), stub.wikiSchema()]);
        if (!meta) return null;
        let ids: { id: string; rank: number }[];
        if (browse) {
          const index = await stub.wikiIndex();
          ids = index
            .filter((p) => p.type !== "journal")
            .sort((a, z) => z.updatedAt - a.updatedAt)
            .slice(0, BROWSE_PER_BRAIN)
            .map((p, i) => ({ id: p.id, rank: i }));
        } else ids = await stub.wikiSearch(matchOfTokens(tokens), PER_BRAIN);
        const pages = (await Promise.all(ids.map((h) => stub.wikiPage(h.id)))).flatMap((p, i) =>
          p && p.type !== "journal"
            ? [{ page: p as PageRow, rank: (ids[i] as { rank: number }).rank }]
            : [],
        );
        return { t, stub, meta, schema, pages };
      }),
    );
    const live = perBrain.filter((x): x is NonNullable<typeof x> => x !== null);
    const oks = await readableMany(
      c,
      live.map((x) => ({
        w: { view: viewFor(c), personal: x.t.param === "me", stub: x.stub },
        ids: x.pages.flatMap((p) => citationsOf(p.page.markdown)),
      })),
    );
    const g = canGlobal(viewFor(c));
    const hits: Hit[] = [];
    await Promise.all(
      live.map(async (x, i) => {
        const ok = oks[i] as Readable;
        const visible = x.pages.filter((p) => pageVisible(citationsOf(p.page.markdown), ok));
        if (!visible.length) return;
        const ids = visible.map((p) => p.page.id);
        const [last, facts] = await Promise.all([
          x.stub.lensLastChange(ids),
          x.stub.wikiFacts({ limit: 500 }),
        ]);
        const lastBy = new Map(last.map((l) => [l.pageId, l.who]));
        for (const { page, rank } of visible) {
          const fm = filterMarkdown(page.markdown, ok, g);
          const hay = `${page.title}\n${fm.text}`.toLowerCase();
          // A hit stands on text this caller can read, not on a claim that was dropped.
          if (!browse && !tokens.some((t) => hay.includes(t))) continue;
          const cites = new Set(citationsOf(page.markdown));
          const verified = facts.some(
            (fa) => fa.verifiedBy && fa.sourceIds.some((id) => cites.has(id)),
          );
          const who = lastBy.get(page.id) ?? null;
          let role = "system";
          if (who)
            role = (await x.stub.brainRoleOf((await standingOf(c, who)).humanIds)) ?? "contributor";
          const days = ageDays(now, page.updatedAt);
          const claims = claimLines(fm.text).map((l) => ({
            ...l,
            score: tokens.filter((t) => l.text.toLowerCase().includes(t)).length,
          }));
          // Lines that carry a word first; a hit on the title alone previews the page's first claims.
          const matching = claims.filter((l) => l.score > 0);
          const lines = (matching.length ? matching : claims)
            .sort((a, z) => z.score - a.score || a.line - z.line)
            .slice(0, LINES);
          hits.push({
            key: `${x.t.param}:${page.id}`,
            brainId: x.t.param,
            brainName: x.t.param === "me" ? "My Secondary" : x.t.label,
            id: page.id,
            title: page.title,
            type: page.type,
            collection: x.schema.types[page.type]?.label ?? page.type,
            summary: summaryOf(fm.text),
            updatedAt: new Date(page.updatedAt).toISOString(),
            ageDays: days,
            fresh: bucketOfAge(days),
            status: verified ? "verified" : "unverified",
            role,
            lines: lines.map((l) => ({
              text: snippetOf(l.text),
              citations: citationsOf(l.text).map((id) => ({ id, title: ok.get(id)?.title ?? id })),
            })),
            restricted: fm.dropped,
            rank,
          });
        }
      }),
    );

    // Filters narrow. A facet's counts leave its own filter out, so choosing one never hides the others.
    const passes = (h: Hit, skip?: string): boolean =>
      (skip === "brain" || brainOk(h, f)) &&
      (skip === "type" || typeOk(h, f)) &&
      (skip === "status" || statusOk(h, f)) &&
      (skip === "role" || roleOk(h, f)) &&
      (skip === "fresh" || ageOk(h, f));
    const shown = hits
      .filter((h) => passes(h))
      .sort(
        (a, z) =>
          (browse ? z.updatedAt.localeCompare(a.updatedAt) : a.rank - z.rank) ||
          a.key.localeCompare(z.key),
      );

    const facets = withFacets
      ? {
          brain: count(
            hits.filter((h) => passes(h, "brain")),
            (h) => h.brainId,
            (h) => h.brainName,
            (id) =>
              f.brain.some(
                (v) =>
                  v === id.toLowerCase() ||
                  slug(v) === slug(hits.find((h) => h.brainId === id)?.brainName ?? ""),
              ),
          ),
          type: count(
            hits.filter((h) => passes(h, "type")),
            (h) => h.type,
            (h) => h.collection,
            (id) => f.type.includes(id),
          ),
          fresh: FRESH_BUCKETS.map((b) => ({
            id: b,
            label: b,
            n: hits.filter((h) => passes(h, "fresh") && h.fresh === b).length,
            on: f.age.includes(b),
          })),
          status: STATUSES.map((st) => ({
            id: st,
            label: st,
            n: hits.filter((h) => passes(h, "status") && h.status === st).length,
            on: f.status.includes(st),
          })),
          role: ROLES.map((ro) => ({
            id: ro,
            label: ro,
            n: hits.filter((h) => passes(h, "role") && h.role === ro).length,
            on: f.role.includes(ro),
          })).filter((x) => x.n > 0 || x.on),
        }
      : emptyFacets();
    c.header("Cache-Control", "no-store");
    return c.json({
      q: raw,
      parsed: {
        text: parsed.text,
        brain: f.brain,
        type: f.type,
        status: f.status,
        role: f.role,
        fresh: f.fresh,
        ignored: parsed.ignored,
      },
      total: shown.length,
      results: shown.slice(0, limit).map(({ rank: _r, key: _k, ...x }) => ({ ...x })),
      facets,
    });
  });

  // ---- saved searches: the person's own, kept in their Personal Brain's object ----

  const mine = (c: C) => {
    const s = sess(c);
    return workspaceStub(c.env, s.tenantId, personalScope(s.principal.id));
  };

  r.get("/search/saved", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ saved: (await mine(c).lensSaved()).map(out) });
  });

  r.post("/search/saved", async (c) => {
    const b = await readObject(c);
    const q = clean(typeof b.q === "string" ? b.q : "", MAX_QUERY);
    const name = clean(typeof b.name === "string" ? b.name : "", 60);
    if (!q || !name) throw bad("invalid_saved_search");
    if (
      !(await audit(c, {
        action: "personal.saved_search",
        nodeId: null,
        scopeId: null,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const id = `s_${(await sha256Hex(q)).slice(0, 12)}`;
    const res = await mine(c).lensSavedAdd({ id, name, q, at: sess(c).ctx.now });
    if (!res.ok) throw bad(res.code, 409);
    return c.json({ saved: res.list.map(out), max: MAX_SAVED }, 201);
  });

  r.delete("/search/saved/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^s_[0-9a-f]{12}$/.test(id)) throw notFound();
    if (!(await mine(c).lensSavedRemove(id))) throw notFound();
    return c.json({ ok: true });
  });

  return r;
}

const out = (s: SavedSearch) => ({
  id: s.id,
  name: s.name,
  q: s.q,
  at: new Date(s.at).toISOString(),
});

import { viewOf } from "../auth.ts";

const viewFor = (c: C) => viewOf(sess(c));

type FacetRow = { id: string; label: string; n: number; on: boolean };
function count(
  hits: Hit[],
  id: (h: Hit) => string,
  label: (h: Hit) => string,
  on: (id: string) => boolean,
): FacetRow[] {
  const m = new Map<string, FacetRow>();
  for (const h of hits) {
    const k = id(h);
    const e = m.get(k) ?? { id: k, label: label(h), n: 0, on: on(k) };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, z) => z.n - a.n || a.label.localeCompare(z.label));
}

function emptyFacets() {
  return { brain: [], type: [], fresh: [], status: [], role: [] } as Record<string, FacetRow[]>;
}
