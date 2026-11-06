import { Activity, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Await } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useDate } from "../../insights/hooks";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { pageLink } from "../../lib/links";
import { useApi } from "../../useApi";
import { EmptyArt } from "../lens/art";
import { pulseApi } from "./api";
import { DayDots, PulseLegend } from "./PulseDots";
import { type BrainPulse, CATEGORIES, type PulseDay } from "./types";

const WINDOWS = [30, 60, 90] as const;

function Day({
  d,
  brain,
  open,
  onToggle,
}: {
  d: PulseDay;
  brain: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, tn, locale } = useI18n();
  const id = `pulse-day-${d.date}`;
  const label = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.parse(`${d.date}T12:00:00Z`));
  return (
    <li className="pt8-day">
      <button
        type="button"
        className="pt8-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <ChevronRight size={16} aria-hidden className="pt8-chev" />
        <span className="pt8-date">{label}</span>
        <DayDots counts={d.counts} />
      </button>
      {open ? (
        <div id={id} className="pt8-entries">
          <ul>
            {CATEGORIES.filter((c) => d.counts[c] > 0).map((c) => (
              <li key={c}>
                <b className="mono">{d.counts[c]}</b> {t(`v8p.entry.${c}` as "v8p.entry.published")}
              </li>
            ))}
          </ul>
          {d.pages.length ? (
            <>
              <p className="pt8-sub">{tn(d.pages.length, "v8p.pages.one", "v8p.pages.other")}</p>
              <ul className="pt8-pages">
                {d.pages.map((p) => (
                  <li key={p.id}>
                    <Link to={pageLink(brain, p.id)}>{p.title}</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Timeline({ data, brain }: { data: BrainPulse; brain: string }) {
  const { t, tn } = useI18n();
  const date = useDate();
  const [open, setOpen] = useState<string | null>(data.days[0]?.date ?? null);
  const active = data.days.filter((d) => d.total > 0);
  const sums = CATEGORIES.map((c) => active.reduce((n, d) => n + d.counts[c], 0));
  return (
    <InsightCard
      testId="pulse-timeline"
      icon={<Activity size={20} aria-hidden />}
      title={t("v8p.title")}
      subtitle={t("v8p.sub", { from: date(data.from), to: date(data.to) })}
      summary={t("v8p.summary", { n: active.length, p: sums[0] ?? 0 })}
      table={
        active.length ? (
          <TwinTable
            caption={t("v8p.table")}
            head={[
              t("v5.table.day"),
              ...CATEGORIES.map((c) => t(`v8p.cat.${c}` as "v8p.cat.published")),
            ]}
            rows={active.map((d) => [date(d.date), ...CATEGORIES.map((c) => d.counts[c])])}
          />
        ) : undefined
      }
    >
      {active.length ? (
        <>
          <PulseLegend />
          <ol className="pt8" aria-label={t("v8p.title")}>
            {active.map((d, i) => {
              const prev = active[i - 1];
              const quiet = prev
                ? Math.round((Date.parse(prev.date) - Date.parse(d.date)) / 86_400_000) - 1
                : 0;
              return (
                <Fragment key={d.date}>
                  {quiet > 0 ? (
                    <li className="pt8-quiet" aria-hidden>
                      {tn(quiet, "v8p.quiet.one", "v8p.quiet.other")}
                    </li>
                  ) : null}
                  <Day
                    d={d}
                    brain={brain}
                    open={open === d.date}
                    onToggle={() => setOpen(open === d.date ? null : d.date)}
                  />
                </Fragment>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="lens-empty" data-testid="pulse-empty">
          <EmptyArt kind="pulse" />
          <p>
            <b>{t("v8p.none.t")}</b>
          </p>
          <p>{t("v8p.none.l")}</p>
          <p>
            <Link className="who8-link" to={`/brains/${encodeURIComponent(brain)}/journal`}>
              {t("v8p.journal")}
            </Link>
          </p>
        </div>
      )}
    </InsightCard>
  );
}

export function PulsePage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [days, setDays] = useState<number>(60);
  const r = useApi(() => pulseApi.brain(id, days), [id, days]);
  return (
    <div className="page v4page" data-testid="pulse-page">
      <nav className="crumbs4" aria-label={t("v4.crumbs")}>
        <Link to={`/brains/${encodeURIComponent(id)}`}>{r.data?.name ?? id}</Link>
      </nav>
      <header className="bhead">
        <div className="bhead-main">
          <h1>{t("v8p.page", { name: r.data?.name ?? "" })}</h1>
          <p className="muted">{t("v8p.page.lead")}</p>
        </div>
        <div className="bhead-actions">
          <div className="seg5 pulse-seg" role="radiogroup" aria-label={t("v8p.window")}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={days === w}
                onClick={() => setDays(w)}
              >
                {t("v8p.days", { n: w })}
              </button>
            ))}
          </div>
        </div>
      </header>
      <Await state={r} skeleton={3}>
        {(d) => <Timeline data={d} brain={id} />}
      </Await>
    </div>
  );
}
