import { useI18n } from "../i18n";
import { TwinTable } from "../insights/InsightCard";
import { fmtWait } from "./format";
import type { PlanStep } from "./retry";
import { Panel } from "./ui";

const W = 560;
const PADL = 28;
const PADR = 34;
const TOP = 26;
const STEP = 36;
const TICKS = [5, 60, 600, 3600, 21_600, 86_400];

export type NextTry = { try: number; inSeconds: number; last: string } | null;

/**
 * The planned retries as a step chart: tries go down, time goes right on a log scale. Past tries are
 * filled, the next one is ringed with its tooltip, later ones are hollow, the last one is magenta.
 */
export function RetryChart({
  plan,
  next,
  none,
}: {
  plan: PlanStep[];
  next: NextTry;
  none: boolean;
}) {
  const { t } = useI18n();
  const maxAt = plan.length ? (plan[plan.length - 1] as PlanStep).atSeconds : 1;
  const x = (at: number) => PADL + (Math.log1p(at) / Math.log1p(maxAt)) * (W - PADL - PADR);
  const pts = [
    { n: 1, at: 0, wait: 0 },
    ...plan.map((p) => ({ n: p.try, at: p.atSeconds, wait: p.afterSeconds })),
  ].map((p, i) => ({ ...p, px: x(p.at), py: TOP + i * STEP }));
  const first = pts[0] as (typeof pts)[number];
  const lastPt = pts[pts.length - 1] as (typeof pts)[number];
  const H = lastPt.py + 44;
  let d = `M${first.px},${first.py}`;
  for (const p of pts.slice(1)) d += ` H${p.px} V${p.py}`;
  const area = `${d} V${lastPt.py + 26} H${first.px} Z`;
  const tries = plan.length + 1;
  const total = plan.length ? maxAt : 0;
  const active = next ? pts.find((p) => p.n === next.try) : undefined;
  const tipW = 156;
  const tipX = active ? Math.max(4, Math.min(W - tipW - 4, active.px + 4)) : 0;
  const summary = none
    ? t("v7o.retry.summary.none")
    : t("v7o.retry.summary", {
        tries,
        total: fmtWait(total),
        waits: plan.map((p) => fmtWait(p.afterSeconds)).join(", "),
      });
  return (
    <Panel
      title={t("v7o.retry.title")}
      meta={<span className="mono">{t("v7o.retry.meta", { tries, total: fmtWait(total) })}</span>}
      summary={summary}
      testId="retry-chart"
      table={
        <TwinTable
          caption={t("v7o.retry.twin")}
          head={[t("v7o.retry.col.try"), t("v7o.retry.col.wait"), t("v7o.retry.col.at")]}
          rows={[
            [1, t("v7o.retry.now"), fmtWait(0)],
            ...plan.map((p) => [p.try, fmtWait(p.afterSeconds), fmtWait(p.atSeconds)]),
          ]}
        />
      }
    >
      <div className="opx-rc">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="opx-rc-svg">
          {TICKS.filter((s) => s < maxAt).map((s) => (
            <line key={s} x1={x(s)} x2={x(s)} y1={0} y2={H - 30} className="rc-grid" />
          ))}
          {plan.length ? <path d={area} className="rc-area" /> : null}
          <path d={d} className="rc-line" fill="none" />
          {pts.map((p, i) => {
            const isLast = i === pts.length - 1 && plan.length > 0;
            const done = next ? p.n < next.try : i === 0;
            const isNext = !!next && p.n === next.try;
            return (
              <g key={p.n}>
                {isNext ? <circle cx={p.px} cy={p.py} r={10} className="rc-ring" /> : null}
                {isLast ? (
                  <g className="rc-end">
                    <circle cx={p.px} cy={p.py} r={6} />
                    <path d={`M${p.px - 2.6},${p.py - 2.6} l5.2,5.2 m0,-5.2 l-5.2,5.2`} />
                  </g>
                ) : (
                  <circle
                    cx={p.px}
                    cy={p.py}
                    r={5}
                    className={done || isNext ? "rc-pt on" : "rc-pt"}
                  />
                )}
                <text
                  x={isLast ? p.px - 2 : p.px + 8}
                  y={p.py + 19}
                  textAnchor={isLast ? "end" : "start"}
                  className={isLast ? "rc-lbl end" : "rc-lbl"}
                >
                  {i === 0 ? t("v7o.retry.now") : fmtWait(p.wait)}
                </text>
              </g>
            );
          })}
          {active && next ? (
            <g transform={`translate(${tipX},${Math.max(2, active.py - 62)})`} pointerEvents="none">
              <rect width={tipW} height={46} rx={9} className="rc-tip" />
              <text x={12} y={19} className="rc-tipt">
                {t("v7o.retry.tip.try", { n: next.try, s: fmtWait(next.inSeconds) })}
              </text>
              <text x={12} y={37} className="rc-tipt sub">
                {t("v7o.retry.tip.last", { last: next.last })}
              </text>
            </g>
          ) : null}
        </svg>
        {none ? <p className="opx-none">{t("v7o.retry.none")}</p> : null}
        {next ? (
          <p className="opx-next mono">
            {t("v7o.retry.next", { s: fmtWait(next.inSeconds), last: next.last })}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
