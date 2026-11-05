import { Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, ErrorBox, PageHead } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Digest } from "../../uxv2/types";
import { LandingPages } from "./lp/LandingPages";

const brainLink = (pageId: string) => `/brain?page=${encodeURIComponent(pageId)}`;

export function DigestCard({ d }: { d: Digest }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const week = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${d.weekOf}T00:00:00Z`),
  );
  const stats: [number, string][] = [
    [d.stats.opportunities, t("digest.stat.opps")],
    [d.stats.newLeads, t("digest.stat.leads")],
    [d.stats.commitmentsDue, t("digest.stat.due")],
    [d.stats.wins, t("digest.stat.wins")],
  ];
  const draft = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ux2.digestDraft();
      setDrafted(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-card digest" aria-labelledby="digest-h">
      <header>
        <h3 id="digest-h">{t("digest.title")}</h3>
        <p className="muted">{t("digest.week", { date: week })}</p>
      </header>
      <dl className="digest-stats">
        {stats.map(([n, label]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="num">{n}</dd>
          </div>
        ))}
      </dl>
      <details className="digest-more" open>
        <summary>{t("digest.items")}</summary>
        {d.sections.map((s) => (
          <div key={s.title} className="digest-sec">
            <h4>{s.title}</h4>
            <ul>
              {s.items.map((it) => (
                <li key={`${s.title}-${it.label}`}>
                  {it.pageId ? <Link to={brainLink(it.pageId)}>{it.label}</Link> : it.label}
                  <span className="muted"> {it.meta}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
      <footer className="digest-foot">
        {err ? <ErrorBox message={err} /> : null}
        {drafted ? (
          <p className="draft-ok" role="status" data-testid="draft-done">
            <Mail size={16} aria-hidden /> {t("digest.drafted")}
          </p>
        ) : (
          <>
            <button type="button" className="btn primary" onClick={draft} disabled={busy}>
              <Mail size={16} aria-hidden /> {busy ? t("common.working") : t("digest.draft")}
            </button>
            <p className="muted" data-testid="draft-note">
              {t("digest.draft.note")}
            </p>
          </>
        )}
      </footer>
    </section>
  );
}

export function Studio() {
  const { t } = useI18n();
  const digest = useApi(() => ux2.digest(), []);
  return (
    <div className="page studio">
      <PageHead eyebrow={t("nav.studio")} title={t("studio.title")} lead={t("studio.lead")} />
      <div className="studio-grid">
        <Await state={digest} skeleton={3}>
          {(d) => <DigestCard d={d} />}
        </Await>
        <LandingPages />
      </div>
    </div>
  );
}
