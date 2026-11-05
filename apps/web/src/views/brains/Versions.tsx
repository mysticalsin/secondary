import { EyeOff, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, Empty } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { BrainFrame } from "./shared";
import type { Version } from "./types";

function Row({
  id,
  pid,
  v,
  current,
  onDone,
}: {
  id: string;
  pid: string;
  v: Version;
  current: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const { say } = useApp();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      say(ok);
      setAsking(false);
      setReason("");
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`ver${v.hidden ? " is-hidden" : ""}`}>
      <div className="ver-main">
        <p>
          <b>{t("b3.ver.rev", { n: v.revision })}</b>{" "}
          {current ? <span className="chip t-progress">{t("b3.ver.current")}</span> : null}
          {v.hidden ? (
            <span className="chip t-attn">
              <EyeOff size={12} aria-hidden /> {t("b3.ver.hidden")}
            </span>
          ) : null}
        </p>
        <p className="muted">
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/Toronto",
          }).format(new Date(v.at))}
          {v.actor ? ` · ${v.actor}` : ""}
        </p>
        {v.hidden && v.reason ? (
          <p className="ver-why">
            {t("b3.ver.reason")} {v.reason}
            {v.hiddenBy ? <span className="muted"> · {v.hiddenBy}</span> : null}
          </p>
        ) : null}
        {err ? (
          <div className="errorbox" role="alert">
            {err}
          </div>
        ) : null}
        {asking ? (
          <form
            className="ver-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim())
                run(() => v3.hide(id, pid, v.revision, reason.trim()), t("b3.ver.hid"));
            }}
          >
            <div className="field">
              <label htmlFor={`why-${v.revision}`}>{t("b3.ver.why")}</label>
              <input
                id={`why-${v.revision}`}
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <button type="submit" className="btn sm primary" disabled={busy || !reason.trim()}>
              {t("b3.ver.hide.go")}
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </button>
          </form>
        ) : null}
      </div>
      <div className="row">
        {v.hidden ? (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => run(() => v3.restore(id, pid, v.revision), t("b3.ver.restored"))}
          >
            <RotateCcw size={14} aria-hidden /> {t("b3.ver.restore")}
            <span className="sr-only"> {t("b3.ver.rev", { n: v.revision })}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn sm"
            disabled={busy || current}
            aria-describedby={current ? `cur-${v.revision}` : undefined}
            onClick={() => setAsking(true)}
          >
            <EyeOff size={14} aria-hidden /> {t("b3.ver.hide")}
            <span className="sr-only"> {t("b3.ver.rev", { n: v.revision })}</span>
          </button>
        )}
        {current ? (
          <span id={`cur-${v.revision}`} className="muted">
            {t("b3.ver.nocurrent")}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function VersionsPage() {
  const { id = "", pid = "" } = useParams();
  const { t } = useI18n();
  const list = useApi(() => v3.versions(id, pid), [id, pid]);
  return (
    <BrainFrame id={id} title={t("b3.ver.title")}>
      {() => (
        <section className="card" aria-labelledby="ver-h">
          <h3 id="ver-h">{t("b3.ver.title")}</h3>
          <p className="muted">{t("b3.ver.lead")}</p>
          <p>
            <Link to={`/brains/${encodeURIComponent(id)}/pages/${encodeURIComponent(pid)}`}>
              {t("b3.ver.page", { id: pid })}
            </Link>
          </p>
          <Await state={list} skeleton={3}>
            {({ versions }) =>
              versions.length ? (
                <ul className="vers">
                  {versions.map((v, i) => (
                    <Row
                      key={v.revision}
                      id={id}
                      pid={pid}
                      v={v}
                      current={i === 0}
                      onDone={list.reload}
                    />
                  ))}
                </ul>
              ) : (
                <Empty title={t("b3.ver.empty")} />
              )
            }
          </Await>
        </section>
      )}
    </BrainFrame>
  );
}
