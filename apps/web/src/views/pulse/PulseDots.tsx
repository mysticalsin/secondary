import { useI18n } from "../../i18n";
import { PULSE_COLOR } from "./colors";
import { CATEGORIES, type Category } from "./types";

/** Dots for one day: one per category that had activity, in the fixed category order. The count is written beside it. */
export function DayDots({ counts, label }: { counts: Record<Category, number>; label?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="pd8">
      {CATEGORIES.filter((c) => counts[c] > 0).map((c) => (
        <span key={c} className="pd8-i">
          <svg viewBox="0 0 12 12" className="pd8-dot" aria-hidden>
            <circle
              cx="6"
              cy="6"
              r={Math.min(5.5, 3 + Math.sqrt(counts[c]))}
              fill={PULSE_COLOR[c]}
            />
          </svg>
          <span className="pd8-n">{counts[c]}</span>
          {label ? <span className="pd8-l">{t(`v8p.cat.${c}` as "v8p.cat.published")}</span> : null}
        </span>
      ))}
    </span>
  );
}

export function PulseLegend() {
  const { t } = useI18n();
  return (
    <ul className="pl8k" aria-label={t("v8p.legend")}>
      {CATEGORIES.map((c) => (
        <li key={c}>
          <svg viewBox="0 0 12 12" className="pd8-dot" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill={PULSE_COLOR[c]} />
          </svg>
          {t(`v8p.cat.${c}` as "v8p.cat.published")}
        </li>
      ))}
    </ul>
  );
}
