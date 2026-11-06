// AgentNode tree -> React, over the existing insight components. Only registered node types are
// drawn (the contract and tree.ts drop everything else before it gets here); a `Locked` node draws a
// generic placeholder. Every data-bearing node resolves its numbers for the current viewer through
// the existing endpoints and the cache in resolve.ts.
import type { ActionEventValue, AgentNode } from "@secondary/contracts/agent-ui";
import {
  Activity,
  ChartNoAxesColumn,
  CircleCheck,
  Filter,
  Info,
  Lock,
  Radar,
  Rows3,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type Key, useI18n } from "../i18n";
import { ActivityGrid } from "../insights/ActivityGrid";
import { Beeswarm } from "../insights/Beeswarm";
import { DotConstellation } from "../insights/DotConstellation";
import { FitBars } from "../insights/FitBars";
import { Funnel } from "../insights/Funnel";
import { useDate, useNumber } from "../insights/hooks";
import { InsightCard, TwinTable } from "../insights/InsightCard";
import { KpiTile } from "../insights/KpiTile";
import { TimelineBars } from "../insights/TimelineBars";
import type { Insights, ScoreKind } from "../insights/types";
import { brainLink, pageLink } from "../lib/links";
import { v3 } from "../views/brains/api";
import type { NavBrain } from "../views/brains/types";
import { wikiApi } from "../views/wiki/api";
import { cached, insightsOf, type Resolved, useResolved } from "./resolve";
import type { CardTheme, Density } from "./settings";

// ---------- context ----------

interface Ctx {
  /** Inside an agent card: leaves draw bare and follow the card's chart or table mode. */
  inCard: boolean;
  table: boolean;
  /** The card holds one chart: its title already says what it is. */
  single: boolean;
  /** The whole answer is shown as tables. */
  forceTable: boolean;
  onTurn: (e: ActionEventValue, label: string) => void;
  onNavigate: () => void;
}
const C = createContext<Ctx>({
  inCard: false,
  table: false,
  single: false,
  forceTable: false,
  onTurn: () => {},
  onNavigate: () => {},
});
const useC = () => useContext(C);

// ---------- shared pieces ----------

export function LockedCard() {
  const { t } = useI18n();
  return (
    <div
      className="ag-locked"
      role="group"
      aria-label={t("v6.locked.title")}
      data-testid="agent-locked"
    >
      <Lock size={18} aria-hidden />
      <div>
        <b>{t("v6.locked.title")}</b>
        <p>{t("v6.locked.lead")}</p>
      </div>
    </div>
  );
}

function Skel({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="ag-skel" role="status" aria-busy="true">
      <span className="sr-only">{label ?? t("v6.card.loading")}</span>
    </div>
  );
}

/** Loading, locked (403 or 404), retryable error, or the data. */
function Leaf<T>({ res, children }: { res: Resolved<T>; children: (d: T) => ReactNode }) {
  const { t } = useI18n();
  if (res.loading && !res.data) return <Skel />;
  if (res.status === 403 || res.status === 404) return <LockedCard />;
  if (res.error)
    return (
      <div className="ag-err" role="alert">
        <span>{t("v6.card.error")}</span>
        <button type="button" className="icard-btn" onClick={res.retry}>
          {t("common.retry")}
        </button>
      </div>
    );
  if (!res.data) return null;
  return <>{children(res.data)}</>;
}

/** One chart with its table twin. Inside a card it is bare; on its own it gets the card chrome. */
function Frame({
  icon,
  title,
  summary,
  chart,
  table,
  testId,
  heading = true,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  chart: ReactNode;
  table: ReactNode;
  testId: string;
  heading?: boolean;
}) {
  const c = useC();
  if (c.inCard)
    return (
      <div className="ag-leaf" data-testid={testId}>
        {heading && !c.single ? <h4 className="ag-leaf-t">{title}</h4> : null}
        {c.table ? table : chart}
      </div>
    );
  return (
    <InsightCard
      className="ag-loose"
      testId={testId}
      icon={icon}
      title={title}
      summary={summary}
      {...(c.forceTable ? {} : { table })}
    >
      {c.forceTable ? table : chart}
    </InsightCard>
  );
}

const CARD_ICON: Record<string, ReactNode> = {
  Funnel: <Filter size={20} />,
  Beeswarm: <ChartNoAxesColumn size={20} />,
  DotConstellation: <Radar size={20} />,
  ActivityGrid: <Activity size={20} />,
  PageList: <Rows3 size={20} />,
};

// ---------- data-bearing leaves ----------

function useInsights(brain: string, o: Parameters<typeof insightsOf>[1] = {}): Resolved<Insights> {
  const key = `${brain}|${o.q ?? ""}|${o.mode ?? ""}|${o.window ?? ""}|${o.focus ?? ""}`;
  return useResolved(`ins|${key}`, () => insightsOf(brain, o));
}

function ConstellationLeaf({
  p,
}: {
  p: { brain: string; q?: string; mode?: "relevance" | "freshness" };
}) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { onNavigate } = useC();
  const res = useInsights(p.brain, {
    ...(p.q ? { q: p.q } : {}),
    ...(p.mode ? { mode: p.mode } : {}),
  });
  return (
    <Leaf res={res}>
      {(d) => {
        const c = d.constellation;
        const named = c.dots
          .filter((x) => x.highlight)
          .sort((a, z) => z.score - a.score)
          .map((x) => x.label)
          .join(", ");
        const summary = t("v5.con.summary", {
          zone: c.legend.inZone,
          total: c.legend.total,
          th: c.legend.threshold,
          sectors: c.sectors.map((s) => `${s.label} ${s.count}`).join(", "),
          named: named ? t("v5.con.summary.named", { names: named }) : "",
        });
        const label = new Map(c.sectors.map((s) => [s.id, s.label]));
        const rows = [...c.dots]
          .sort((a, z) => z.score - a.score)
          .slice(0, 40)
          .map((x) => [
            x.title ?? t("v5.n.pages.other", { n: x.k }),
            label.get(x.sector) ?? x.sector,
            x.score,
            x.inZone ? t("v5.yes") : t("v5.no"),
          ]);
        return (
          <Frame
            testId="agent-constellation"
            icon={<Radar size={20} />}
            title={`${d.name}: ${t("v6.t.constellation")}`}
            summary={summary}
            chart={
              c.dots.length ? (
                <DotConstellation
                  data={c}
                  name={d.name}
                  selected={null}
                  onSelect={(id) => {
                    onNavigate();
                    nav(pageLink(p.brain, id));
                  }}
                  summary={summary}
                />
              ) : (
                <p className="icard-empty">{t("v6.card.empty")}</p>
              )
            }
            table={
              <TwinTable
                caption={t("v5.con.title")}
                head={[
                  t("v5.table.page"),
                  t("v5.table.collection"),
                  t("v5.table.score"),
                  t("v5.table.zone"),
                ]}
                rows={rows}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function BeeswarmLeaf({ p }: { p: { brain: string; scoreKind?: ScoreKind } }) {
  const { t } = useI18n();
  const num = useNumber();
  const kind = p.scoreKind ?? "freshness";
  const res = useInsights(p.brain);
  return (
    <Leaf res={res}>
      {(d) => {
        const h = d.health;
        const above = h.above[kind];
        const kindName = t(`v5.health.kind.${kind}` as "v5.health.kind.freshness");
        const summary = t("v5.health.summary", {
          above,
          total: h.total,
          t: h.threshold,
          kind: kindName,
          below: h.total - above,
          week: h.weekDelta[kind],
        });
        const points = h.points.map((x) => ({ ...x, score: x.scores?.[kind] ?? x.score }));
        const bins = new Array<number>(10).fill(0);
        for (const x of points) {
          const i = Math.min(9, Math.floor(x.score / 10));
          bins[i] = (bins[i] ?? 0) + x.k;
        }
        return (
          <Frame
            testId="agent-beeswarm"
            icon={<ChartNoAxesColumn size={20} />}
            title={`${d.name}: ${t("v6.t.health")}`}
            summary={summary}
            chart={
              <>
                <div className="big">
                  <b className="big-n">{num(above)}</b>
                  <span className="big-l">
                    {t("v5.health.above", { t: h.threshold })}
                    <br />
                    <span className="mono-soft">{t("v5.health.of", { total: num(h.total) })}</span>
                  </span>
                </div>
                {points.length ? (
                  <Beeswarm
                    points={points}
                    scoreKind={kind}
                    threshold={h.threshold}
                    label={t("v5.health.axis", { kind: kindName, lo: 0 })}
                  />
                ) : (
                  <p className="icard-empty">{t("v6.card.empty")}</p>
                )}
              </>
            }
            table={
              <TwinTable
                caption={`${t("v5.health.title")}: ${kindName}`}
                head={[t("v5.table.score"), t("v5.table.pages")]}
                rows={bins.map((n, i) => [
                  `${i * 10}${i === 9 ? " to 100" : ` to ${i * 10 + 9}`}%`,
                  n,
                ])}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function FunnelLeaf({ p }: { p: { brain: string; window?: "7d" | "30d" | "90d" } }) {
  const { t } = useI18n();
  const num = useNumber();
  const res = useInsights(p.brain, p.window ? { window: p.window } : {});
  return (
    <Leaf res={res}>
      {(d) => {
        const f = d.flow;
        const count = (k: string) => f.stages.find((s) => s.key === k)?.count ?? 0;
        const promoted = f.stages.find((s) => s.key === "promoted");
        const empty = f.stages.every((s) => s.count === 0);
        const summary = t("v5.flow.summary", {
          ingested: count("ingested"),
          proposed: count("proposed"),
          reviewed: count("reviewed"),
          published: count("published"),
          promoted: promoted ? t("v5.flow.summary.promoted", { n: promoted.count }) : "",
        });
        return (
          <Frame
            testId="agent-funnel"
            icon={<Filter size={20} />}
            title={`${d.name}: ${t("v6.t.flow")}`}
            summary={summary}
            chart={
              empty ? (
                <p className="icard-empty">{t("v5.flow.none")}</p>
              ) : (
                <>
                  <div className="big">
                    <b className="big-n">{f.publishRate === null ? "-" : `${f.publishRate}%`}</b>
                    <span className="big-l">{t("v5.flow.rate")}</span>
                  </div>
                  <Funnel stages={f.stages} label={t("v5.flow.title")} />
                  <div className="kpis">
                    <KpiTile
                      value={
                        f.medianDaysToReview === null
                          ? t("v5.kpi.na")
                          : t("v5.kpi.review.value", { n: num(f.medianDaysToReview) })
                      }
                      label={t("v5.kpi.review")}
                    />
                    <KpiTile
                      value={
                        f.seenAllRate === null
                          ? t("v5.kpi.na")
                          : t("v5.kpi.seen.value", { n: f.seenAllRate })
                      }
                      label={t("v5.kpi.seen")}
                    />
                  </div>
                </>
              )
            }
            table={
              <TwinTable
                caption={t("v5.flow.title")}
                head={[t("v5.table.stage"), t("v5.table.count")]}
                rows={f.stages.map((s) => [t(`v5.stage.${s.key}` as "v5.stage.ingested"), s.count])}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function FitLeaf({ p }: { p: { brain: string; page?: string } }) {
  const { t } = useI18n();
  const res = useInsights(p.brain, p.page ? { focus: p.page } : {});
  return (
    <Leaf res={res}>
      {(d) => {
        const f = d.focus;
        const ok = f.coverage.filter((r) => r.state === "ok").length;
        const title = `${f.title}: ${t("v6.t.fit")}`;
        return (
          <Frame
            testId="agent-fit"
            heading={false}
            icon={<ChartNoAxesColumn size={20} />}
            title={title}
            summary={`${t("v5.focus.coverage")}: ${ok}/${f.coverage.length}.`}
            chart={
              f.coverage.length ? (
                <FitBars
                  rows={f.coverage}
                  title={p.page ? t("v5.focus.coverage.page") : t("v5.focus.coverage")}
                  headline={`${ok}/${f.coverage.length}`}
                />
              ) : (
                <p className="icard-empty">{t("v6.card.empty")}</p>
              )
            }
            table={
              <TwinTable
                caption={t("v5.focus.coverage")}
                head={[t("v5.table.section"), t("v5.table.value"), t("v5.table.target")]}
                rows={f.coverage.map((r) => [r.label, r.value, r.target])}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function TimelineLeaf({ p }: { p: { brain: string; page?: string } }) {
  const { t } = useI18n();
  const fmt = useDate();
  const res = useInsights(p.brain, p.page ? { focus: p.page } : {});
  return (
    <Leaf res={res}>
      {(d) => {
        const bars = d.focus.timeline;
        return (
          <Frame
            testId="agent-timeline"
            heading={false}
            icon={<Rows3 size={20} />}
            title={`${d.focus.title}: ${t("v6.t.timeline")}`}
            summary={`${t("v5.focus.timeline")}: ${bars.length}.`}
            chart={
              bars.length ? (
                <TimelineBars
                  bars={bars}
                  now={d.generatedAt.slice(0, 10)}
                  title={t("v5.focus.timeline")}
                  label={t("v5.focus.timeline")}
                />
              ) : (
                <p className="icard-empty">{t("v6.card.empty")}</p>
              )
            }
            table={
              <TwinTable
                caption={t("v5.focus.timeline")}
                head={[t("v5.table.bar"), t("v5.table.start"), t("v5.table.end")]}
                rows={bars.map((b) => [b.label, fmt(b.start), fmt(b.end)])}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function ActivityLeaf({ p }: { p: { brain: string; page?: string } }) {
  const { t } = useI18n();
  const fmt = useDate();
  const res = useInsights(p.brain, p.page ? { focus: p.page } : {});
  return (
    <Leaf res={res}>
      {(d) => {
        const a = d.focus.activity;
        const total = a.days.reduce((n, x) => n + x.count, 0);
        const summary = t("v5.act.summary", {
          n: total,
          d: a.days.length,
          from: fmt(a.from),
          to: fmt(a.to),
        });
        const months = new Map<string, number>();
        for (const x of a.days)
          months.set(x.date.slice(0, 7), (months.get(x.date.slice(0, 7)) ?? 0) + x.count);
        return (
          <Frame
            testId="agent-activity"
            heading={false}
            icon={<Activity size={20} />}
            title={`${d.focus.title}: ${t("v6.t.activity")}`}
            summary={summary}
            chart={
              <ActivityGrid
                data={a}
                title={t("v5.focus.activity")}
                sub={t("v5.focus.activity.sub")}
                label={t("v5.focus.activity")}
              />
            }
            table={
              <TwinTable
                caption={t("v5.focus.activity")}
                head={[t("v5.table.day"), t("v5.table.edits")]}
                rows={[...months].map(([m, n]) => [m, n])}
              />
            }
          />
        );
      }}
    </Leaf>
  );
}

function KpiLeaf({
  p,
}: {
  p: { label: string; brain: string; metric: string; window?: "7d" | "30d" | "90d" };
}) {
  const { t } = useI18n();
  const num = useNumber();
  const c = useC();
  const home = p.metric === "pages" || p.metric === "health";
  const res = useResolved(`kpi|${p.brain}|${p.metric}|${p.window ?? ""}`, async () => {
    if (home) return { home: await cached(`home|${p.brain}`, () => v3.brain(p.brain)), ins: null };
    return { home: null, ins: await insightsOf(p.brain, p.window ? { window: p.window } : {}) };
  });
  return (
    <Leaf res={res}>
      {(r) => {
        const f = r.ins?.flow;
        const na = t("v5.kpi.na");
        const value =
          p.metric === "pages"
            ? num(r.home?.pages ?? 0)
            : p.metric === "health"
              ? `${r.home?.health.score ?? 0}%`
              : p.metric === "inZone"
                ? `${r.ins?.constellation.legend.inZone ?? 0}/${r.ins?.constellation.legend.total ?? 0}`
                : p.metric === "publishRate"
                  ? f?.publishRate == null
                    ? na
                    : `${f.publishRate}%`
                  : p.metric === "reviewDays"
                    ? f?.medianDaysToReview == null
                      ? na
                      : t("v5.kpi.review.value", { n: num(f.medianDaysToReview) })
                    : f?.seenAllRate == null
                      ? na
                      : t("v5.kpi.seen.value", { n: f.seenAllRate });
        return c.inCard ? (
          <KpiTile value={value} label={p.label} />
        ) : (
          <div className="icard ag-kpi-card" data-testid="agent-kpi">
            <KpiTile value={value} label={p.label} />
          </div>
        );
      }}
    </Leaf>
  );
}

// ---------- pages ----------

interface PageHit {
  ws: string;
  pageId: string;
  title: string;
  summary: string;
  brainName: string;
  fallback?: boolean;
}

const navNames = (): Promise<Map<string, string>> =>
  cached("nav", async () => {
    const n = await v3.nav();
    const all = n.items.flatMap((i): NavBrain[] => (i.children?.length ? i.children : [i]));
    return new Map(all.map((b) => [b.id, b.name]));
  });

async function findPages(
  q: string,
  brain: string | undefined,
  limit: number,
  mine: string,
): Promise<PageHit[]> {
  const names = await navNames();
  const nameOf = (id: string) => (id === "me" ? mine : (names.get(id) ?? id));
  const one = async (ws: string): Promise<PageHit[]> => {
    if (!q.trim()) {
      const idx = await cached(`index|${ws}`, () => wikiApi.index(ws));
      return idx.pages.map((x) => ({
        ws,
        pageId: x.id,
        title: x.title,
        summary: x.summary,
        brainName: nameOf(ws),
      }));
    }
    const r = await cached(`search|${ws}|${q}`, () => wikiApi.search(ws, q));
    return r.results.map((h) => ({
      ws,
      pageId: h.pageId,
      title: h.title,
      summary: h.summary,
      brainName: nameOf(ws),
    }));
  };
  if (brain) {
    const hits = (await one(brain)).slice(0, limit);
    if (hits.length || !q.trim()) return hits;
    // Nothing matched the words: show the brain's own pages, and say so.
    const idx = await cached(`index|${brain}`, () => wikiApi.index(brain));
    return idx.pages.slice(0, limit).map((x) => ({
      ws: brain,
      pageId: x.id,
      title: x.title,
      summary: x.summary,
      brainName: nameOf(brain),
      fallback: true,
    }));
  }
  if (!q.trim()) return [];
  const out = await Promise.allSettled([...names.keys()].slice(0, 12).map(one));
  return out.flatMap((o) => (o.status === "fulfilled" ? o.value : [])).slice(0, limit);
}

function usePages(q: string, brain: string | undefined, limit: number): Resolved<PageHit[]> {
  const { t } = useI18n();
  const mine = t("v4.personal");
  return useResolved(`pages|${brain ?? ""}|${q}|${limit}`, () => findPages(q, brain, limit, mine));
}

function PageListLeaf({ p }: { p: { q: string; brain?: string; limit?: number } }) {
  const { t } = useI18n();
  const { onNavigate } = useC();
  const res = usePages(p.q, p.brain, p.limit ?? 5);
  return (
    <Leaf res={res}>
      {(rows) => (
        <Frame
          testId="agent-pagelist"
          icon={<Rows3 size={20} />}
          title={t("v6.t.pages")}
          summary={`${t("v6.t.pages")}: ${rows.length}.`}
          heading={false}
          chart={
            rows.length ? (
              <>
                {rows[0]?.fallback ? <p className="ag-quiet">{t("v6.pages.fallback")}</p> : null}
                <ul className="ag-pages">
                  {rows.map((h) => (
                    <li key={`${h.ws}:${h.pageId}`}>
                      <Link to={pageLink(h.ws, h.pageId)} onClick={onNavigate}>
                        {h.title}
                      </Link>
                      <span className="ag-tag">{h.brainName}</span>
                      {h.summary ? <p>{h.summary}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="icard-empty">{t("v6.pages.none")}</p>
            )
          }
          table={
            <TwinTable
              caption={t("v6.t.pages")}
              head={[t("v5.table.page"), t("v6.col.brain"), t("v6.col.summary")]}
              rows={rows.map((h) => [h.title, h.brainName, h.summary])}
            />
          }
        />
      )}
    </Leaf>
  );
}

function PageCardLeaf({ p }: { p: { brain: string; page: string } }) {
  const { t } = useI18n();
  const { onNavigate, inCard } = useC();
  const res = useResolved(`page|${p.brain}|${p.page}`, async () => {
    const [pg, names] = await Promise.all([
      cached(`pg|${p.brain}|${p.page}`, () => wikiApi.page(p.brain, p.page)),
      navNames(),
    ]);
    return { pg, brain: p.brain === "me" ? t("v4.personal") : (names.get(p.brain) ?? p.brain) };
  });
  return (
    <Leaf res={res}>
      {({ pg, brain }) => {
        const body = (
          <article className="ag-pcard" data-testid="agent-pagecard">
            <h4>
              <Link to={pageLink(p.brain, p.page)} onClick={onNavigate}>
                {pg.title}
              </Link>
            </h4>
            <span className="ag-tag">{t("v6.pages.in", { brain })}</span>
            {pg.summary ? <p>{pg.summary}</p> : null}
          </article>
        );
        return inCard ? body : <div className="icard ag-pcard-wrap">{body}</div>;
      }}
    </Leaf>
  );
}

function TableLeaf({
  p,
}: {
  p: {
    source: "pages" | "brains" | "coverage" | "sources";
    brain?: string;
    q?: string;
    limit?: number;
  };
}) {
  const { t, td } = useI18n();
  const mine = t("v4.personal");
  const limit = p.limit ?? 10;
  const res = useResolved(`tbl|${p.source}|${p.brain ?? ""}|${p.q ?? ""}|${limit}`, async () => {
    if (p.source === "pages") {
      const rows = await findPages(p.q ?? "", p.brain, limit, mine);
      return {
        head: [t("v5.table.page"), t("v6.col.brain"), t("v6.col.summary")],
        rows: rows.map((h) => [h.title, h.brainName, h.summary]),
        title: t("v6.t.pages"),
      };
    }
    if (p.source === "brains") {
      const r = await cached("brains", () => v3.brains());
      return {
        head: [t("v6.col.brain"), t("v6.col.type"), t("v5.table.pages"), t("v6.col.health")],
        rows: r.brains
          .slice(0, limit)
          .map((b) => [
            b.id === "me" ? mine : b.name,
            td("v5.type", b.type, b.type),
            b.pages,
            `${b.health.score}%`,
          ]),
        title: t("v6.t.brains"),
      };
    }
    const d = await insightsOf(p.brain ?? "me");
    if (p.source === "coverage")
      return {
        head: [t("v5.table.section"), t("v5.table.value"), t("v5.table.target")],
        rows: d.focus.coverage.slice(0, limit).map((r) => [r.label, r.value, r.target]),
        title: `${d.name}: ${t("v6.t.fit")}`,
      };
    return {
      head: [t("v5.table.source"), t("v5.table.pages")],
      rows: d.health.sources
        .slice(0, limit)
        .map((s) => [t(`v5.src.${s.kind}` as "v5.src.manual"), s.count]),
      title: `${d.name}: ${t("v5.health.sources")}`,
    };
  });
  const c = useC();
  return (
    <Leaf res={res}>
      {(d) => {
        const tbl = (
          <TwinTable caption={d.title} head={d.head} rows={d.rows as (string | number)[][]} />
        );
        return c.inCard ? (
          <div className="ag-leaf" data-testid="agent-table">
            {tbl}
          </div>
        ) : (
          <InsightCard
            className="ag-loose"
            testId="agent-table"
            icon={<Rows3 size={20} />}
            title={d.title}
            summary={`${d.title}: ${d.rows.length}.`}
          >
            {tbl}
          </InsightCard>
        );
      }}
    </Leaf>
  );
}

// ---------- static nodes ----------

function CalloutNode({
  p,
}: {
  p: { tone: "info" | "warning" | "success"; template: string; note?: string };
}) {
  const { t } = useI18n();
  const Icon = p.tone === "warning" ? TriangleAlert : p.tone === "success" ? CircleCheck : Info;
  return (
    <div className={`ag-callout ${p.tone}`} role="note" data-testid="agent-callout">
      <Icon size={18} aria-hidden />
      <div>
        <b>{t(`v6.callout.tone.${p.tone}` as Key)}</b>
        <p>{t(`v6.callout.${p.template}` as Key)}</p>
        {p.note ? <p className="ag-note">{p.note}</p> : null}
      </div>
    </div>
  );
}

function ButtonsNode({ node }: { node: AgentNode }) {
  const nav = useNavigate();
  const { onTurn, onNavigate, inCard } = useC();
  return (
    <div className="ag-buttons" data-testid="agent-buttons">
      {node.children.map((b) => {
        const label = String(b.props.label ?? "");
        const action = String(b.props.action ?? "");
        const values = (b.props.values ?? {}) as Record<string, string>;
        return (
          <button
            key={b.id}
            type="button"
            className={inCard ? "icard-btn" : "btn soft sm"}
            onClick={() => {
              if (action === "open_page" && values.brain && values.page) {
                onNavigate();
                nav(pageLink(values.brain, values.page));
              } else if (action === "open_brain" && values.brain) {
                onNavigate();
                nav(brainLink(values.brain));
              } else if (
                action === "focus" ||
                action === "compare" ||
                action === "filter" ||
                action === "ask"
              ) {
                onTurn({ action, values }, label);
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- tree ----------

function CardNode({ node }: { node: AgentNode }) {
  const { t } = useI18n();
  const base = useC();
  const title = String(node.props.title ?? "");
  const subtitle = typeof node.props.subtitle === "string" ? node.props.subtitle : undefined;
  const first = node.children[0]?.type ?? "";
  const kids = (table: boolean) => (
    <C.Provider value={{ ...base, inCard: true, table, single: node.children.length === 1 }}>
      {node.children.map((c) => (
        <NodeView key={c.id} node={c} />
      ))}
    </C.Provider>
  );
  return (
    <InsightCard
      className="ag-card"
      testId="agent-card"
      icon={CARD_ICON[first] ?? <Sparkles size={20} />}
      title={title}
      subtitle={subtitle}
      summary={t("v6.card.summary", { title })}
      {...(base.forceTable ? {} : { table: kids(true) })}
    >
      {kids(base.forceTable)}
    </InsightCard>
  );
}

const asStr = (v: unknown): string => String(v ?? "");

function NodeView({ node }: { node: AgentNode }) {
  if (node.partial) return <Skel />;
  const p = node.props as never;
  const q: Record<string, unknown> = node.props;
  switch (node.type) {
    case "Stack":
    case "Grid": {
      const kids = node.children.map((c) => <NodeView key={c.id} node={c} />);
      return node.type === "Stack" ? (
        <div className={`ag-stack gap-${asStr(q.gap) || "m"}`}>{kids}</div>
      ) : (
        <div className={`ag-grid cols-${asStr(q.cols) || "2"}`}>{kids}</div>
      );
    }
    case "InsightCard":
      return <CardNode node={node} />;
    case "KpiTile":
      return <KpiLeaf p={p} />;
    case "DotConstellation":
      return <ConstellationLeaf p={p} />;
    case "Beeswarm":
      return <BeeswarmLeaf p={p} />;
    case "Funnel":
      return <FunnelLeaf p={p} />;
    case "FitBars":
      return <FitLeaf p={p} />;
    case "TimelineBars":
      return <TimelineLeaf p={p} />;
    case "ActivityGrid":
      return <ActivityLeaf p={p} />;
    case "PageList":
      return <PageListLeaf p={p} />;
    case "PageCard":
      return <PageCardLeaf p={p} />;
    case "Table":
      return <TableLeaf p={p} />;
    case "Callout":
      return <CalloutNode p={p} />;
    case "Buttons":
      return <ButtonsNode node={node} />;
    case "Locked":
      return <LockedCard />;
    default:
      // Anything else is never drawn.
      return null;
  }
}

/** Draw one checked tree. `forceTable` shows every chart as its table twin. */
export function AgentRender({
  root,
  forceTable = false,
  onTurn,
  onNavigate,
  density = "comfortable",
  theme = "dark",
}: {
  root: AgentNode | null;
  forceTable?: boolean;
  onTurn?: (e: ActionEventValue, label: string) => void;
  onNavigate?: () => void;
  density?: Density;
  theme?: CardTheme;
}) {
  if (!root) return null;
  return (
    <div className={`ag-render ag-d-${density} ag-t-${theme}`} data-testid="agent-render">
      <C.Provider
        value={{
          inCard: false,
          table: false,
          single: false,
          forceTable,
          onTurn: onTurn ?? (() => {}),
          onNavigate: onNavigate ?? (() => {}),
        }}
      >
        <NodeView node={root} />
      </C.Provider>
    </div>
  );
}

/** How many cards (anything that is not layout) a tree holds so far. */
export function countCards(n: AgentNode | null): number {
  if (!n) return 0;
  if (n.type === "Stack" || n.type === "Grid")
    return n.children.reduce((a, c) => a + countCards(c), 0);
  return n.partial ? 0 : 1;
}
