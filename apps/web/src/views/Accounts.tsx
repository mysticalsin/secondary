import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Await, Chip, Empty, PageHead, PlaneBadge, statusTone, useStatus } from "../components/ui";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";

export function Accounts() {
  const { t, tn } = useI18n();
  const sl = useStatus();
  const state = useApi(() => api.accounts(), []);
  const [f, setF] = useState({ region: "", country: "", sector: "", status: "", q: "" });
  const all = state.data ?? [];
  const opts = useMemo(() => {
    const u = (k: "region" | "country" | "sector" | "status") =>
      [...new Set(all.map((a) => a[k]))].sort();
    return { region: u("region"), country: u("country"), sector: u("sector"), status: u("status") };
  }, [all]);
  const shown = all.filter(
    (a) =>
      (!f.region || a.region === f.region) &&
      (!f.country || a.country === f.country) &&
      (!f.sector || a.sector === f.sector) &&
      (!f.status || a.status === f.status) &&
      (!f.q || a.name.toLowerCase().includes(f.q.toLowerCase())),
  );
  const sel = (k: "region" | "country" | "sector" | "status", label: string) => (
    <div className="field">
      <label htmlFor={`f-${k}`} className="sr-only">
        {label}
      </label>
      <select
        id={`f-${k}`}
        className="select"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      >
        <option value="">{t("acc.filter.all", { label })}</option>
        {opts[k].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="page">
      <PageHead
        eyebrow={t("nav.accounts")}
        title={
          <>
            {t("accs.title.a")} <em>{t("accs.title.b")}</em>
          </>
        }
        lead={t("accs.lead")}
      />
      <div className="filters">
        <div className="field">
          <label htmlFor="f-q" className="sr-only">
            {t("accs.search")}
          </label>
          <input
            id="f-q"
            className="input"
            placeholder={t("accs.search")}
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
          />
        </div>
        {sel("region", t("accs.region"))}
        {sel("country", t("accs.country"))}
        {sel("sector", t("accs.sector"))}
        {sel("status", t("accs.status"))}
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => setF({ region: "", country: "", sector: "", status: "", q: "" })}
        >
          {t("common.clear")}
        </button>
      </div>
      <Await state={state} skeleton={4}>
        {() =>
          all.length === 0 ? (
            <Empty title={t("accs.empty.title")}>{t("accs.empty.body")}</Empty>
          ) : shown.length === 0 ? (
            <Empty title={t("accs.nomatch.title")}>{t("accs.nomatch.body")}</Empty>
          ) : (
            <ul className="grid auto" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((a) => (
                <li key={a.id}>
                  <Link className="card acard" to={`/accounts/${a.id}`}>
                    <PlaneBadge plane={a.plane} />
                    <h3>{a.name}</h3>
                    <div className="meta">
                      <span className="muted">{a.country}</span>
                      <span className="muted">· {a.sector}</span>
                    </div>
                    <div className="meta">
                      <Chip tone={statusTone(a.status)}>{a.status}</Chip>
                      <Chip tone={statusTone(a.aiProcessing)}>
                        {t("accs.ai", { state: sl(a.aiProcessing) })}
                      </Chip>
                    </div>
                    <div className="foot">
                      <span>{t("accs.open", { n: a.openItems })}</span>
                      <span>
                        <Star size={13} aria-hidden style={{ verticalAlign: -2 }} color="#f8f060" />{" "}
                        {tn(a.stars, "accs.story.one", "accs.story.other", { n: a.stars })}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Await>
    </div>
  );
}
