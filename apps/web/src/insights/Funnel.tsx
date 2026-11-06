import { useMemo } from "react";
import { useI18n } from "../i18n";
import { layoutFunnel } from "./layout";
import { STAGE_FILL } from "./palette";
import type { Flow } from "./types";

const W = 560;
const BAR = 46;
const GAP = 38;

/**
 * Stages from top to bottom, each a rounded bar whose width follows its count, joined by a smooth
 * neck in the colour of the stage above. The first two carry their label inside, the rest beside.
 */
export function Funnel({ stages, label }: { stages: Flow["stages"]; label: string }) {
  const { t } = useI18n();
  const bars = useMemo(
    () => layoutFunnel(stages, { w: W, bar: BAR, gap: GAP, min: 0.16 }),
    [stages],
  );
  const h = bars.length * (BAR + GAP) - GAP;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="fn-svg" role="group" aria-label={label}>
      <defs>
        {bars.slice(0, -1).map((b, n) => (
          <linearGradient key={b.key} id={`fn-g${n}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={STAGE_FILL[n % STAGE_FILL.length]} stopOpacity="0.55" />
            <stop
              offset="1"
              stopColor={STAGE_FILL[(n + 1) % STAGE_FILL.length]}
              stopOpacity="0.2"
            />
          </linearGradient>
        ))}
      </defs>
      {bars.slice(0, -1).map((b, n) => {
        const nx = bars[n + 1] as (typeof bars)[0];
        const y1 = b.y + b.h;
        const y2 = nx.y;
        const m = (y1 + y2) / 2;
        const d = `M${b.x + 8} ${y1} C${b.x + 8} ${m} ${nx.x} ${m} ${nx.x} ${y2} L${nx.x + nx.w} ${y2} C${nx.x + nx.w} ${m} ${b.x + b.w - 8} ${m} ${b.x + b.w - 8} ${y1} Z`;
        return <path key={`c${b.key}`} d={d} fill={`url(#fn-g${n})`} />;
      })}
      {bars.map((b, n) => {
        const name = t(`v5.stage.${b.key}` as "v5.stage.ingested");
        const inside = n < 2 || b.x + b.w + 14 + (name.length + 5) * 8.5 > W;
        return (
          <g key={b.key}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={9}
              fill={STAGE_FILL[n % STAGE_FILL.length]}
            />
            {inside ? (
              <text x={W / 2} y={b.y + b.h / 2 + 5} textAnchor="middle" className="fn-t">
                {name} <tspan className="fn-n">{b.count.toLocaleString()}</tspan>
              </text>
            ) : (
              <text x={b.x + b.w + 14} y={b.y + b.h / 2 + 5} className="fn-t">
                <tspan className="fn-n">{b.count.toLocaleString()}</tspan> {name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
