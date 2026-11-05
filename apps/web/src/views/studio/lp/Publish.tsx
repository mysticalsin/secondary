import { Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../../api";
import { Await, ErrorBox, fmtDate } from "../../../components/ui";
import { useT } from "../../../i18n";
import { lp } from "../../../lp/api";
import type { LpStatus } from "../../../lp/types";
import { useApp } from "../../../state";
import { useApi } from "../../../useApi";

export function Sparkline({ data, label }: { data: number[]; label: string }) {
  const w = 120;
  const h = 32;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`,
  );
  return (
    <svg
      className="lp-spark"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label={label}
    >
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} className="area" />
      <polyline points={pts.join(" ")} fill="none" className="line" />
    </svg>
  );
}

export function StatusChip({ status }: { status: LpStatus }) {
  const t = useT();
  const tone: Record<LpStatus, string> = {
    draft: "t-open",
    in_review: "t-progress",
    approved: "t-done",
    published: "t-done",
    expired: "t-risk",
    unpublished: "t-open",
  };
  return <span className={`chip ${tone[status]}`}>{t(`lp.status.${status}`)}</span>;
}

/** The page is past the draft step. Say why nothing can be edited. */
export function LockedNote({ status }: { status: LpStatus }) {
  const t = useT();
  if (status === "draft" || status === "published") return null;
  return (
    <p className="lp-locked" role="status">
      {t(`lp.locked.${status}`)}
    </p>
  );
}

export function PublishPanel({
  id,
  onPublished,
}: {
  id: string;
  onPublished: (r: { url: string; expiresAt: string }) => void;
}) {
  const t = useT();
  const { say } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      onPublished(await lp.publish(id));
      say(t("lp.pub.done"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="lp-panel" aria-labelledby="lp-pub-h">
      <h4 id="lp-pub-h">{t("lp.pub.title")}</h4>
      <p>{t("lp.pub.lead")}</p>
      {err ? <ErrorBox message={err} /> : null}
      <button type="button" className="btn primary" disabled={busy} onClick={go}>
        {busy ? t("lp.pub.working") : t("lp.pub.cta")}
      </button>
    </section>
  );
}

export function PublishedPanel({
  id,
  url,
  expiresAt,
  onUnpublished,
}: {
  id: string;
  url: string;
  expiresAt?: string;
  onUnpublished: () => void;
}) {
  const t = useT();
  const { say } = useApp();
  const sid = useId();
  const stats = useApi(() => lp.stats(id), [id]);
  const [utm, setUtm] = useState({ source: "", medium: "", campaign: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const out = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  const tracked = (() => {
    try {
      const u = new URL(url);
      for (const [k, v] of Object.entries(utm))
        if (v.trim()) u.searchParams.set(`utm_${k}`, v.trim());
      return u.toString();
    } catch {
      return url;
    }
  })();

  useEffect(() => {
    if (confirm) keep.current?.focus();
  }, [confirm]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tracked);
      setCopyNote(t("lp.pp.copied"));
      say(t("lp.pp.copied"));
    } catch {
      out.current?.select();
      setCopyNote(t("lp.pp.copy.fail"));
    }
  };
  const unpublish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await lp.unpublish(id);
      say(t("lp.pp.unpublished"));
      onUnpublished();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setBusy(false);
    }
  };
  const field = (k: keyof typeof utm, label: string) => (
    <div className="field">
      <label htmlFor={`${sid}-${k}`}>{label}</label>
      <input
        id={`${sid}-${k}`}
        className="input"
        value={utm[k]}
        onChange={(e) => setUtm({ ...utm, [k]: e.target.value })}
      />
    </div>
  );

  return (
    <section className="lp-panel" aria-labelledby={`${sid}-h`}>
      <h4 id={`${sid}-h`}>{t("lp.pp.title")}</h4>
      <div className="field">
        <label htmlFor={`${sid}-url`}>{t("lp.pp.link")}</label>
        <div className="lp-copy">
          <input
            id={`${sid}-url`}
            ref={out}
            className="input"
            readOnly
            value={tracked}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn" onClick={copy}>
            <Copy size={15} aria-hidden /> {t("lp.pp.copy")}
          </button>
        </div>
      </div>
      <p className="lp-note" role="status">
        {copyNote}
      </p>
      <details className="lp-utm">
        <summary>{t("lp.pp.utm")}</summary>
        {field("source", t("lp.pp.utm.source"))}
        {field("medium", t("lp.pp.utm.medium"))}
        {field("campaign", t("lp.pp.utm.campaign"))}
      </details>
      {expiresAt ? (
        <p className="muted">{t("lp.pp.expiry", { date: fmtDate(expiresAt) })}</p>
      ) : null}

      <h5 className="lp-sub">{t("lp.pp.stats")}</h5>
      <Await state={stats} skeleton={1}>
        {(s) => (
          <>
            <dl className="lp-stats">
              <div>
                <dt>{t("lp.pp.views")}</dt>
                <dd className="num">{s.views}</dd>
              </div>
              <div>
                <dt>{t("lp.pp.clicks")}</dt>
                <dd className="num">{s.ctaClicks}</dd>
              </div>
              <div>
                <dt>{t("lp.pp.consent")}</dt>
                <dd className="num">{Math.round(s.consentRate * 100)} %</dd>
              </div>
            </dl>
            <Sparkline
              data={s.byDay.map((d) => d.views)}
              label={t("lp.spark", { n: s.byDay.length, total: s.views })}
            />
            <p className="muted">{t("lp.pp.stats.note")}</p>
          </>
        )}
      </Await>

      <hr className="lp-rule" />
      {err ? <ErrorBox message={err} /> : null}
      {confirm ? (
        <div className="lp-confirm" role="group" aria-labelledby={`${sid}-c`}>
          <h5 id={`${sid}-c`}>{t("lp.pp.confirm.title")}</h5>
          <p>{t("lp.pp.confirm.body")}</p>
          <div className="row">
            <button type="button" className="btn danger" disabled={busy} onClick={unpublish}>
              {t("lp.pp.confirm.yes")}
            </button>
            <button ref={keep} type="button" className="btn" onClick={() => setConfirm(false)}>
              {t("lp.pp.confirm.no")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
          {t("lp.pp.unpublish")}
        </button>
      )}
    </section>
  );
}
