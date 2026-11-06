import { type PointerEvent, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { buildGrid, layoutBeeswarm, nearest } from "./layout";
import { CARD } from "./palette";
import type { HealthPoint, ScoreKind } from "./types";

const W = 620;
const H = 270;
const AXIS = 24;

/**
 * Pages on a score axis, stacked in columns. Purple dots score at or above the threshold, grey ones
 * are due for review. The highest-scoring page is pinned with its name; hovering a dot names it.
 */
export function Beeswarm({
  points,
  scoreKind,
  threshold,
  label,
}: {
  points: HealthPoint[];
  scoreKind: ScoreKind;
  threshold: number;
  label: string;
}) {
  const { t } = useI18n();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState(-1);
  const scores = useMemo(() => points.map((p) => p.score), [points]);
  const swarm = useMemo(() => layoutBeeswarm(scores, { w: W, h: H - AXIS, pad: 10 }), [scores]);
  const grid = useMemo(() => buildGrid(swarm.dots, 14, W), [swarm]);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let v = swarm.lo; v <= 100; v += 10) out.push(v);
    return out;
  }, [swarm.lo]);
  const best = useMemo(() => {
    let b = -1;
    points.forEach((p, i) => {
      if (p.pageId && p.title && (b < 0 || p.score > (points[b]?.score ?? -1))) b = i;
    });
    return b;
  }, [points]);
  const tx = swarm.x(threshold);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box?.width) return;
    const k = W / box.width;
    const i = nearest(
      grid,
      swarm.dots,
      (e.clientX - box.left) * k,
      (e.clientY - box.top) * k,
      swarm.pitch,
    );
    setHover((h) => (h === i ? h : i));
  };
  const pinned = hover >= 0 ? hover : best;
  const pp = pinned >= 0 ? points[pinned] : undefined;
  const pd = pinned >= 0 ? swarm.dots[pinned] : undefined;
  const tip =
    pp &&
    (pp.k > 1
      ? t("v5.health.tip.bucket", { k: pp.k, score: pp.score })
      : `${pp.title ?? ""} ${pp.score}%`);
  const tipW = tip ? Math.min(300, 20 + tip.length * 7) : 0;

  return (
    <div className="bs">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="bs-svg"
        role="group"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(-1)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={swarm.x(v)}
              x2={swarm.x(v)}
              y1={0}
              y2={H - AXIS}
              stroke={CARD.grid}
              opacity={0.55}
            />
            <text
              x={swarm.x(v)}
              y={H - 6}
              textAnchor={v === 100 ? "end" : "middle"}
              className="bs-tick"
            >
              {v}%
            </text>
          </g>
        ))}
        <line
          x1={tx}
          x2={tx}
          y1={0}
          y2={H - AXIS}
          stroke={CARD.inZone}
          strokeWidth={1.4}
          strokeDasharray="4 4"
        />
        <g aria-hidden>
          {swarm.dots.map((d) => {
            const hit = (points[d.i] as HealthPoint).score >= threshold;
            return (
              <circle
                key={d.i}
                cx={d.x}
                cy={d.y}
                r={swarm.r}
                fill={hit ? CARD.inZone : CARD.below}
                opacity={hit ? 1 : 0.8}
              />
            );
          })}
        </g>
        {pd && pp && tip ? (
          <g pointerEvents="none" aria-hidden>
            <circle
              cx={pd.x}
              cy={pd.y}
              r={swarm.r + 4}
              fill="none"
              stroke="#fff"
              strokeWidth={1.6}
            />
            <circle cx={pd.x} cy={pd.y} r={1.6} fill="#fff" />
            <g
              transform={`translate(${Math.max(4, Math.min(W - tipW - 4, pd.x - tipW / 2))},${Math.max(2, pd.y - 40)})`}
            >
              <rect width={tipW} height={26} rx={8} fill="#2b2b32" stroke="#44444d" />
              <text x={tipW / 2} y={17} textAnchor="middle" className="dc-pilltext">
                {tip}
              </text>
            </g>
          </g>
        ) : null}
      </svg>
      <p className="bs-thr mono">{t("v5.health.threshold", { t: threshold })}</p>
      <span className="sr-only">{scoreKind}</span>
    </div>
  );
}
