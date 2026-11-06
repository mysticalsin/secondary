import { useMemo } from "react";
import { useI18n } from "../i18n";
import { TwinTable } from "../insights/InsightCard";
import { fmtMs, logPos, pctL } from "./format";
import type { CallOutcome, SourceStats } from "./types";
import { Panel, Swatch } from "./ui";

const W = 560;
const H = 190;
const PAD = 14;
const AXIS = 22;
const R = 2.7;
export const LO = 30;

export interface Dot {
  i: number;
  x: number;
  y: number;
}

/** Stack points on a log axis into a beeswarm: each goes to the free spot nearest the middle line. */
export function swarm(points: { ms: number }[], hi: number): Dot[] {
  const mid = (H - AXIS) / 2;
  const x = (ms: number) => PAD + logPos(ms, LO, hi) * (W - 2 * PAD);
  const order = points.map((p, i) => ({ i, x: x(p.ms) })).sort((a, b) => a.x - b.x);
  const placed: Dot[] = [];
  const dy = R * 1.9;
  const maxK = Math.floor((mid - R - 2) / dy);
  for (const p of order) {
    let best: Dot | null = null;
    for (let k = 0; k <= maxK * 2 && !best; k++) {
      const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * dy;
      const y = mid + off;
      let clash = false;
      for (let j = placed.length - 1; j >= 0; j--) {
        const q = placed[j] as Dot;
        if (p.x - q.x > R * 2) break;
        if ((p.x - q.x) ** 2 + (y - q.y) ** 2 < (R * 2 - 0.3) ** 2) {
          clash = true;
          break;
        }
      }
      if (!clash) best = { i: p.i, x: p.x, y };
    }
    placed.push(best ?? { i: p.i, x: p.x, y: mid });
  }
  return placed;
}

const CLS: Record<CallOutcome, string> = { ok: "ok", timeout: "to", "429": "lim", error: "err" };

/**
 * Graph call latency of the last calls as a swarm on a log axis: p50 line, the timeout line, the timed
 * out share, and a "Raise timeout?" hint that applies the suggested value when clicked.
 */
export function LatencySwarm({
  latency,
  timeoutSeconds,
  onRaise,
}: {
  latency: SourceStats["latency"];
  timeoutSeconds: number;
  onRaise: (seconds: number) => void;
}) {
  const { t, td, locale } = useI18n();
  const hi = Math.max(10_000, timeoutSeconds * 1000 * 1.06);
  const dots = useMemo(() => swarm(latency.points, hi), [latency.points, hi]);
  const x = (ms: number) => PAD + logPos(ms, LO, hi) * (W - 2 * PAD);
  const tx = x(timeoutSeconds * 1000);
  const counts = useMemo(() => {
    const c: Record<CallOutcome, number> = { ok: 0, timeout: 0, "429": 0, error: 0 };
    for (const p of latency.points) c[p.outcome]++;
    return c;
  }, [latency.points]);
  const share = pctL(latency.timedOutShare, locale);
  const tip = t("v7o.lat.timedout", { n: latency.timedOut, share });
  const summary = t("v7o.lat.summary", {
    n: latency.n,
    p50: fmtMs(latency.p50Ms),
    p95: fmtMs(latency.p95Ms),
    timeout: timeoutSeconds,
    share,
  });
  const ticks: [number, string][] = [
    [100, "100 ms"],
    [1000, "1 s"],
    [10_000, "10 s"],
  ];
  return (
    <Panel
      title={t("v7o.lat.title")}
      meta={<span className="mono">{t("v7o.lat.meta", { n: latency.n, s: timeoutSeconds })}</span>}
      summary={summary}
      testId="latency-swarm"
      table={
        <TwinTable
          caption={t("v7o.lat.twin")}
          head={[t("v7o.lat.col.outcome"), t("v7o.lat.col.n"), t("v7o.lat.col.share")]}
          rows={(["ok", "timeout", "429", "error"] as CallOutcome[]).map((o) => [
            td("v7o.lat.outcome", o),
            counts[o],
            pctL(latency.n ? counts[o] / latency.n : 0, locale),
          ])}
        />
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="opx-ls-svg">
        {ticks.map(([ms]) => (
          <line key={ms} x1={x(ms)} x2={x(ms)} y1={0} y2={H - AXIS} className="rc-grid" />
        ))}
        <line x1={tx} x2={tx} y1={0} y2={H - AXIS} className="ls-timeout" />
        <line x1={x(latency.p50Ms)} x2={x(latency.p50Ms)} y1={0} y2={H - AXIS} className="ls-p50" />
        <g aria-hidden>
          {dots.map((d) => {
            const p = latency.points[d.i] as { outcome: CallOutcome };
            return <circle key={d.i} cx={d.x} cy={d.y} r={R} className={`ls-${CLS[p.outcome]}`} />;
          })}
        </g>
        {ticks.map(([ms, label]) => (
          <text key={ms} x={x(ms)} y={H - 5} textAnchor="middle" className="rc-lbl">
            {label}
          </text>
        ))}
        {latency.timedOut > 0 ? (
          <g transform={`translate(${Math.max(4, tx - 132)},6)`} pointerEvents="none">
            <rect width={118} height={46} rx={9} className="rc-tip" />
            <text x={12} y={19} className="rc-tipt sub">
              {t("v7o.lat.timedout.l")}
            </text>
            <text x={12} y={37} className="rc-tipt">
              {latency.timedOut} · {share}
            </text>
          </g>
        ) : null}
      </svg>
      <p className="sr-only">{tip}</p>
      <div className="opx-ls-foot">
        <span className="mono p50">{t("v7o.lat.p50", { v: fmtMs(latency.p50Ms) })}</span>
        <span className="mono">{t("v7o.lat.p95", { v: fmtMs(latency.p95Ms) })}</span>
        {latency.hint.raiseTimeout && latency.hint.suggestedSeconds !== null ? (
          <button
            type="button"
            className="opx-raise"
            onClick={() => onRaise(latency.hint.suggestedSeconds as number)}
            title={t("v7o.lat.raise.title", { s: latency.hint.suggestedSeconds })}
          >
            {t("v7o.lat.raise")}
          </button>
        ) : null}
      </div>
      <ul className="opx-legend small" aria-label={t("v7o.legend")}>
        <li>
          <Swatch kind="ok" /> {td("v7o.lat.outcome", "ok")}
        </li>
        <li>
          <Swatch kind="fail" /> {td("v7o.lat.outcome", "timeout")}
        </li>
        <li>
          <Swatch kind="warn" /> {td("v7o.lat.outcome", "429")}
        </li>
        <li>
          <Swatch kind="none" /> {td("v7o.lat.outcome", "error")}
        </li>
      </ul>
    </Panel>
  );
}
