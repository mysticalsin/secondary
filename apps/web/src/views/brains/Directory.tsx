import { Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Await, Empty, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { HealthRing, LastActive, ManageChip, RestrictedChip, TYPE_KEY, TypeChip } from "./shared";
import type { BrainCard, BrainType } from "./types";

const TYPES: (BrainType | "all")[] = ["all", "personal", "team", "account", "global"];

function Card({ b }: { b: BrainCard }) {
  const { t, tn } = useI18n();
  return (
    <li className="bcard assemble">
      <div className="row">
        <TypeChip type={b.type} />
        {b.restricted ? <RestrictedChip /> : null}
        {b.manages ? <ManageChip /> : null}
      </div>
      <h3>
        <Link to={`/brains/${encodeURIComponent(b.id)}`}>{b.name}</Link>
      </h3>
      <p className="muted">
        {t(`b3.tpl.${b.template}` as Key)} · {tn(b.pages, "b3.pages.one", "b3.pages.other")}
      </p>
      <div className="bcard-foot">
        <HealthRing score={b.health.score} size={56} />
        <dl className="bcard-facts">
          <div>
            <dt>{t("b3.readers")}</dt>
            <dd>{b.readers}</dd>
          </div>
          <div>
            <dt>{t("b3.lastactive")}</dt>
            <dd>
              <LastActive iso={b.lastActivityAt} />
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

export function Directory() {
  const { t } = useI18n();
  const list = useApi(() => v3.brains(), []);
  const [type, setType] = useState<BrainType | "all">("all");
  const [term, setTerm] = useState("");
  return (
    <div className="page brains">
      <PageHead eyebrow={t("nav.brains")} title={t("b3.dir.title")} lead={t("b3.dir.lead")} />
      <Await state={list} skeleton={3}>
        {({ brains }) => {
          const n = (ty: BrainType | "all") =>
            brains.filter((b) => ty === "all" || b.type === ty).length;
          const shown = brains.filter(
            (b) =>
              (type === "all" || b.type === type) &&
              b.name.toLowerCase().includes(term.trim().toLowerCase()),
          );
          return (
            <>
              <div className="bfilters">
                <div className="field bsearch">
                  <label htmlFor="b-search">{t("b3.dir.search")}</label>
                  <div className="input-ico">
                    <Search size={16} aria-hidden />
                    <input
                      id="b-search"
                      className="input"
                      type="search"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder={t("b3.dir.search.ph")}
                    />
                  </div>
                </div>
                <div className="pills" role="group" aria-label={t("b3.dir.types")}>
                  {TYPES.map((ty) => (
                    <button
                      key={ty}
                      type="button"
                      className="pill"
                      aria-pressed={type === ty}
                      onClick={() => setType(ty)}
                    >
                      {ty === "all" ? t("b3.type.all") : t(TYPE_KEY[ty])}
                      <span className="num muted">{n(ty)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="muted" role="status">
                {t("b3.dir.count", { n: shown.length })}
              </p>
              {shown.length ? (
                <ul className="bgrid">
                  {shown.map((b) => (
                    <Card key={b.id} b={b} />
                  ))}
                </ul>
              ) : (
                <Empty title={t("b3.dir.empty.title")}>{t("b3.dir.empty.lead")}</Empty>
              )}
            </>
          );
        }}
      </Await>
    </div>
  );
}
