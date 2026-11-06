import { useI18n } from "../i18n";
import { useNumber } from "./hooks";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** One bar cut into rounded segments with a 2 px gap, and a legend with the share of each. */
export function SegmentBar({
  segments,
  title,
  total,
}: {
  segments: Segment[];
  title: string;
  total: number;
}) {
  const { t } = useI18n();
  const num = useNumber();
  const sum = segments.reduce((n, s) => n + s.value, 0) || 1;
  return (
    <div className="segbar">
      <div className="segbar-h">
        <span>{title}</span>
        <span className="mono">{t("v5.health.sources.n", { n: num(total) })}</span>
      </div>
      <div className="segbar-track" aria-hidden>
        {segments.map((s) => (
          <i
            key={s.key}
            style={{ flexGrow: s.value, background: s.color }}
            title={`${s.label} ${Math.round((s.value / sum) * 100)}%`}
          />
        ))}
      </div>
      <ul className="segbar-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} aria-hidden />
            <span>{s.label}</span>
            <b className="mono">{Math.round((s.value / sum) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
