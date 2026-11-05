import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Await, Empty, fmtDate } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import { lp } from "../../../lp/api";
import type { LandingSummary } from "../../../lp/types";
import { useApi } from "../../../useApi";
import { Composer } from "./Composer";
import { PageThumb } from "./Preview";
import { Sparkline, StatusChip } from "./Publish";
import "./lp.css";

const DAY = 86_400_000;

function Row({ p }: { p: LandingSummary }) {
  const { t, tn } = useI18n();
  const title = t("lp.row.title", { role: p.prospect.role, company: p.prospect.company });
  const left = p.expiresAt ? Math.ceil((Date.parse(p.expiresAt) - Date.now()) / DAY) : null;
  const expiry =
    p.status === "published" && left !== null && left >= 0
      ? tn(left, "lp.expires.one", "lp.expires.other")
      : p.status === "expired" && p.expiresAt
        ? t("lp.expired.on", { date: fmtDate(p.expiresAt) })
        : null;
  const s = p.stats;
  const week = s?.byDay.slice(-7).map((d) => d.views) ?? [];
  const total = week.reduce((a, b) => a + b, 0);
  const showStats = s && (p.status === "published" || p.status === "expired");
  return (
    <li className="lp-card-item" data-status={p.status}>
      <PageThumb page={p} />
      <div className="lp-card-body">
        <div className="lp-card-top">
          <StatusChip status={p.status} />
          {expiry ? <span className="muted lp-expiry">{expiry}</span> : null}
        </div>
        <h4>
          <Link to={`/studio/lp/${encodeURIComponent(p.id)}`}>{title}</Link>
        </h4>
        <p className="muted">
          {p.prospect.firstName ? `${t("lp.row.for", { name: p.prospect.firstName })}. ` : ""}
          {t(`lp.brand.${p.brand}`)}, {t(`lp.lang.${p.lang}`)}
        </p>
        {showStats ? (
          <div className="lp-card-stats">
            <Sparkline data={week} label={t("lp.spark", { n: week.length, total })} />
            <span className="num">{tn(total, "lp.views.one", "lp.views.other")}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function LandingPages() {
  const { t } = useI18n();
  const list = useApi(() => lp.list(), []);
  const [composing, setComposing] = useState(false);
  const nav = useNavigate();
  return (
    <section
      className={`studio-card lp-card${composing ? " composing" : ""}`}
      aria-labelledby="lp-h"
      data-testid="lp-card"
    >
      <header className={composing ? "sr-only" : undefined}>
        <div>
          <h3 id="lp-h">{t("lp.title")}</h3>
          <p className="muted lp-lead">{t("lp.lead")}</p>
        </div>
        {composing ? null : (
          <button
            type="button"
            className="btn primary"
            aria-expanded={composing}
            onClick={() => setComposing(true)}
          >
            <Plus size={16} aria-hidden /> {t("lp.new")}
          </button>
        )}
      </header>
      {composing ? (
        <Composer
          onCancel={() => setComposing(false)}
          onCreated={(d) => nav(`/studio/lp/${encodeURIComponent(d.id)}`)}
        />
      ) : null}
      {composing ? null : (
        <Await state={list} skeleton={2}>
          {(pages) =>
            pages.length ? (
              <ul className="lp-list" aria-label={t("lp.list")}>
                {pages.map((p) => (
                  <Row key={p.id} p={p} />
                ))}
              </ul>
            ) : (
              <Empty title={t("lp.empty.title")}>{t("lp.empty.lead")}</Empty>
            )
          }
        </Await>
      )}
    </section>
  );
}
