import { useMemo } from "react";
import { useI18n } from "../i18n";
import { layoutActivity } from "./layout";
import { CARD } from "./palette";
import type { ActivityData } from "./types";

const PITCH = 14.4;
const TOP = 6;

/** Edits per day over six months: weeks across, weekdays down, a dot sized by the number of edits. */
export function ActivityGrid({
  data,
  title,
  sub,
  label,
}: {
  data: ActivityData;
  title: string;
  sub: string;
  label: string;
}) {
  const { locale } = useI18n();
  const lay = useMemo(() => layoutActivity(data.days, data.from, data.to), [data]);
  const w = Math.max(1, lay.cols) * PITCH;
  const h = TOP + 7 * PITCH + 20;
  const month = (m: number) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      Date.UTC(2026, m, 1),
    );
  return (
    <div className="act">
      <div className="act-h">
        <h4>{title}</h4>
        <span>{sub}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="act-svg" role="group" aria-label={label}>
        {lay.cells.map((c) => {
          const f = c.count / lay.max;
          return (
            <circle
              key={c.date}
              cx={c.col * PITCH + PITCH / 2}
              cy={TOP + c.row * PITCH + PITCH / 2}
              r={c.count ? 2.1 + f * 2.6 : 1.5}
              fill={c.count ? CARD.inZone : "#44444d"}
              opacity={c.count ? 0.5 + f * 0.5 : 0.7}
            />
          );
        })}
        {lay.months.map((m) => (
          <text
            key={`${m.col}-${m.month}`}
            x={m.col * PITCH}
            y={h - 4}
            className="act-mo"
            textAnchor={m.col * PITCH > w - 34 ? "end" : "start"}
          >
            {month(m.month)}
          </text>
        ))}
      </svg>
    </div>
  );
}
