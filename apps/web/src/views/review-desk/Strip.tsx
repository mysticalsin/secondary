import { ListChecks } from "lucide-react";
import { useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { KpiTile } from "../../insights/KpiTile";
import type { Desk, StripDot } from "./types";

const MAX_STACK = 6;

/** A decision time in the unit a person thinks in: hours under two days, then days. */
export function useDuration(): (hours: number | null) => string {
  const { t } = useI18n();
  return (h) => {
    if (h === null) return t("v8r.kpi.none");
    if (h < 48) return t("v8r.dur.h", { n: Math.round(h * 10) / 10 });
    return t("v8r.dur.d", { n: Math.round((h / 24) * 10) / 10 });
  };
}

const day = (iso: string) => String(Number(iso.slice(8, 10)));

function Shape({ state }: { state: StripDot["state"] }) {
  return <span className={`rv-dot ${state}`} aria-hidden />;
}

/**
 * The dark top card: incoming proposals of the last 14 days as dots (shape and colour tell the
 * state), four KPIs, and a table twin.
 */
export function Strip({ desk }: { desk: Desk }) {
  const { t, locale } = useI18n();
  const dur = useDuration();
  const { strip, kpis } = desk;
  const by = new Map<string, StripDot[]>();
  for (const d of strip.dots) by.set(d.day, [...(by.get(d.day) ?? []), d]);
  const count = (s: StripDot["state"]) => strip.dots.filter((d) => d.state === s).length;
  const month = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(`${iso}T12:00:00Z`),
    );
  const summary = t("v8r.strip.summary", {
    n: strip.dots.length,
    w: count("waiting"),
    a: count("approved"),
    r: count("rejected"),
  });
  return (
    <InsightCard
      className="rv-strip"
      testId="rv-strip"
      icon={<ListChecks size={20} aria-hidden />}
      title={t("v8r.strip.title")}
      subtitle={t("v8r.strip.sub")}
      summary={summary}
      table={
        <TwinTable
          caption={t("v8r.strip.table")}
          head={[
            t("v8r.strip.col.day"),
            t("v8r.state.waiting"),
            t("v8r.state.approved"),
            t("v8r.state.rejected"),
          ]}
          rows={strip.days.map((d) => {
            const here = by.get(d) ?? [];
            const c = (s: StripDot["state"]) => here.filter((x) => x.state === s).length;
            return [d, c("waiting"), c("approved"), c("rejected")];
          })}
        />
      }
    >
      <div className="rv-strip-body">
        {/* biome-ignore lint/a11y/useSemanticElements: an image of dots, described by the summary */}
        <div className="rv-timeline" role="img" aria-label={summary}>
          {strip.days.map((d, i) => {
            const here = by.get(d) ?? [];
            const shown = here.slice(0, MAX_STACK);
            return (
              <div className="rv-col" key={d} data-day={d}>
                <div className="rv-stack">
                  {here.length > MAX_STACK ? (
                    <span className="rv-more">+{here.length - MAX_STACK}</span>
                  ) : null}
                  {shown.map((x) => (
                    <Shape key={x.id} state={x.state} />
                  ))}
                </div>
                <span className={`rv-day${i === strip.days.length - 1 ? " today" : ""}`}>
                  {i === 0 || d.endsWith("-01") ? `${day(d)} ${month(d)}` : day(d)}
                </span>
              </div>
            );
          })}
        </div>
        <ul className="rv-legend">
          {(["waiting", "approved", "rejected"] as const).map((s) => (
            <li key={s}>
              <Shape state={s} /> {t(`v8r.state.${s}` as never)} <b className="mono">{count(s)}</b>
            </li>
          ))}
        </ul>
        <div className="rv-kpis">
          <KpiTile
            testId="rv-kpi-waiting"
            value={String(kpis.waiting)}
            label={t("v8r.kpi.waiting")}
          />
          <KpiTile
            testId="rv-kpi-median"
            value={dur(kpis.medianHoursToDecision)}
            label={t("v8r.kpi.median")}
          />
          <KpiTile
            testId="rv-kpi-overdue"
            value={String(kpis.overdue)}
            label={t("v8r.kpi.overdue")}
          />
          <KpiTile
            testId="rv-kpi-cleared"
            value={String(kpis.clearedThisWeek)}
            label={t("v8r.kpi.cleared")}
          />
        </div>
      </div>
    </InsightCard>
  );
}
