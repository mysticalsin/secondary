import { Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useDate } from "../../insights/hooks";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { useApi } from "../../useApi";
import { EmptyArt } from "../lens/art";
import { pulseApi } from "./api";
import { daysBetween, PULSE_COLOR } from "./colors";
import { PulseLegend } from "./PulseDots";
import { CATEGORIES, type PulseRow } from "./types";

const isWeekend = (day: string): boolean => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

function Row({ row, days }: { row: PulseRow; days: string[] }) {
  const { t } = useI18n();
  const byDay = new Map(row.days.map((d) => [d.date, d.d]));
  const total = row.days.reduce((n, d) => n + d.d.reduce((a, b) => a + b, 0), 0);
  const name = row.brainId === "me" ? t("v4.personal") : row.name;
  return (
    <li className="pa8-row">
      <Link className="pa8-name" to={`/brains/${encodeURIComponent(row.brainId)}/pulse`}>
        {name}
      </Link>
      {/* One focus stop per row: the table twin and the brain's pulse page hold the detail. */}
      <div
        className="pa8-cols"
        role="img"
        aria-label={t("v8p.across.row", { name, n: total })}
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          const d = byDay.get(day);
          return (
            <span key={day} className={`pa8-cell${isWeekend(day) ? " wk" : ""}`}>
              {CATEGORIES.map((c, k) => {
                const n = d?.[k] ?? 0;
                return n > 0 ? (
                  <span
                    key={c}
                    className="pa8-dot"
                    style={{ background: PULSE_COLOR[c] }}
                    title={`${day}: ${t(`v8p.cat.${c}` as "v8p.cat.published")} ${n}`}
                  />
                ) : null;
              })}
            </span>
          );
        })}
      </div>
    </li>
  );
}

/** Home: one row per brain, a column per day for 30 days. Each brain's row comes only from that brain. */
export function PulseAcross() {
  const { t } = useI18n();
  const date = useDate();
  const r = useApi(() => pulseApi.all(30), []);
  if (r.error) return null;
  const d = r.data;
  const rows = (d?.brains ?? []).filter((b) => b.type !== "personal" || b.days.length > 0);
  const days = d ? daysBetween(d.from, d.to) : [];
  const live = rows.filter((b) => b.days.length > 0);
  const sum = (b: PulseRow, k: number) => b.days.reduce((n, x) => n + (x.d[k] ?? 0), 0);
  return (
    <section className="hsec" data-testid="pulse-across">
      <InsightCard
        icon={<Activity size={20} aria-hidden />}
        title={t("v8p.across")}
        subtitle={
          d ? t("v8p.across.sub", { from: date(d.from), to: date(d.to) }) : t("v8p.across.sub.n")
        }
        summary={t("v8p.across.summary", { n: live.length })}
        table={
          live.length ? (
            <TwinTable
              caption={t("v8p.across.table")}
              head={[
                t("v8l.table.brain"),
                ...CATEGORIES.map((c) => t(`v8p.cat.${c}` as "v8p.cat.published")),
              ]}
              rows={live.map((b) => [
                b.brainId === "me" ? t("v4.personal") : b.name,
                ...CATEGORIES.map((_, k) => sum(b, k)),
              ])}
            />
          ) : undefined
        }
      >
        {!d ? (
          <div className="skeleton" aria-hidden />
        ) : live.length ? (
          <>
            <PulseLegend />
            <ul className="pa8">
              {live.map((b) => (
                <Row key={b.brainId} row={b} days={days} />
              ))}
            </ul>
            <div className="pa8-axis" aria-hidden>
              <span>{date(d.from)}</span>
              <span>{date(d.to)}</span>
            </div>
          </>
        ) : (
          <div className="lens-empty" data-testid="pulse-across-empty">
            <EmptyArt kind="pulse" />
            <p>
              <b>{t("v8p.across.none.t")}</b>
            </p>
            <p>{t("v8p.across.none.l")}</p>
          </div>
        )}
      </InsightCard>
    </section>
  );
}
