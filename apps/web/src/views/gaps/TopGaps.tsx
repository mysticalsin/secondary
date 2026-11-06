import { CircleHelp } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { InsightCard, TwinTable } from "../../insights/InsightCard";
import { ago } from "../../lib/time";
import { useApi } from "../../useApi";
import { gapsApi } from "./api";
import { GapDots } from "./GapDots";
import "./gaps.css";

/** Home: the gaps people asked about most in the brains this person stewards. Nothing for anyone else. */
export function TopGaps() {
  const { t, tn } = useI18n();
  const top = useApi(() => gapsApi.top(5).catch(() => null), []);
  const d = top.data;
  if (!d?.stewards || !d.gaps.length) return null;
  const rate = d.kpi.closureRate === null ? t("v8g.kpi.rate.none") : `${d.kpi.closureRate}%`;
  return (
    <section className="hsec" aria-label={t("v8g.home.title")} data-testid="top-gaps">
      <InsightCard
        icon={<CircleHelp size={20} aria-hidden />}
        title={t("v8g.home.title")}
        subtitle={t("v8g.home.sub")}
        control={<span className="icard-pill mono">{t("v8g.home.rate", { rate })}</span>}
        summary={t("v8g.home.summary", { n: d.gaps.length, rate })}
        table={
          <TwinTable
            caption={t("v8g.home.list")}
            head={[
              t("v8g.table.q"),
              t("v8g.table.brain"),
              t("v8g.table.asks"),
              t("v8g.table.last"),
            ]}
            rows={d.gaps.map((g) => [
              g.text,
              g.brainName,
              g.days.reduce((a, x) => a + x.count, 0),
              ago(g.lastAt),
            ])}
          />
        }
      >
        <ol className="gp-rows gp-top" aria-label={t("v8g.home.list")}>
          {d.gaps.map((g) => (
            <li key={`${g.brainId}-${g.id}`} className="gp-row">
              <div className="gp-main">
                <p className="gp-q">{g.text}</p>
                <p className="gp-meta">
                  <Link
                    className="gp-link"
                    to={`/brains/${encodeURIComponent(g.brainId)}?tab=gaps`}
                    aria-label={t("v8g.home.open", { name: g.brainName })}
                  >
                    {g.brainName}
                  </Link>
                  <span className="mono">{tn(g.count, "v8g.asks.one", "v8g.asks.other")}</span>
                  <span>{t("v8g.last", { when: ago(g.lastAt) })}</span>
                </p>
              </div>
              <div className="gp-dotcol">
                <GapDots days={g.days} />
              </div>
            </li>
          ))}
        </ol>
      </InsightCard>
    </section>
  );
}
