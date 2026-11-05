import { Download, FilePlus, FolderPlus, History, Trash2, Upload, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Empty, fmtDate } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { BrainFrame, band, HealthRing } from "./shared";
import type { BrainHome, Change, Health } from "./types";

function Tile({
  label,
  value,
  score,
  hidden,
}: {
  label: string;
  value: string;
  score?: number;
  hidden?: boolean;
}) {
  const { t } = useI18n();
  return (
    <li className={`tile${hidden ? " off" : ""}`}>
      <span className="tile-l">{label}</span>
      {hidden ? (
        <span className="tile-v muted">{t("b3.health.hidden")}</span>
      ) : (
        <>
          <span className="tile-v">{value}</span>
          <span className={`hbar hbar-${band(score ?? 0)}`} aria-hidden>
            <i style={{ width: `${score ?? 0}%` }} />
          </span>
        </>
      )}
    </li>
  );
}

export function HealthStrip({ health }: { health: Health }) {
  const { t } = useI18n();
  const c = health.components;
  const word = t(`b3.health.${band(health.score)}` as Key);
  return (
    <section className="hstrip card" aria-labelledby="hs-h">
      <div className="hs-ring">
        <HealthRing score={health.score} size={96} />
        <div>
          <h3 id="hs-h">{t("b3.health.title")}</h3>
          <p className="muted">{word}</p>
        </div>
      </div>
      <ul className="tiles">
        <Tile
          label={t("b3.health.fresh")}
          value={t("b3.health.fresh.v", { n: c.freshness.value })}
          score={c.freshness.score}
        />
        <Tile
          label={t("b3.health.lint")}
          value={String(c.lint?.value ?? 0)}
          score={c.lint?.score}
          hidden={!c.lint}
        />
        <Tile
          label={t("b3.health.orphans")}
          value={String(c.orphans.value)}
          score={c.orphans.score}
        />
        <Tile
          label={t("b3.health.backlog")}
          value={String(c.backlog?.value ?? 0)}
          score={c.backlog?.score}
          hidden={!c.backlog}
        />
        <Tile
          label={t("b3.health.coverage")}
          value={`${c.coverage.have}/${c.coverage.want}`}
          score={c.coverage.score}
        />
      </ul>
      {c.coverage.missing.length ? (
        <p className="muted hs-missing">
          {t("b3.health.missing", { list: c.coverage.missing.join(", ") })}
        </p>
      ) : null}
    </section>
  );
}

function DiffBar({ added, removed }: { added: number; removed: number }) {
  const { t } = useI18n();
  const total = Math.max(1, added + removed);
  return (
    <span className="diffbar" title={t("b3.diff", { a: added, r: removed })}>
      <b className="add">+{added}</b>
      <b className="del">−{removed}</b>
      <span className="diffbar-track" aria-hidden>
        <i className="add" style={{ width: `${(added / total) * 100}%` }} />
        <i className="del" style={{ width: `${(removed / total) * 100}%` }} />
      </span>
      <span className="sr-only">{t("b3.diff", { a: added, r: removed })}</span>
    </span>
  );
}

function ChangeRow({ id, c }: { id: string; c: Change }) {
  const { t } = useI18n();
  return (
    <li className="chg">
      <div className="chg-main">
        <p className="chg-t">
          <Link to={`/brain?ws=${encodeURIComponent(id)}&page=${encodeURIComponent(c.pageId)}`}>
            {c.title}
          </Link>
          <span className={`chip t-${c.change === "new" ? "progress" : "open"}`}>
            {t(c.change === "new" ? "b3.chg.new" : "b3.chg.updated")}
          </span>
        </p>
        <p className="muted">
          {c.actor ?? t("b3.chg.you")} · {fmtDate(c.at)} · r{c.revision} · {c.type}
        </p>
      </div>
      <DiffBar added={c.added} removed={c.removed} />
      <Link
        className="btn sm ghost"
        to={`/brains/${encodeURIComponent(id)}/pages/${encodeURIComponent(c.pageId)}/versions`}
      >
        <History size={14} aria-hidden /> {t("b3.versions.open")}
        <span className="sr-only"> {c.title}</span>
      </Link>
    </li>
  );
}

function Changes({ b }: { b: BrainHome }) {
  const { t, tn } = useI18n();
  const [ctype, setCtype] = useState("");
  const [status, setStatus] = useState<"" | "new" | "updated">("");
  const types = [...new Set(b.changedThisWeek.items.map((c) => c.type))];
  const shown = b.changedThisWeek.items.filter(
    (c) => (!ctype || c.type === ctype) && (!status || c.change === status),
  );
  const backlog = b.health.components.backlog?.value ?? 0;
  return (
    <section className="card" id="changes" aria-labelledby="chg-h">
      <h3 id="chg-h">{t("b3.chg.title")}</h3>
      <p className="muted">{tn(b.changedThisWeek.total, "b3.chg.sum.one", "b3.chg.sum.other")}</p>
      <div className="row bf">
        <div className="field">
          <label htmlFor="f-type">{t("b3.f.type")}</label>
          <select
            id="f-type"
            className="select"
            value={ctype}
            onChange={(e) => setCtype(e.target.value)}
          >
            <option value="">{t("b3.f.any")}</option>
            {types.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">{t("b3.f.status")}</label>
          <select
            id="f-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | "new" | "updated")}
          >
            <option value="">{t("b3.f.any")}</option>
            <option value="new">{t("b3.chg.new")}</option>
            <option value="updated">{t("b3.chg.updated")}</option>
          </select>
        </div>
        {b.health.components.backlog ? (
          <Link className="btn sm" to={`/questions?brain=${encodeURIComponent(b.id)}`}>
            {t("b3.f.review", { n: backlog })}
          </Link>
        ) : null}
      </div>
      {shown.length ? (
        <ul className="chgs">
          {shown.map((c) => (
            <ChangeRow key={c.pageId} id={b.id} c={c} />
          ))}
        </ul>
      ) : (
        <Empty title={t("b3.chg.empty")}>{t("b3.chg.empty.lead")}</Empty>
      )}
    </section>
  );
}

export function BrainHomeView() {
  const { id = "" } = useParams();
  const { t, tn } = useI18n();
  const base = `/brains/${encodeURIComponent(id)}`;
  return (
    <BrainFrame id={id} tab="home">
      {(b) => (
        <>
          <div className="bactions row">
            <Link className="btn sm" to={`${base}/access`}>
              <Users size={14} aria-hidden /> {t("b3.act.readers", { n: b.readers })}
            </Link>
            <a className="btn sm" href="#changes">
              {t("b3.act.activity")}
            </a>
            <Link className="btn sm" to={`${base}/import`}>
              <Upload size={14} aria-hidden /> {t("b3.act.import")}
            </Link>
            <Link className="btn sm" to={`/brain?ws=${encodeURIComponent(b.id)}`}>
              <Download size={14} aria-hidden /> {t("b3.act.open")}
            </Link>
            <Link
              className="btn sm"
              to={`${base}/pages/${encodeURIComponent(b.changedThisWeek.items[0]?.pageId ?? "")}/versions`}
              aria-disabled={!b.changedThisWeek.items.length}
              onClick={(e) => {
                if (!b.changedThisWeek.items.length) e.preventDefault();
              }}
            >
              <Trash2 size={14} aria-hidden /> {t("b3.act.trash")}
            </Link>
            <span className="sp" />
            <Link className="btn sm" to={`/wiki/${encodeURIComponent(b.id)}`}>
              <FilePlus size={14} aria-hidden /> {t("b3.act.newpage")}
            </Link>
            {b.manages ? (
              <Link className="btn sm primary" to={`${base}/coach`}>
                <FolderPlus size={14} aria-hidden /> {t("b3.act.newcoll")}
              </Link>
            ) : null}
          </div>
          <HealthStrip health={b.health} />
          <div className="home-cols">
            <Changes b={b} />
            <div className="stack">
              <section className="card" aria-labelledby="col-h">
                <h3 id="col-h">{t("b3.col.title")}</h3>
                <ul className="colls">
                  {b.collections.map((c) => (
                    <li key={c.type} className={c.count === 0 && c.expected ? "gap" : ""}>
                      <Link to={`/brain?ws=${encodeURIComponent(b.id)}`}>{c.label}</Link>
                      <span className="num">{c.count}</span>
                      {c.count === 0 && c.expected ? (
                        <span className="muted">{t("b3.col.empty")}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
              {b.coach.available && b.coach.suggestions.length ? (
                <section className="card coach-sugg" aria-labelledby="cs-h">
                  <h3 id="cs-h">{t("b3.sugg.title")}</h3>
                  <ul className="stack">
                    {b.coach.suggestions.map((s) => (
                      <li key={s.collection} className="sugg">
                        <p>{s.message}</p>
                        <Link className="btn sm" to={`${base}/coach`}>
                          {t("b3.sugg.cta")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
          <p className="muted bfoot">
            {tn(b.pages, "b3.pages.one", "b3.pages.other")} · {t(`b3.tpl.${b.template}` as Key)}
          </p>
        </>
      )}
    </BrainFrame>
  );
}
