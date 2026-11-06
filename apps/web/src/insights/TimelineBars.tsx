import { useMemo } from "react";
import { useDate } from "./hooks";
import { dayNumber, timeDomain } from "./layout";
import { CATEGORY } from "./palette";
import type { TimelineBar } from "./types";

const W = 330;
const BAR = 26;
const GAP = 10;
const LEFT = 6;

/**
 * A Gantt strip: one rounded bar per dated page, label inside, years under it in mono, and a dotted
 * line at today. Bars run from the first edit to the last.
 */
export function TimelineBars({
  bars,
  now,
  title,
  headline,
  label,
}: {
  bars: TimelineBar[];
  now: string;
  title: string;
  headline?: string;
  label: string;
}) {
  const fmt = useDate();
  const dom = useMemo(() => timeDomain(bars, now), [bars, now]);
  const x = (iso: string) =>
    LEFT + ((dayNumber(iso) - dom.from) / Math.max(1, dom.to - dom.from)) * (W - LEFT * 2);
  const years = useMemo(() => {
    const a = new Date(dom.from).getUTCFullYear();
    const b = new Date(dom.to).getUTCFullYear();
    const out: number[] = [];
    const step = b - a > 8 ? 2 : 1;
    for (let y = a + 1; y <= b; y += step) out.push(y);
    return out;
  }, [dom]);
  const h = bars.length * (BAR + GAP) + 26;
  return (
    <div className="tl">
      <div className="tl-h">
        <h4>{title}</h4>
        {headline ? <b className="tl-hl mono">{headline}</b> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} className="tl-svg" role="group" aria-label={label}>
        {years.map((y) => {
          const px = x(`${y}-01-01`);
          return (
            <g key={y}>
              <line x1={px} x2={px} y1={0} y2={h - 22} stroke="#34343c" />
              <text x={px} y={h - 4} textAnchor="middle" className="tl-yr">
                {y}
              </text>
            </g>
          );
        })}
        {bars.map((b, n) => {
          const x1 = x(b.start);
          const need = b.label.length * 7.4 + 22;
          const x2 = Math.max(x1 + need, x(b.end));
          const tone = CATEGORY[[3, 2, 4, 1, 0][n % 5] as number] as (typeof CATEGORY)[number];
          return (
            <g key={`${b.label}${b.start}`}>
              <rect
                x={Math.min(x1, W - need - LEFT)}
                y={n * (BAR + GAP)}
                width={Math.min(W - LEFT, x2 - Math.min(x1, W - need - LEFT))}
                height={BAR}
                rx={7}
                fill={tone.fill}
              >
                <title>{`${b.label}: ${fmt(b.start)} to ${fmt(b.end)}`}</title>
              </rect>
              <text
                x={Math.min(x1, W - need - LEFT) + 10}
                y={n * (BAR + GAP) + 17}
                className="tl-bar"
              >
                {b.label}
              </text>
            </g>
          );
        })}
        <line
          x1={W - LEFT}
          x2={W - LEFT}
          y1={0}
          y2={h - 22}
          stroke="#d8d6e2"
          strokeDasharray="2 3"
        />
      </svg>
    </div>
  );
}
