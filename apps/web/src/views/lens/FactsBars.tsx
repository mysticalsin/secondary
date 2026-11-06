import { CalendarRange } from "lucide-react";
import { useI18n } from "../../i18n";
import { useDate } from "../../insights/hooks";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { EmptyArt } from "./art";
import type { FactBar } from "./types";

const DAY = 86_400_000;
const SHOWN = 6;

const stripSubject = (s: string): string => s.replace(/^[a-z]+:\s*/i, "");

/** Facts as bars from valid_from to valid_to. A fact that clashes with another is striped and named. */
export function FactsBars({ facts, now = Date.now() }: { facts: FactBar[]; now?: number }) {
  const { t } = useI18n();
  const date = useDate();
  const rows = facts.slice(0, SHOWN);
  const starts = facts.map((f) => Date.parse(f.validAt));
  const ends = facts.map((f) => (f.invalidAt ? Date.parse(f.invalidAt) : now));
  const lo = Math.min(...starts, now - DAY * 30);
  const hi = Math.max(...ends, now);
  const span = Math.max(DAY * 30, hi - lo);
  const x = (ms: number) => Math.max(0, Math.min(100, ((ms - lo) / span) * 100));
  const clashes = facts.filter((f) => f.contradiction).length;
  const status = (f: FactBar): string =>
    f.contradiction
      ? t("v8l.facts.st.conflict")
      : f.invalidAt
        ? t("v8l.facts.st.ended")
        : f.unverified
          ? t("v8l.facts.st.unverified")
          : t("v8l.facts.st.current");
  return (
    <InsightCard
      testId="lens-facts"
      icon={<CalendarRange size={20} aria-hidden />}
      title={t("v8l.facts.title")}
      subtitle={t("v8l.facts.sub")}
      summary={
        facts.length ? t("v8l.facts.summary", { n: facts.length, c: clashes }) : t("v8l.facts.none")
      }
      table={
        facts.length ? (
          <TwinTable
            caption={t("v8l.facts.table")}
            head={[
              t("v8l.facts.fact"),
              t("v5.table.start"),
              t("v5.table.end"),
              t("v8l.facts.state"),
            ]}
            rows={facts.map((f) => [
              `${stripSubject(f.subject)}: ${f.object}`,
              date(f.validAt),
              f.invalidAt ? date(f.invalidAt) : t("v8l.facts.open"),
              status(f),
            ])}
          />
        ) : undefined
      }
    >
      {rows.length ? (
        <>
          <ul className="fb8" aria-label={t("v8l.facts.title")}>
            {rows.map((f) => {
              const from = Date.parse(f.validAt);
              const to = f.invalidAt ? Date.parse(f.invalidAt) : now;
              const left = x(from);
              const width = Math.max(1.5, x(to) - left);
              return (
                <li key={f.id} className={f.contradiction ? "clash" : ""}>
                  <p className="fb8-l">
                    <b>{f.object}</b>
                    <span>{stripSubject(f.subject)}</span>
                    {f.contradiction ? (
                      <em className="fb8-chip">{t("v8l.facts.st.conflict")}</em>
                    ) : null}
                  </p>
                  <div className="fb8-track" aria-hidden>
                    <span
                      className={`fb8-bar${f.invalidAt ? " ended" : ""}${f.unverified ? " unv" : ""}${f.contradiction ? " clash" : ""}`}
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                    />
                    {f.invalidAt ? null : (
                      <span
                        className="fb8-open"
                        style={{ left: `${Math.min(99, left + width)}%` }}
                      />
                    )}
                  </div>
                  <p className="fb8-d">
                    {f.invalidAt
                      ? t("brain.fact.range", { from: date(f.validAt), to: date(f.invalidAt) })
                      : t("brain.fact.since", { from: date(f.validAt) })}
                    {f.unverified && !f.contradiction ? ` · ${t("brain.fact.unverified")}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="fb8-axis" aria-hidden>
            <span>{date(new Date(lo).toISOString())}</span>
            <span>{date(new Date(now).toISOString())}</span>
          </div>
          {facts.length > SHOWN ? (
            <p className="fb8-more">{t("v8l.facts.more", { n: facts.length - SHOWN })}</p>
          ) : null}
        </>
      ) : (
        <div className="lens-empty">
          <EmptyArt kind="facts" />
          <p>
            <b>{t("v8l.facts.none.t")}</b>
          </p>
          <p>{t("v8l.facts.none.l")}</p>
        </div>
      )}
    </InsightCard>
  );
}
