// GET /v1/brains/:id/insights and GET /v1/brains/overview (docs/DESIGN-V5-BRAIN-INSIGHTS.md section 3).
// Aggregated on the server from what the caller may read of each brain, one brain at a time. Nothing
// is added across brains, so a brain the caller cannot open contributes nothing, not even a count.

import { Hono } from "hono";
import { humanIdsOf } from "../human.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { bad, notFound, sess } from "../ux/util.ts";
import { readableMany } from "../wiki/routes.ts";
import { citationsOf, GENERATED, PAGE_ID } from "../wiki/text.ts";
import {
  ACTIVITY_DAYS,
  accountStatus,
  brainCoverage,
  buildActivity,
  buildConstellation,
  buildFlow,
  buildHealth,
  buildTimeline,
  DOT_CAP,
  type Insights,
  MINI_DOT_CAP,
  type Mode,
  type OverviewTile,
  type PageIn,
  pageCoverage,
  pageTimeline,
  SCORE_KINDS,
  type ScoreKind,
  WINDOWS,
  type WindowKey,
  weekly,
} from "./insights.ts";
import { DAY, TEMPLATES } from "./model.ts";
import { GOVERNANCE_BRAINS, NAV_NODE_IDS } from "./nav.ts";
import { admittedBrainParams, type Brain, brainOf, needBrain, needFlag } from "./open.ts";
import { type Seen, SKIP_TYPES, seeBrains } from "./shared.ts";

const MAX_Q = 120;

const pageIn = (p: Seen["visible"][number]): PageIn => ({
  id: p.id,
  type: p.type,
  title: p.title,
  summary: p.summary,
  markdown: p.markdown,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/** Pages that count as edits in the activity views: everything readable but the generated ones. */
const isEdit = (type: string): boolean => type !== "journal" && !(type in GENERATED);

export function insightsRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use("/brains/overview", async (c, next) => (await needFlag(c, "brains_v3")) ?? next());
  r.use("/brains/:id/insights", async (c, next) => (await needFlag(c, "brains_v3")) ?? next());

  r.get("/brains/overview", async (c) => {
    const s = sess(c);
    const humanIds = await humanIdsOf(c.env, s);
    const params = admittedBrainParams(c).filter(
      (p) =>
        p.param === "me" ||
        p.param === "core" ||
        p.vn?.kind === "account" ||
        NAV_NODE_IDS.has(p.param),
    );
    const opened = (await Promise.all(params.map((p) => brainOf(c, p.param, humanIds)))).filter(
      (b): b is Brain => b !== null,
    );
    const seen = await seeBrains(c, opened);
    const tiles = await Promise.all(
      seen.map(async (x): Promise<OverviewTile> => {
        const raw = await x.brain.stub.brainInsightRaw(
          s.ctx.now,
          s.ctx.now - 12 * 7 * DAY,
          [],
          true,
        );
        const schema = await x.brain.stub.wikiSchema();
        const pages = x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map(pageIn);
        const con = buildConstellation({
          brainId: x.brain.param,
          pages,
          labelOf: (t) => schema.types[t]?.label ?? t,
          mode: "freshness",
          q: "",
          now: s.ctx.now,
          freshnessDays: x.freshnessDays,
          cap: MINI_DOT_CAP,
        });
        const index = new Map(con.sectors.map((sec, n) => [sec.id, n]));
        const edits = new Set(x.visible.filter((p) => isEdit(p.type)).map((p) => p.id));
        return {
          id: x.brain.param,
          type: x.brain.facts.type,
          name: x.brain.label,
          template: x.template,
          pages: x.visible.length,
          health: { score: x.health.score },
          zone: { inZone: con.legend.inZone, total: con.legend.total },
          seed: con.seed,
          dots: con.dots.map((d) => ({
            s: index.get(d.sector) ?? 0,
            r: d.r,
            z: d.inZone,
            k: d.k,
          })),
          sectors: con.sectors.length,
          sparkline: weekly(raw.revisions, edits, s.ctx.now),
          lastActivityAt: x.visible.length
            ? new Date(Math.max(...x.visible.map((p) => p.updatedAt))).toISOString()
            : null,
        };
      }),
    );
    // The sidebar's order: Personal, the governance brains, account brains by name, Company Global.
    const rank = (t: OverviewTile): number =>
      t.id === "me"
        ? 0
        : t.id === "core"
          ? 99
          : Math.max(1, GOVERNANCE_BRAINS.findIndex(([, , node]) => node === t.id) + 1 || 50);
    tiles.sort((a, z) => rank(a) - rank(z) || a.name.localeCompare(z.name));
    c.header("Cache-Control", "no-store");
    return c.json({ generatedAt: new Date(s.ctx.now).toISOString(), brains: tiles });
  });

  r.get("/brains/:id/insights", async (c) => {
    const mode = (c.req.query("mode") ?? "relevance") as Mode;
    if (mode !== "relevance" && mode !== "freshness") throw bad("invalid_mode");
    const scoreKind = (c.req.query("scoreKind") ?? "freshness") as ScoreKind;
    if (!SCORE_KINDS.includes(scoreKind)) throw bad("invalid_score_kind");
    const window = (c.req.query("window") ?? "30d") as WindowKey;
    if (!Object.hasOwn(WINDOWS, window)) throw bad("invalid_window");
    const q = (c.req.query("q") ?? "").trim().slice(0, MAX_Q);
    const focusId = c.req.query("focus");
    if (focusId !== undefined && !PAGE_ID.test(focusId)) throw bad("invalid_focus");

    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const [x] = await seeBrains(c, [b]);
    if (!x) throw notFound();
    const s = sess(c);
    const now = s.ctx.now;
    const schema = await b.stub.wikiSchema();
    const labelOf = (t: string) => schema.types[t]?.label ?? t;
    const pages = x.visible.filter((p) => !SKIP_TYPES.has(p.type)).map(pageIn);
    // A page the caller may not read is not a focus: absence and denial look the same.
    const focusPage = focusId ? pages.find((p) => p.id === focusId) : undefined;
    if (focusId && !focusPage) throw notFound();

    const cited = x.visible.flatMap((p) => citationsOf(p.markdown));
    const raw = await b.stub.brainInsightRaw(
      now - WINDOWS[window] * DAY,
      now - (ACTIVITY_DAYS + 1) * DAY,
      cited,
    );
    // What counts is what this caller may read: cited sources, proposal sources, ingested sources.
    const ids = [
      ...cited,
      ...raw.proposals.flatMap((p) => p.titleSources),
      ...raw.ingested.map((i) => i.sourceId),
    ];
    const ok = (
      await readableMany(c, [{ w: { view: b.view, personal: b.personal, stub: b.stub }, ids }])
    )[0];
    const readable = new Set(ok?.keys() ?? []);

    const editIds = new Set(x.visible.filter((p) => isEdit(p.type)).map((p) => p.id));
    const activity = buildActivity(raw.revisions, editIds, now);
    const timeline = buildTimeline(pages, now);
    const counts = new Map<string, number>();
    for (const p of pages) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    const expected = TEMPLATES[x.template].collections
      .filter((t) => !SKIP_TYPES.has(t.type))
      .map((t) => ({ type: t.type, label: schema.types[t.type]?.label ?? t.label }));

    const focus: Insights["focus"] = focusPage
      ? {
          kind: "page",
          pageId: focusPage.id,
          title: focusPage.title,
          type: focusPage.type,
          coverage: pageCoverage(focusPage.markdown, schema.types[focusPage.type]?.required ?? []),
          timeline: pageTimeline(raw.revisions, focusPage.id, now),
          activity: buildActivity(raw.revisions, new Set([focusPage.id]), now),
          status: null,
        }
      : {
          kind: "brain",
          pageId: null,
          title: b.label,
          type: b.facts.type,
          coverage: brainCoverage(counts, expected),
          timeline,
          activity,
          status: b.facts.type === "account" ? accountStatus(pages, now) : null,
        };

    const body: Insights = {
      brainId: b.param,
      name: b.label,
      generatedAt: new Date(now).toISOString(),
      window,
      constellation: buildConstellation({
        brainId: b.param,
        pages,
        labelOf,
        mode,
        q,
        now,
        freshnessDays: x.freshnessDays,
        cap: DOT_CAP,
      }),
      focus,
      health: buildHealth({
        pages,
        raw,
        readable,
        now,
        freshnessDays: x.freshnessDays,
        scoreKind,
      }),
      flow: buildFlow({
        raw,
        readable,
        window,
        promotes: b.facts.type === "team" || b.facts.type === "account",
        now,
      }),
      activity,
      timeline,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });
  return r;
}
