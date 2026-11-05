import { ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";
import type { ContributeTarget, PersonalItem } from "../types";
import { ErrorBox } from "./ui";

/**
 * Pre-share validation sheet (R-110, R-111). The flags are the server's own scan of the saved note
 * (never a browser scan). The author sees every flagged span and must tick an explicit confirmation.
 * The send names the person, the time and the exact revision, and acknowledges each flag by id.
 * The server re-checks all of it.
 */
export function ContributeSheet({
  item,
  onClose,
  onDone,
}: {
  item: PersonalItem;
  onClose: () => void;
  onDone: (r: { candidateId: string; receiptId: string; scope: string }) => void;
}) {
  const [targets, setTargets] = useState<ContributeTarget[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { me } = useApp();
  const { t, td, tn } = useI18n();
  useFocusTrap(box, true);

  const flags = item.sensitivity_flags;
  const targetLabel = targets?.find((t) => t.id === target)?.label;

  useEffect(() => {
    let live = true;
    api.contributeTargets().then(
      (t) => live && setTargets(t),
      (e: unknown) => live && setLoadErr(e instanceof ApiError ? e.reason : t("cs.loaderr")),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    first.current?.focus();
  }, [targets]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.contribute(item.id, {
        targetScopeId: target,
        user_validated: {
          by: me?.principal.id ?? "",
          at: new Date().toISOString(),
          revision: item.revision,
        },
        acknowledged_flags: flags.map((f) => f.id),
      });
      onDone({ candidateId: r.candidateId, receiptId: r.receiptId, scope: targetLabel ?? target });
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!target && confirmed && !busy && !!me;

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contrib-h"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="sheet-head">
          <h3 id="contrib-h">{t("p.contribute")}</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">
          <p>
            {t("cs.intro.a")} <strong>{item.title}</strong> {t("cs.intro.b")}
          </p>

          <div className="field">
            <label htmlFor="contrib-target">{t("cs.scope")}</label>
            {loadErr ? (
              <ErrorBox message={loadErr} />
            ) : (
              <select
                id="contrib-target"
                ref={first}
                className="select"
                style={{ borderRadius: 10 }}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={!targets}
              >
                <option value="">{targets ? t("cs.choose") : t("cs.loading")}</option>
                {targets?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.group}: {t.label}
                  </option>
                ))}
              </select>
            )}
            {targets && targets.length === 0 ? (
              <div className="reason">{t("cs.noscope")}</div>
            ) : null}
          </div>

          <section aria-labelledby="flags-title">
            <h4 id="flags-title" className="eyebrow section-title">
              {t("cs.check")}
            </h4>
            {flags.length === 0 ? (
              <p className="muted">{t("cs.nothing")}</p>
            ) : (
              <div className="stack">
                <p>
                  <strong>{flags.length}</strong>{" "}
                  {tn(flags.length, "cs.flagged.one", "cs.flagged.other")}
                </p>
                {flags.map((f) => (
                  <div className="flag" key={f.id}>
                    <div className="row">
                      <ShieldAlert size={15} aria-hidden color="#ffb547" />
                      <strong>{td("flagtype", f.type, f.type)}</strong>
                      <span className="muted">
                        {t(f.field === "title" ? "cs.in.title" : "cs.in.body")}
                      </span>
                    </div>
                    <div style={{ overflowWrap: "anywhere" }}>
                      <mark>{f.excerpt}</mark>
                    </div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {td("flagwhy", f.type, f.type)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <label className="check" htmlFor="contrib-confirm">
            <input
              id="contrib-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              {flags.length > 0
                ? t("cs.confirm.flags", { scope: targetLabel ?? t("cs.thescope") })
                : t("cs.confirm", { scope: targetLabel ?? t("cs.thescope") })}
            </span>
          </label>
          {err ? <ErrorBox message={err} /> : null}
        </div>
        <div className="sheet-foot">
          {!canSend && !busy ? (
            <span
              className="reason"
              style={{ marginRight: "auto", alignSelf: "center" }}
              id="send-why"
            >
              {!target ? t("cs.why.scope") : t("cs.why.confirm")}
            </span>
          ) : null}
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSend}
            aria-describedby={canSend ? undefined : "send-why"}
            onClick={submit}
          >
            {busy ? t("common.sending") : t("cs.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
