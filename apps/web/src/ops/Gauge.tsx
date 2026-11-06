import { useI18n } from "../i18n";
import { num, pctL } from "./format";
import type { HealthResponse } from "./types";

const N = 100;
const CX = 150;
const CY = 150;
const R1 = 128;
const R2 = 106;

/**
 * A half-circle of 100 ticks, one per percent. Blue ticks are delivered, magenta ticks are failed, and a
 * dotted longer tick marks the SLO. The big number and the counts sit in the middle as text.
 */
export function Gauge({ success, slo }: { success: HealthResponse["success"]; slo: number }) {
  const { t, locale } = useI18n();
  const failTicks = success.failed > 0 ? Math.max(1, Math.round((1 - success.rate) * N)) : 0;
  const okTicks = N - failTicks;
  const at = (i: number, r: number) => {
    const a = Math.PI - (i / (N - 1)) * Math.PI;
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
  };
  const sloIdx = Math.round(slo * (N - 1));
  const [sx1, sy1] = at(sloIdx, R1 + 10);
  const [sx2, sy2] = at(sloIdx, R2 - 4);
  const label = t("v7o.gauge.aria", {
    rate: pctL(success.rate, locale),
    failed: num(success.failed, locale),
    attempts: num(success.attempts, locale),
    slo: pctL(slo, locale, 0),
  });
  return (
    <div className="opx-gauge">
      <svg viewBox="0 0 300 176" role="img" aria-label={label}>
        {Array.from({ length: N }, (_, i) => {
          const [x1, y1] = at(i, R1);
          const [x2, y2] = at(i, R2);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={i < okTicks ? "g-ok" : "g-fail"}
            />
          );
        })}
        <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} className="g-slo" />
        <text x={20} y={170} className="rc-lbl">
          0
        </text>
        <text x={282} y={170} textAnchor="end" className="rc-lbl">
          {t("v7o.gauge.slo", { slo: pctL(slo, locale, 0) })}
        </text>
      </svg>
      <div className="opx-gauge-c">
        <b className="mono" data-testid="gauge-rate">
          {pctL(success.rate, locale)}
        </b>
        <span className="mono" data-testid="gauge-failed">
          {t("v7o.gauge.failed", {
            failed: num(success.failed, locale),
            attempts: num(success.attempts, locale),
          })}
        </span>
      </div>
    </div>
  );
}
