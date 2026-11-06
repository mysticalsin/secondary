import { useI18n } from "../../i18n";
import type { Gap } from "./types";

const STEP = 16;
const H = 22;

/** Fourteen days of asks as dots, today rightmost. The size says how many; the label says all of them. */
export function GapDots({ days, small = false }: { days: Gap["days"]; small?: boolean }) {
  const { t } = useI18n();
  const counts = days.map((d) => d.count).join(", ");
  const max = Math.max(1, ...days.map((d) => d.count));
  const w = days.length * STEP;
  return (
    <svg
      className={`gp-dots${small ? " sm" : ""}`}
      viewBox={`0 0 ${w} ${H}`}
      width={w}
      height={H}
      role="img"
      aria-label={t("v8g.dots", { counts })}
    >
      {days.map((d, i) => {
        const r = d.count === 0 ? 1.8 : 3 + (d.count / max) * 5.5;
        return (
          <circle
            key={d.date}
            cx={i * STEP + STEP / 2}
            cy={H / 2}
            r={r}
            className={
              d.count === 0 ? "gp-dot nil" : i === days.length - 1 ? "gp-dot now" : "gp-dot"
            }
          />
        );
      })}
    </svg>
  );
}
