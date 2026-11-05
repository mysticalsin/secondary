import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Await, Chip, Eyebrow, fmtDate, fmtRev } from "../components/ui";
import { AskPanel } from "../genui";
import { getLang, useI18n } from "../i18n";
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { BriefCard } from "./brief/PrepareBrief";

const WORLD: [string, string][] = [
  ["Montreal", "America/Toronto"],
  ["São Paulo", "America/Sao_Paulo"],
  ["Bogotá", "America/Bogota"],
  ["Paris", "Europe/Paris"],
  ["Ho Chi Minh City", "Asia/Ho_Chi_Minh"],
];

function useNow(ms = 20000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const loc = () => (getLang() === "fr" ? "fr-CA" : "en-GB");

const timeIn = (d: Date, tz: string) =>
  new Intl.DateTimeFormat(loc(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);

function hourToronto(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Toronto",
    }).format(d),
  );
}

export function Today() {
  const { me, openNode } = useApp();
  const { t, td, tn } = useI18n();
  const now = useNow();
  const review = useApi(() => api.review(), []);
  const map = useApi(() => api.map("departments"), []);
  const attention = useApi(() => api.attention(), []);
  const accounts = useApi(() => api.accounts(), []);
  const activity = useApi(() => api.activity(), []);
  const roleId = me?.principal.roleIds[0];
  const role = roleId
    ? td("role", roleId, PERSONAS.find((p) => p.id === roleId)?.label)
    : undefined;

  const date = new Intl.DateTimeFormat(getLang() === "fr" ? "fr-CA" : "en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  }).format(now);
  const h = hourToronto(now);
  const greeting = h < 12 ? t("today.morning") : h < 18 ? t("today.afternoon") : t("today.evening");
  const openHubs = (map.data?.hubs ?? [])
    .filter((x) => x.counts && x.counts.open > 0)
    .sort((a, b) => (b.counts?.open ?? 0) - (a.counts?.open ?? 0))
    .slice(0, 3);
  const waiting = review.data ?? [];
  const items = attention.data?.items ?? [];
  const settled = !review.loading && !map.loading && !attention.loading;
  const nothing = settled && waiting.length === 0 && openHubs.length === 0 && items.length === 0;

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <section className="hero" aria-label={t("nav.today")}>
        <Eyebrow>
          {t("today.city")} · {role ?? t("shell.brain")}
        </Eyebrow>
        <h2>{greeting}</h2>
        <div className="clock">{timeIn(now, "America/Toronto")}</div>
        <p style={{ color: "var(--lilac-1)" }}>{date}</p>
      </section>

      <div className="grid cols-2">
        <section className="card" aria-labelledby="seedo-h">
          <h3 id="seedo-h">{t("today.seedo")}</h3>
          {me ? (
            <>
              <div className="seedo">
                <div>
                  <Eyebrow>{t("today.see")}</Eyebrow>
                  <ul>
                    {me.describe.see.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <Eyebrow>{t("today.do")}</Eyebrow>
                  <ul>
                    {me.describe.do.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="never">
                <strong>{t("today.never")}</strong> {me.describe.never.join(". ")}.
              </div>
            </>
          ) : (
            <p className="muted">{t("today.loadingaccess")}</p>
          )}
        </section>

        <section className="card" aria-labelledby="attn-h">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 id="attn-h" style={{ marginBottom: 0 }}>
              {t("today.attention")}
            </h3>
            <Chip tone="attn">{t("today.inscope")}</Chip>
          </div>
          <div style={{ marginTop: 8 }}>
            {waiting.length > 0 ? (
              <div className="attn-row">
                <div>
                  {tn(waiting.length, "today.reviews.one", "today.reviews.other", {
                    n: waiting.length,
                  })}
                </div>
                <Link className="btn sm" to="/review">
                  {t("today.openreview")} <ChevronRight size={14} aria-hidden />
                </Link>
              </div>
            ) : null}
            {items.slice(0, 6).map((it) => (
              <div className="attn-row" key={it.id}>
                <div>
                  <strong>{it.title}</strong>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {td("today.kind", it.kind)} · {it.accountName}
                    {it.due ? ` · ${t("today.due", { date: fmtDate(it.due) })}` : ""}
                  </div>
                </div>
                <span className="row">
                  {it.overdue ? <Chip tone="risk">{t("today.overdue")}</Chip> : null}
                  <Link className="btn sm ghost" to={`/accounts/${it.accountId}`}>
                    {t("today.workspace")}
                  </Link>
                </span>
              </div>
            ))}
            {items.length > 6 ? (
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                {t("today.more", { n: items.length - 6 })}
              </p>
            ) : null}
            {openHubs.map((x) => (
              <div className="attn-row" key={x.id}>
                <div>{t("today.openin", { n: x.counts?.open ?? 0, name: x.label })}</div>
                <button type="button" className="btn sm ghost" onClick={() => openNode(x.id)}>
                  {t("common.details")}
                </button>
              </div>
            ))}
            {nothing ? <p className="muted">{t("today.nothing")}</p> : null}
            {review.error || map.error || attention.error ? (
              <p className="reason err">
                {t("today.partial", { why: review.error ?? map.error ?? attention.error ?? "" })}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="recent-h">
        <h3 id="recent-h">{t("today.recent")}</h3>
        {activity.error ? (
          <p className="muted">{t("today.recent.unavailable")}</p>
        ) : (
          <Await state={activity} skeleton={2}>
            {(d) =>
              d.length === 0 ? (
                <p className="muted">{t("today.recent.none")}</p>
              ) : (
                <div>
                  {d.map((e) => (
                    <div className="attn-row" key={e.id}>
                      <div>
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => openNode(e.nodeId)}
                        >
                          {e.title}
                        </button>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {e.scopeLabel} · {fmtRev(e.revision)} · {fmtDate(e.at)}
                        </div>
                      </div>
                      <Chip tone="done">{t("status.approved")}</Chip>
                    </div>
                  ))}
                </div>
              )
            }
          </Await>
        )}
      </section>

      <BriefCard accounts={accounts.data ?? []} />

      <AskPanel />

      <section aria-labelledby="world-h">
        <h3 id="world-h" className="eyebrow" style={{ fontWeight: 400 }}>
          {t("today.world")}
        </h3>
        <ul className="worldstrip" style={{ marginTop: 8, listStyle: "none", padding: 0 }}>
          {WORLD.map(([city, tz]) => (
            <li className="world" key={city}>
              <span className="muted" style={{ fontSize: 14 }}>
                {city}
              </span>
              <b>{timeIn(now, tz)}</b>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
