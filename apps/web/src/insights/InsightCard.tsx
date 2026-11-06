import { ChartNoAxesColumn, Table2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useI18n } from "../i18n";
import { useUid } from "./hooks";

/**
 * A dark instrument card: icon tile, title and subtitle, a right-hand control, the chart, and a
 * table twin. The text summary is always in the page for assistive technology and is the first
 * thing the table twin shows.
 */
export function InsightCard({
  icon,
  title,
  subtitle,
  control,
  summary,
  table,
  children,
  footer,
  className = "",
  testId,
  round = false,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  control?: ReactNode;
  /** One or two sentences that say what the chart says. */
  summary: string;
  /** The same data as a table. Without it the card has no toggle. */
  table?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
  /** The icon is a round avatar, as in the focus card. */
  round?: boolean;
}) {
  const { t } = useI18n();
  const uid = useUid();
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      className={`icard ${className}`}
      aria-labelledby={`${uid}-h`}
      aria-describedby={`${uid}-s`}
      data-testid={testId}
    >
      <header className="icard-h">
        <span className={`icard-ico${round ? " round" : ""}`} aria-hidden>
          {icon}
        </span>
        <div className="icard-t">
          <h3 id={`${uid}-h`}>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="icard-r">
          {control}
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
      </header>
      <p id={`${uid}-s`} className={asTable ? "icard-sum" : "sr-only"}>
        {summary}
      </p>
      <div className="icard-b">{asTable && table ? table : children}</div>
      {footer}
    </section>
  );
}

/** A plain table for a twin. Scrolls sideways inside the card at narrow widths, focusable for the keyboard. */
export function TwinTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs a keyboard stop
    <div className="icard-tbl" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.join("|")}>
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={`${i}-${c}`} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={`${i}-${c}`}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
