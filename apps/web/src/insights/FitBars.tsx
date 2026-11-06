import { useI18n } from "../i18n";
import { CARD, CATEGORY } from "./palette";
import type { CoverageRow } from "./types";

/**
 * Rows of "label, bar, value". The bar is the value on a scale that ends at twice the target, the
 * thin marker is the target. A missing row shows only the track and the word "Missing" in amber.
 */
export function FitBars({
  rows,
  title,
  headline,
}: {
  rows: CoverageRow[];
  title: string;
  headline?: string;
}) {
  const { t, tn } = useI18n();
  return (
    <div className="fit">
      <div className="fit-h">
        <h4>{title}</h4>
        {headline ? <b className="fit-hl mono">{headline}</b> : null}
      </div>
      <ul>
        {rows.map((r) => {
          const max = Math.max(r.target * 2, r.value, 1);
          const w = (r.value / max) * 100;
          const warn = r.state !== "ok";
          return (
            <li key={r.key} className="fit-row">
              <span className="fit-l">{r.label}</span>
              <span className="fit-track" aria-hidden>
                <i
                  className="fit-fill"
                  style={{
                    width: `${w}%`,
                    background: warn ? CATEGORY[3].bar : CARD.inZone,
                  }}
                />
                <i className="fit-mark" style={{ left: `${(r.target / max) * 100}%` }} />
              </span>
              <span className={`fit-v mono${warn ? " warn" : ""}`}>
                {r.state === "missing"
                  ? t("v5.missing")
                  : tn(
                      r.value,
                      r.unit === "pages" ? "v5.n.pages.one" : "v5.n.lines.one",
                      r.unit === "pages" ? "v5.n.pages.other" : "v5.n.lines.other",
                    )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
