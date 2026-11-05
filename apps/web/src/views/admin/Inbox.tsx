// Header pieces for the governance console: the in-app inbox and the elevation banner.

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { adm, type ElevationState, type Notice } from "./api";
import { fmtLeft, fmtTime } from "./shared";

/** Where a notice leads. Review events go to the review queue or the contributor's notes. */
const noticeHref = (kind: string): string | null =>
  kind === "review_requested" || kind === "review_second_approval"
    ? "/review"
    : kind.startsWith("review_")
      ? "/personal"
      : null;

export function InboxBell() {
  const { epoch } = useApp();
  const { tn, t } = useI18n();
  const [data, setData] = useState<{ unread: number; items: Notice[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      adm.notifications().then(
        (d) => live && setData(d),
        () => undefined,
      );
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [epoch]);
  if (!data) return null;
  return (
    <div className="adm-bell">
      <button
        type="button"
        className="btn ghost sm"
        aria-expanded={open}
        aria-label={tn(data.unread, "adm.bell.label.one", "adm.bell.label.other")}
        onClick={() => setOpen(!open)}
      >
        <Bell size={16} aria-hidden />
        {data.unread > 0 ? <span className="badge-n">{data.unread}</span> : null}
      </button>
      {open ? (
        <div className="adm-pop card raised" role="dialog" aria-label={t("adm.bell.title")}>
          {data.items.length === 0 ? (
            <p className="muted">{t("adm.bell.empty")}</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.items.slice(0, 10).map((n) => (
                <li key={n.id} style={{ opacity: n.read ? 0.65 : 1 }}>
                  <div>
                    {noticeHref(n.kind) ? (
                      <Link to={noticeHref(n.kind) as string} onClick={() => setOpen(false)}>
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {fmtTime(n.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const r = await adm.markRead().catch(() => null);
                if (r)
                  setData({
                    unread: r.unread,
                    items: data.items.map((n) => ({ ...n, read: true })),
                  });
              }}
            >
              {t("adm.bell.markall")}
            </button>
            <Link className="btn ghost sm" to="/admin?tab=requests" onClick={() => setOpen(false)}>
              {t("adm.bell.open")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Visible on every page while an elevation is active. Counts down from the server's clock. */
export function ElevationBanner() {
  const { epoch } = useApp();
  const { t } = useI18n();
  const [st, setSt] = useState<ElevationState | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    let live = true;
    adm.elevation().then(
      (s) => {
        if (!live) return;
        setSt(s);
        setLeft(s.active?.secondsLeft ?? 0);
      },
      () => live && setSt(null),
    );
    return () => {
      live = false;
    };
  }, [epoch]);
  useEffect(() => {
    if (!st?.active) return;
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 30)), 30_000);
    return () => window.clearInterval(t);
  }, [st]);
  if (!st?.active || left <= 0) return null;
  return (
    <div className="adm-elev" role="status">
      <strong>{t("adm.banner.title")}</strong>
      <span>{t("adm.banner.body", { left: fmtLeft(left), reason: st.active.reason })}</span>
      <Link to="/admin?tab=elevations">{t("adm.banner.manage")}</Link>
    </div>
  );
}
