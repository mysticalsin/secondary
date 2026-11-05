import { useI18n } from "../../i18n";
import type { WikiDiffLine } from "./types";

/** A line diff. Unchanged lines are shown in grey only where they sit next to a change. */
export function WikiDiff({ lines, label }: { lines: WikiDiffLine[]; label: string }) {
  const { t } = useI18n();
  const near = lines.map((l, i) =>
    l.type !== "same"
      ? true
      : lines.slice(Math.max(0, i - 1), i + 2).some((x) => x.type !== "same"),
  );
  const shown = lines.filter((_, i) => near[i]);
  if (!shown.length) return <p className="muted">{t("wiki.prop.nodiff")}</p>;
  return (
    <div className="diff" role="group" aria-label={label}>
      {shown.map((d, i) => (
        // The diff is static once built, so index keys are stable.
        <div key={`${i}-${d.type}`} className={d.type}>
          <span className="sign" aria-hidden>
            {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
          </span>
          <span>
            {d.type === "add" ? <span className="sr-only">{t("wiki.prop.diff.add")} </span> : null}
            {d.type === "del" ? <span className="sr-only">{t("wiki.prop.diff.del")} </span> : null}
            {d.text.replace(/\{src:[^}]+\}/g, " [src]").trim() || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
