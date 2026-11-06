import { Sparkles, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { initials } from "./hooks";
import { cat } from "./palette";

const SHOWN = 3;

/**
 * The query bar under the constellation: the question, and one chip per word with the pages it hits
 * ("pricing +12"). More than three words fold into a grey "+N" chip. Removing a chip asks again.
 */
export function QueryChips({
  value,
  terms,
  who,
  searchHref,
  onSubmit,
}: {
  value: string;
  terms: { term: string; hits: number }[];
  who: string;
  searchHref?: string;
  onSubmit: (q: string) => void;
}) {
  const { t, tn } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft.trim());
  };
  const shown = terms.slice(0, SHOWN);
  const rest = terms.length - shown.length;
  return (
    <form className="qbar" onSubmit={submit} role="search" aria-label={t("v5.query.label")}>
      <div className="qbar-in">
        <span className="qbar-av" aria-hidden>
          {initials(who)}
        </span>
        <input
          type="text"
          className="qbar-input"
          value={draft}
          maxLength={120}
          placeholder={t("v5.query.ph")}
          aria-label={t("v5.query.label")}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="qbar-go">
          {t("v5.query.go")}
        </button>
      </div>
      <div className="qbar-chips" role="group" aria-label={t("v5.query.chips")}>
        <Sparkles size={16} aria-hidden className="qbar-sp" />
        {terms.length === 0 ? <span className="qbar-none">{t("v5.query.none")}</span> : null}
        {shown.map((c, n) => {
          const tone = cat(n);
          return (
            <span
              key={c.term}
              className="qchip"
              style={{ background: tone.chipBg, color: tone.chipFg }}
            >
              <span>{c.term}</span>
              <span
                className="qchip-n"
                style={{ background: tone.chipCount }}
                title={tn(c.hits, "v5.chip.hits.one", "v5.chip.hits.other")}
              >
                +{c.hits}
              </span>
              <button
                type="button"
                className="qchip-x"
                aria-label={t("v5.chip.remove", { term: c.term })}
                onClick={() =>
                  onSubmit(
                    terms
                      .filter((x) => x.term !== c.term)
                      .map((x) => x.term)
                      .join(" "),
                  )
                }
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
        {rest > 0 ? (
          <span className="qchip more" title={t("v5.chip.more", { n: rest })}>
            +{rest}
            <span className="sr-only"> {t("v5.chip.more", { n: rest })}</span>
          </span>
        ) : null}
        {searchHref ? (
          <Link className="qbar-search" to={searchHref}>
            {t("v5.con.search.all")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
