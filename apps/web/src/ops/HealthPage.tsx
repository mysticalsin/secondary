import { HeartPulse } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { TwinTable } from "../insights/InsightCard";
import { Segmented } from "../insights/Segmented";
import { zoneName } from "../lib/time";
import { useApi } from "../useApi";
import { ops } from "./api";
import { dayLabel, num, pctL } from "./format";
import { Gauge } from "./Gauge";
import { Heatmap, HeatTwin } from "./Heatmap";
import type { FailureReason, HealthWindow } from "./types";
import { Panel, StateBox, Swatch, SyntheticChip } from "./ui";

const REASON_TONE: Record<FailureReason, string> = {
  permission_denied: "fail",
  graph_429: "warn",
  timeout: "timeout",
  blocked_by_rule: "fail",
  classifier_asked: "brand",
  parse_error: "grey",
};

/** Settings > Health: success gauge with the SLO, outcomes, failures by reason, and the heatmap. */
export function HealthPage() {
  const { t, td, lang, locale } = useI18n();
  const uid = useUid();
  const [win, setWin] = useState<HealthWindow>("24h");
  const h = useApi(() => ops.health(win), [win]);
  const d = h.data;
  const wins: { value: HealthWindow; label: string }[] = [
    { value: "1h", label: "1h" },
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
  ];
  const range = d
    ? win === "7d"
      ? `${dayLabel(d.heatmap.columns[0] as string, lang)} - ${dayLabel(d.generatedAt, lang)}`
      : `${dayLabel(d.generatedAt, lang)} · ${zoneName(Date.parse(d.generatedAt))}`
    : "";
  return (
    <section aria-labelledby={`${uid}-h`} className="opx-healthpage">
      <h2 id={`${uid}-h`} className="sec-title">
        {t("v7o.health.title")}
      </h2>
      <p className="muted">{t("v7o.health.lead")}</p>
      {d?.scope === "stewards" ? (
        <p className="opx-scope" data-testid="health-scope">
          {t("v7o.health.scope")}
        </p>
      ) : null}
      {h.error && !d ? (
        <StateBox
          kind="error"
          title={h.status === 403 ? t("v7o.err.forbidden") : t("v7o.err.load")}
          hint={h.status === 403 ? t("v7o.health.forbidden") : h.error}
          action={
            h.status === 403 ? undefined : (
              <button type="button" className="icard-btn" onClick={h.reload}>
                {t("v7o.retry")}
              </button>
            )
          }
        />
      ) : !d ? (
        <StateBox kind="loading" title={t("v7o.loading.health")} />
      ) : (
        <div className="opx-health-grid" aria-busy={h.loading}>
          <div className="icard opx opx-hl" data-testid="health-gauge">
            <div className="opx-hl-b">
              <Panel
                title={t("v7o.gauge.title")}
                meta={
                  <span className="mono">
                    {t("v7o.gauge.window", { win: t(`v7o.hwin.${win}` as "v7o.hwin.1h") })}
                  </span>
                }
                summary={t("v7o.gauge.summary", {
                  rate: pctL(d.success.rate, locale),
                  failed: num(d.success.failed, locale),
                  attempts: num(d.success.attempts, locale),
                  slo: pctL(d.slo, locale, 0),
                })}
                table={
                  <TwinTable
                    caption={t("v7o.gauge.twin")}
                    head={[t("v7o.twin.measure"), t("v7o.twin.count")]}
                    rows={[
                      [t("v7o.totals.attempts"), num(d.totals.attempts, locale)],
                      [t("v7o.totals.delivered"), num(d.totals.delivered, locale)],
                      [t("v7o.totals.failed"), num(d.totals.failed, locale)],
                      [t("v7o.gauge.title"), pctL(d.success.rate, locale)],
                      [t("v7o.out.first"), num(d.outcomes.firstTry, locale)],
                      [t("v7o.out.recovered"), num(d.outcomes.recovered, locale)],
                      [t("v7o.out.failing"), num(d.outcomes.failing, locale)],
                      ...d.failures.map((f) => [td("v7o.reason", f.reason), num(f.count, locale)]),
                    ]}
                  />
                }
              >
                <Gauge success={d.success} slo={d.slo} />
                <ul className="opx-out" aria-label={t("v7o.out.label")}>
                  <li>
                    <Swatch kind="ok" />
                    <span>{t("v7o.out.first")}</span>
                    <b className="mono">{num(d.outcomes.firstTry, locale)}</b>
                  </li>
                  <li>
                    <Swatch kind="retry" />
                    <span>{t("v7o.out.recovered")}</span>
                    <b className="mono">{num(d.outcomes.recovered, locale)}</b>
                  </li>
                  <li>
                    <Swatch kind="fail" />
                    <span>{t("v7o.out.failing")}</span>
                    <b className="mono">{num(d.outcomes.failing, locale)}</b>
                  </li>
                </ul>
              </Panel>
              <div className="opx-fh">
                <h3>{t("v7o.fail.title")}</h3>
                <span className="mute">{t("v7o.fail.count")}</span>
              </div>
              {d.failures.length ? (
                <ul className="opx-fail" data-testid="failures">
                  {d.failures.map((f) => (
                    <li key={f.reason}>
                      <i className={`bar ${REASON_TONE[f.reason]}`} aria-hidden />
                      <span className="why">{td("v7o.reason", f.reason)}</span>
                      <span className="share mono mute">{pctL(f.share, locale, 0)}</span>
                      <b className="mono">{num(f.count, locale)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <StateBox kind="empty" title={t("v7o.fail.none")} hint={t("v7o.fail.none.hint")} />
              )}
            </div>
          </div>

          <div className="icard opx opx-hr" data-testid="health-heatmap">
            <header className="icard-h">
              <span className="icard-ico" aria-hidden>
                <HeartPulse size={20} />
              </span>
              <div className="icard-t">
                <h3>
                  <span className="crumb">{t("v7o.health.crumb")}</span>
                  <span className="slash" aria-hidden>
                    /
                  </span>{" "}
                  {t("v7o.health.card")}
                </h3>
                {d.synthetic ? <SyntheticChip /> : null}
              </div>
              <div className="opx-ctl">
                <Segmented
                  value={win}
                  options={wins}
                  onChange={setWin}
                  label={t("v7o.hwin.label")}
                />
              </div>
            </header>
            <div className="opx-hr-b">
              <Panel
                title={t("v7o.heat.title")}
                meta={<span className="mono">{range}</span>}
                summary={t("v7o.heat.summary", {
                  rows: d.heatmap.rows.length,
                  failing: d.heatmap.rows.reduce(
                    (n, r) => n + r.cells.filter((c) => c.failing).length,
                    0,
                  ),
                })}
                table={<HeatTwin heat={d.heatmap} win={win} />}
              >
                <Heatmap key={win} heat={d.heatmap} win={win} />
                <div className="opx-heat-legend">
                  <span className="scale" aria-hidden>
                    <span>{t("v7o.heat.fewer")}</span>
                    {[4, 8, 12, 17, 22].map((x) => (
                      <i key={x} style={{ height: x }} />
                    ))}
                    <span>{t("v7o.heat.more")}</span>
                  </span>
                  <span className="fh">
                    <Swatch kind="fail" /> {t("v7o.heat.failing")}
                  </span>
                </div>
              </Panel>
              <dl className="opx-totals" data-testid="health-totals">
                <div>
                  <dt>{t("v7o.totals.attempts")}</dt>
                  <dd className="mono">
                    <Swatch kind="none" />
                    {num(d.totals.attempts, locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t("v7o.totals.delivered")}</dt>
                  <dd className="mono">
                    <Swatch kind="ok" />
                    {num(d.totals.delivered, locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t("v7o.totals.failed")}</dt>
                  <dd className="mono">
                    <Swatch kind="fail" />
                    {num(d.totals.failed, locale)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
