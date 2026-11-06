import { ChartNoAxesColumn, Table2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { fmtMs, isFailing, logPos } from "./format";
import type { Attempt, OpsStatus } from "./types";

/** A value that follows `value` after `ms` of quiet. */
export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** The status chip. The word is always there; retrying also gets a dashed outline. */
export function StatusChip({ status }: { status: OpsStatus }) {
  const { td } = useI18n();
  return (
    <span className={`opx-chip s-${status}`} data-status={status}>
      <i aria-hidden />
      {td("v7o.status", status)}
    </span>
  );
}

/** Eight slots: failed (magenta), ok (blue), scheduled (dashed). Spare slots are small grey dots. */
export function AttemptDots({
  attempts,
}: {
  attempts: { count: number; max: number; outcomes: Attempt[] };
}) {
  const { t } = useI18n();
  const slots = Math.max(attempts.max, attempts.outcomes.length);
  const fail = attempts.outcomes.filter((o) => o === "fail").length;
  const ok = attempts.outcomes.filter((o) => o === "ok").length;
  const sched = attempts.outcomes.filter((o) => o === "scheduled").length;
  return (
    <span
      className="opx-dots"
      role="img"
      aria-label={t("v7o.attempts.aria", { fail, ok, sched, max: attempts.max })}
    >
      {Array.from({ length: Math.min(slots, 10) }, (_, i) => {
        const o = attempts.outcomes[i];
        return <i key={`${i}-${o ?? "x"}`} className={o ? `a-${o}` : "a-none"} aria-hidden />;
      })}
    </span>
  );
}

/** A latency bar on the log scale 30 ms to 15 s, then the value in mono. */
export function LatencyBar({ ms, status }: { ms: number | null; status: OpsStatus }) {
  if (ms === null)
    return (
      <span className="opx-lat">
        <span className="opx-lat-v mute">-</span>
      </span>
    );
  const w = Math.max(6, Math.round(logPos(ms, 30, 15_000) * 100));
  const tone = isFailing(status) ? "fail" : status === "needs_review" ? "warn" : "ok";
  return (
    <span className="opx-lat">
      <span className="opx-lat-bar" aria-hidden>
        <i className={`t-${tone}`} style={{ width: `${w}%` }} />
      </span>
      <span className="opx-lat-v">{fmtMs(ms)}</span>
    </span>
  );
}

export function SyntheticChip() {
  const { t } = useI18n();
  return (
    <span className="opx-syn" title={t("v7o.synthetic.title")}>
      {t("v7o.synthetic")}
    </span>
  );
}

/** Loading, empty and error states. They say what to do next, not how anyone feels. */
export function StateBox({
  kind,
  title,
  hint,
  action,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`opx-state ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "loading" ? (
        <div className="opx-skel" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      ) : null}
      <b>{title}</b>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

/** Marks one segment of a legend. */
export function Swatch({
  kind,
}: {
  kind: "ok" | "fail" | "warn" | "retry" | "brand" | "timeout" | "none";
}) {
  return <i className={`opx-sw ${kind}`} aria-hidden />;
}

/**
 * A titled block inside a dark card: title, a meta line on the right, an optional table twin toggle.
 * The summary is always in the page for assistive technology and is the first line of the twin.
 */
export function Panel({
  title,
  meta,
  summary,
  table,
  children,
  className = "",
  testId,
}: {
  title: string;
  meta?: ReactNode;
  summary: string;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const uid = useUid();
  const [asTable, setAsTable] = useState(false);
  return (
    <div
      className={`opx-panel ${className}`}
      role="group"
      aria-labelledby={`${uid}-h`}
      aria-describedby={`${uid}-s`}
      data-testid={testId}
    >
      <div className="opx-ph">
        <h3 id={`${uid}-h`}>{title}</h3>
        {meta ? <span className="opx-meta">{meta}</span> : null}
        {table ? (
          <button
            type="button"
            className="icard-tw"
            aria-pressed={asTable}
            aria-label={asTable ? t("v5.chart.show") : t("v5.table.show")}
            title={asTable ? t("v5.chart.show") : t("v5.table.show")}
            onClick={() => setAsTable((x) => !x)}
          >
            {asTable ? (
              <ChartNoAxesColumn size={16} aria-hidden />
            ) : (
              <Table2 size={16} aria-hidden />
            )}
          </button>
        ) : null}
      </div>
      <p id={`${uid}-s`} className={asTable ? "icard-sum" : "sr-only"}>
        {summary}
      </p>
      <div className="opx-pb">{asTable && table ? table : children}</div>
    </div>
  );
}
