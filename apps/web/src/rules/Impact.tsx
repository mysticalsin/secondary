import { ChevronDown, Info } from "lucide-react";
import { useId, useState } from "react";
import { type Key, useI18n } from "../i18n";
import { effectKind, useRuleText } from "./text";
import type { SimulationView } from "./types";

export type SimState =
  | { state: "idle" }
  | { state: "loading"; last: SimulationView | null }
  | { state: "error"; last: SimulationView | null }
  | { state: "ok"; data: SimulationView };

/** The three outcomes and the v5 data colours that carry them. Colour is never the only cue. */
const PARTS = [
  { key: "approval", color: "#f59e0b", label: "v7.imp.approval", row: "v7.imp.row.approval" },
  { key: "blocked", color: "#ec4899", label: "v7.imp.blocked", row: "v7.imp.row.blocked" },
  { key: "allowed", color: "#38bdf8", label: "v7.imp.allowed", row: "v7.imp.row.allowed" },
] as const satisfies readonly {
  key: keyof SimulationView["split"];
  color: string;
  label: Key;
  row: Key;
}[];

export function Impact({
  sim,
  days,
  stale,
  onDays,
}: {
  sim: SimState;
  days: 7 | 30;
  stale: boolean;
  onDays: (d: 7 | 30) => void;
}) {
  const { t, tn } = useI18n();
  const text = useRuleText();
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const winId = useId();
  const data = sim.state === "ok" ? sim.data : sim.state === "idle" ? null : sim.last;
  const busy = sim.state === "loading";
  const total = data ? data.split.approval + data.split.blocked + data.split.allowed : 0;

  return (
    <aside className="rl-impact" aria-label={t("v7.imp.title")} aria-busy={busy}>
      <div className="rl-imp-head">
        <h3 className="rl-cap">{t("v7.imp.title")}</h3>
        <div className="rl-selwrap sm">
          <label className="sr-only" htmlFor={winId}>
            {t("v7.imp.window")}
          </label>
          <select
            id={winId}
            className="rl-select"
            value={days}
            onChange={(e) => onDays(e.target.value === "30" ? 30 : 7)}
          >
            <option value="7">{t("v7.imp.7")}</option>
            <option value="30">{t("v7.imp.30")}</option>
          </select>
          <ChevronDown size={14} className="rl-chev" aria-hidden />
        </div>
      </div>

      {sim.state === "error" ? (
        <p className="rl-imp-note" role="status">
          {t("v7.imp.error")}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="rl-imp-big" data-testid="impact-number">
            <span className="rl-num">{data.matches}</span>
            <span className="rl-capt">
              {tn(data.matches, "v7.imp.match.one", "v7.imp.match.other")}
            </span>
          </div>
          <p className="sr-only" role="status" data-testid="impact-summary">
            {t("v7.imp.summary", {
              n: data.matches,
              total: data.total,
              a: data.split.approval,
              b: data.split.blocked,
              c: data.split.allowed,
            })}
          </p>
          <p className="rl-of">{t("v7.imp.of", { total: data.total })}</p>

          {asTable ? (
            <table className="rl-twin" id={tableId} data-testid="impact-table">
              <caption className="sr-only">{t("v7.imp.bar")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("v7.imp.col.effect")}</th>
                  <th scope="col" className="num">
                    {t("v7.imp.col.count")}
                  </th>
                  <th scope="col" className="num">
                    {t("v7.imp.col.share")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map((p) => (
                  <tr key={p.key}>
                    <th scope="row">
                      <i className="rl-sw" style={{ background: p.color }} aria-hidden />
                      {t(p.row)}
                    </th>
                    <td className="num">{data.split[p.key]}</td>
                    <td className="num">
                      {total ? Math.round((data.split[p.key] / total) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <div
                className="rl-bar"
                role="img"
                aria-label={`${t("v7.imp.bar")}: ${PARTS.map((p) => t(p.label, { n: data.split[p.key] })).join(", ")}`}
                data-testid="impact-bar"
              >
                {PARTS.filter((p) => data.split[p.key] > 0).map((p) => (
                  <span
                    key={p.key}
                    className="rl-bseg"
                    style={{ flexGrow: data.split[p.key], background: p.color }}
                  />
                ))}
                {total === 0 ? <span className="rl-bseg none" /> : null}
              </div>
              <ul className="rl-legend">
                {PARTS.filter((p) => data.split[p.key] > 0).map((p) => (
                  <li key={p.key} className="rl-leg">
                    <i className="rl-sw" style={{ background: p.color }} aria-hidden />
                    {t(p.label, { n: data.split[p.key] })}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="rl-link"
            aria-expanded={asTable}
            aria-controls={asTable ? tableId : undefined}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? t("v7.imp.chart") : t("v7.imp.table")}
          </button>

          <h3 className="rl-cap rl-cap2">{t("v7.imp.samples")}</h3>
          {data.samples.length ? (
            <ul className="rl-samples" data-testid="impact-samples">
              {data.samples.map((s) => (
                <li
                  className="rl-sample"
                  key={`${s.at}-${s.action}-${s.brain.id}-${s.actor.host ?? s.actor.kind}`}
                >
                  <div className="rl-s1">
                    <span className="rl-actor">{text.actorLabel(s.actor)}</span>
                    <span className={`rl-echip k-${effectKind(s.effect)}`}>
                      {text.chipLabel(s.effect)}
                    </span>
                  </div>
                  <div className="rl-s2">
                    <span className="mono">{s.action}</span>
                    {" · "}
                    {s.brain.id === "restricted" || !s.brain.label
                      ? t("v7.actor.restricted")
                      : s.brain.label}
                    {" · "}
                    {text.ago(s.at)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rl-imp-note">{t("v7.imp.samples.none")}</p>
          )}

          <div className="rl-callout">
            <Info size={16} aria-hidden />
            <p className="rl-callout-p">
              {data.split.approval > 0
                ? Math.round(data.approvalsPerDay) > 1
                  ? t("v7.imp.wait", {
                      min: data.addedWaitMin,
                      n: Math.round(data.approvalsPerDay),
                    })
                  : t("v7.imp.wait.one", { min: data.addedWaitMin })
                : t("v7.imp.nowait")}
            </p>
          </div>
          <p className="rl-fine">{t("v7.imp.estimate")}</p>
          {stale ? (
            <p className="rl-fine stale" role="status">
              {t("v7.imp.stale")}
            </p>
          ) : null}
        </>
      ) : sim.state === "loading" ? (
        <div className="rl-skel" aria-hidden />
      ) : null}
    </aside>
  );
}
