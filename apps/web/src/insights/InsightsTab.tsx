import { ChartNoAxesColumn, Clock, Filter, Radar } from "lucide-react";
import { useMemo, useState } from "react";
import { Await } from "../components/ui";
import { useI18n } from "../i18n";
import { displayName } from "../lib/people";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { insightsApi } from "./api";
import { Beeswarm } from "./Beeswarm";
import { DotConstellation } from "./DotConstellation";
import { FocusPanel } from "./FocusPanel";
import { Funnel } from "./Funnel";
import { useNumber } from "./hooks";
import { InsightCard, TwinTable } from "./InsightCard";
import { KpiTile } from "./KpiTile";
import { SOURCE_COLOR } from "./palette";
import { QueryChips } from "./QueryChips";
import { SegmentBar } from "./SegmentBar";
import { Segmented } from "./Segmented";
import type { Insights, Mode, ScoreKind } from "./types";

const KINDS: ScoreKind[] = ["freshness", "confidence", "evidence"];

function ConstellationCard({
  d,
  mode,
  setMode,
  q,
  setQ,
  selected,
  setSelected,
}: {
  d: Insights;
  mode: Mode;
  setMode: (m: Mode) => void;
  q: string;
  setQ: (q: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const { me } = useApp();
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
    .slice(0, 60)
    .map((x) => [
      x.title ?? t("v5.n.pages.other", { n: x.k }),
      label.get(x.sector) ?? x.sector,
      x.score,
      x.inZone ? t("v5.yes") : t("v5.no"),
    ]);
  return (
    <InsightCard
      className="constellation"
      testId="insight-constellation"
      icon={<Radar size={20} />}
      title={t("v5.con.title")}
      subtitle={t(mode === "relevance" ? "v5.con.sub.relevance" : "v5.con.sub.freshness")}
      control={
        <Segmented
          label={t("v5.mode.label")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "relevance", label: t("v5.mode.relevance") },
            { value: "freshness", label: t("v5.mode.freshness") },
          ]}
        />
      }
      summary={summary}
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
      footer={
        <QueryChips
          value={q}
          terms={c.terms}
          who={displayName(me)}
          searchHref={q ? `/search?q=${encodeURIComponent(q)}` : "/search"}
          onSubmit={setQ}
        />
      }
    >
      {c.dots.length ? (
        <DotConstellation
          data={c}
          name={d.name}
          selected={selected}
          onSelect={(id) => setSelected(id === selected ? null : id)}
          summary={summary}
        />
      ) : (
        <p className="icard-empty">{t("v5.empty.lead")}</p>
      )}
    </InsightCard>
  );
}

function HealthCard({
  d,
  kind,
  setKind,
}: {
  d: Insights;
  kind: ScoreKind;
  setKind: (k: ScoreKind) => void;
}) {
  const { t } = useI18n();
  const num = useNumber();
  const h = d.health;
  const above = h.above[kind];
  const week = h.weekDelta[kind];
  const kindName = t(`v5.health.kind.${kind}` as "v5.health.kind.freshness");
  const summary = t("v5.health.summary", {
    above,
    total: h.total,
    t: h.threshold,
    kind: kindName,
    below: h.total - above,
    week,
  });
  const bins = useMemo(() => {
    const out = new Array<number>(10).fill(0);
    for (const p of h.points) {
      const i = Math.min(9, Math.floor(p.score / 10));
      out[i] = (out[i] ?? 0) + p.k;
    }
    return out;
  }, [h.points]);
  const total = h.sources.reduce((n, s) => n + s.count, 0);
  return (
    <InsightCard
      className="health"
      testId="insight-health"
      icon={<ChartNoAxesColumn size={20} />}
      title={t("v5.health.title")}
      subtitle={t("v5.health.sub", { name: d.name, t: h.threshold })}
      control={
        <Segmented
          label={t("v5.health.kind")}
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({
            value: k,
            label: t(`v5.health.kind.${k}` as "v5.health.kind.freshness"),
          }))}
        />
      }
      summary={summary}
      table={
        <>
          <TwinTable
            caption={`${t("v5.health.title")}: ${kindName}`}
            head={[t("v5.table.score"), t("v5.table.pages")]}
            rows={bins.map((n, i) => [`${i * 10}${i === 9 ? " to 100" : ` to ${i * 10 + 9}`}%`, n])}
          />
          <TwinTable
            caption={t("v5.health.sources")}
            head={[t("v5.table.source"), t("v5.table.pages"), t("v5.table.share")]}
            rows={h.sources.map((s) => [
              t(`v5.src.${s.kind}` as "v5.src.manual"),
              s.count,
              `${Math.round((s.count / (total || 1)) * 100)}%`,
            ])}
          />
        </>
      }
    >
      <div className="big">
        <b className="big-n">{num(above)}</b>
        <span className="big-l">
          {t("v5.health.above", { t: h.threshold })}
          <br />
          <span className="mono-soft">{t("v5.health.of", { total: num(h.total) })}</span>
        </span>
        {week > 0 ? <span className="pill-up">{t("v5.health.week", { n: week })}</span> : null}
      </div>
      <p className="bs-meta">
        <span>
          {h.perPoint === 1
            ? t("v5.health.perdot.one")
            : t("v5.health.perdot.other", { k: h.perPoint })}
        </span>
      </p>
      {h.points.length ? (
        <Beeswarm
          points={h.points}
          scoreKind={kind}
          threshold={h.threshold}
          label={t("v5.health.axis", { kind: kindName, lo: 0 })}
        />
      ) : (
        <p className="icard-empty">{t("v5.empty.lead")}</p>
      )}
      <SegmentBar
        title={t("v5.health.sources")}
        total={total}
        segments={h.sources.map((s) => ({
          key: s.kind,
          label: t(`v5.src.${s.kind}` as "v5.src.manual"),
          value: s.count,
          color: SOURCE_COLOR[s.kind] ?? "#888",
        }))}
      />
    </InsightCard>
  );
}

function FlowCard({ d }: { d: Insights }) {
  const { t } = useI18n();
  const num = useNumber();
  const f = d.flow;
  const count = (k: string) => f.stages.find((s) => s.key === k)?.count ?? 0;
  const empty = f.stages.every((s) => s.count === 0);
  const days = Number.parseInt(f.window, 10) || 30;
  const promoted = f.stages.find((s) => s.key === "promoted");
  const summary = t("v5.flow.summary", {
    ingested: count("ingested"),
    proposed: count("proposed"),
    reviewed: count("reviewed"),
    published: count("published"),
    promoted: promoted ? t("v5.flow.summary.promoted", { n: promoted.count }) : "",
  });
  return (
    <InsightCard
      className="flow"
      testId="insight-flow"
      icon={<Filter size={20} />}
      title={t("v5.flow.title")}
      subtitle={t("v5.flow.sub", { name: d.name })}
      control={
        <span className="icard-pill">
          <Clock size={14} aria-hidden /> {t("v5.flow.window", { n: days })}
        </span>
      }
      summary={summary}
      table={
        <TwinTable
          caption={t("v5.flow.title")}
          head={[t("v5.table.stage"), t("v5.table.count")]}
          rows={f.stages.map((s) => [t(`v5.stage.${s.key}` as "v5.stage.ingested"), s.count])}
        />
      }
    >
      {empty ? (
        <div className="icard-empty">
          <b>{t("v5.flow.none")}</b>
          <p>{t("v5.flow.none.lead")}</p>
        </div>
      ) : (
        <>
          <div className="big">
            <b className="big-n">{f.publishRate === null ? "-" : `${f.publishRate}%`}</b>
            <span className="big-l">{t("v5.flow.rate")}</span>
          </div>
          <Funnel stages={f.stages} label={t("v5.flow.title")} />
        </>
      )}
      <div className="kpis">
        <KpiTile
          testId="kpi-review"
          value={
            f.medianDaysToReview === null
              ? t("v5.kpi.na")
              : t("v5.kpi.review.value", { n: num(f.medianDaysToReview) })
          }
          label={t("v5.kpi.review")}
        />
        <KpiTile
          testId="kpi-seen"
          value={
            f.seenAllRate === null ? t("v5.kpi.na") : t("v5.kpi.seen.value", { n: f.seenAllRate })
          }
          label={t("v5.kpi.seen")}
        />
      </div>
    </InsightCard>
  );
}

/** The Insights tab of a brain: map, focus, health and flow. */
export function InsightsTab({ brainId }: { brainId: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("relevance");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ScoreKind>("freshness");
  const [focusId, setFocusId] = useState<string | null>(null);
  const state = useApi(
    () => insightsApi.insights(brainId, { mode, q, scoreKind: kind, focus: focusId }),
    [brainId, mode, q, kind, focusId],
  );
  return (
    <div className="insights" data-testid="insights">
      <Await state={state} skeleton={3}>
        {(d) => (
          <>
            <div className="ins-row top">
              <ConstellationCard
                d={d}
                mode={mode}
                setMode={setMode}
                q={q}
                setQ={setQ}
                selected={focusId}
                setSelected={setFocusId}
              />
              <FocusPanel
                brainId={brainId}
                brainName={d.name}
                focus={d.focus}
                now={d.generatedAt.slice(0, 10)}
                onBack={() => setFocusId(null)}
                onStatusSent={state.reload}
              />
            </div>
            <div className="ins-row bottom">
              <HealthCard d={d} kind={kind} setKind={setKind} />
              <FlowCard d={d} />
            </div>
            <p className="sr-only" aria-live="polite">
              {state.loading ? t("v5.loading") : ""}
            </p>
          </>
        )}
      </Await>
    </div>
  );
}
