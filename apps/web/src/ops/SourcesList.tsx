import { Database } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useUid } from "../insights/hooks";
import { useApi } from "../useApi";
import { ops } from "./api";
import { dayLabel, fmtWait, hm, num } from "./format";
import { StateBox, SyntheticChip } from "./ui";

export function SourceStatusPill({ status }: { status: "active" | "paused" }) {
  const { td } = useI18n();
  return <span className={`opx-pill ${status}`}>{td("v7o.src.status", status)}</span>;
}

/** Settings > Sources: every connector source with its target, state and next run. Admins only. */
export function SourcesList() {
  const { t, td, lang, locale } = useI18n();
  const uid = useUid();
  const list = useApi(() => ops.sources(), []);
  const d = list.data;
  return (
    <section aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="sec-title">
        {t("v7o.src.title")}
      </h2>
      <p className="muted">{t("v7o.src.lead")}</p>
      <div className="icard opx" data-testid="sources-list">
        <header className="icard-h">
          <span className="icard-ico" aria-hidden>
            <Database size={20} />
          </span>
          <div className="icard-t">
            <h3>{t("v7o.src.card")}</h3>
            {d?.synthetic ? <SyntheticChip /> : null}
          </div>
        </header>
        {list.error && !d ? (
          <StateBox
            kind="error"
            title={list.status === 403 ? t("v7o.err.forbidden") : t("v7o.err.load")}
            hint={list.error}
            action={
              <button type="button" className="icard-btn" onClick={list.reload}>
                {t("v7o.retry")}
              </button>
            }
          />
        ) : !d ? (
          <StateBox kind="loading" title={t("v7o.loading.sources")} />
        ) : d.sources.length === 0 ? (
          <StateBox kind="empty" title={t("v7o.src.empty")} hint={t("v7o.src.empty.hint")} />
        ) : (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs a keyboard stop
          <div className="opx-tablewrap" role="region" aria-label={t("v7o.src.title")} tabIndex={0}>
            <table className="opx-table">
              <thead>
                <tr>
                  <th scope="col">{t("v7o.src.col.name")}</th>
                  <th scope="col">{t("v7o.src.col.target")}</th>
                  <th scope="col">{t("v7o.col.status")}</th>
                  <th scope="col">{t("v7o.src.col.last")}</th>
                  <th scope="col" className="r">
                    {t("v7o.src.col.files")}
                  </th>
                  <th scope="col" className="r">
                    {t("v7o.src.col.next")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link
                        className="opx-link"
                        to={`/settings/sources/${encodeURIComponent(s.id)}`}
                      >
                        {s.name}
                      </Link>
                      <span className="opx-sub">{td("v7o.src.provider", s.provider)}</span>
                    </td>
                    <td>
                      {s.target.label}
                      <span className="opx-sub">{s.target.collection}</span>
                    </td>
                    <td>
                      <SourceStatusPill status={s.status} />
                    </td>
                    <td>
                      {s.lastSyncAt ? (
                        <span className="mono opx-time">
                          {dayLabel(s.lastSyncAt, lang)} {hm(s.lastSyncAt)}
                        </span>
                      ) : (
                        <span className="mute">-</span>
                      )}
                      {s.lastError ? <span className="opx-sub bad">{s.lastError}</span> : null}
                    </td>
                    <td className="r mono">{num(s.files, locale)}</td>
                    <td className="r mono">
                      {s.nextRunInSeconds === null
                        ? "-"
                        : t("v7o.src.next", { s: fmtWait(s.nextRunInSeconds) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="opx-foot">
          <p className="mute mono">{d ? t("v7o.src.count", { n: d.sources.length }) : ""}</p>
        </footer>
      </div>
    </section>
  );
}
