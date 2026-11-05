import { ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../state";
import type { ContributeTarget, PersonalFlag, PersonalItem } from "../types";
import { ErrorBox } from "./ui";

const FLAG_LABEL: Record<PersonalFlag["type"], string> = {
  email: "Email address",
  phone: "Phone number",
  health: "Health information",
  family: "Family or private life",
  hr: "HR or pay matter",
};

const FLAG_REASON: Record<PersonalFlag["type"], string> = {
  email: "Contact detail. Personal or client.",
  phone: "Contact detail. Personal or client.",
  health: "Health matters stay in your Personal Brain.",
  family: "Private life stays in your Personal Brain.",
  hr: "HR and pay matters stay out of shared scopes.",
};

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
  const { me } = useApp();

  const flags = item.sensitivity_flags;
  const targetLabel = targets?.find((t) => t.id === target)?.label;

  useEffect(() => {
    let live = true;
    api.contributeTargets().then(
      (t) => live && setTargets(t),
      (e: unknown) =>
        live &&
        setLoadErr(
          e instanceof ApiError ? e.reason : "Could not load the scopes you can contribute to.",
        ),
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
      setErr(e instanceof ApiError ? e.reason : "The contribution failed.");
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!target && confirmed && !busy && !!me;

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contrib-h"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="sheet-head">
          <h3 id="contrib-h">Contribute to Company</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sheet-body">
          <p>
            A copy of <strong>{item.title}</strong> goes into review in the scope you choose. Your
            original stays private. Nothing is published until a reviewer approves it.
          </p>

          <div className="field">
            <label htmlFor="contrib-target">Company scope</label>
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
                <option value="">{targets ? "Choose a scope" : "Loading scopes"}</option>
                {targets?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.group}: {t.label}
                  </option>
                ))}
              </select>
            )}
            {targets && targets.length === 0 ? (
              <div className="reason">Your role cannot contribute to any scope.</div>
            ) : null}
          </div>

          <section aria-labelledby="flags-title">
            <h4 id="flags-title" className="eyebrow section-title">
              Check before you share
            </h4>
            {flags.length === 0 ? (
              <p className="muted">
                The automatic check found nothing sensitive. You are still responsible for what you
                share.
              </p>
            ) : (
              <div className="stack">
                <p>
                  <strong>{flags.length}</strong> {flags.length === 1 ? "span is" : "spans are"}{" "}
                  flagged. Edit the note first if they should not leave your Personal Brain.
                </p>
                {flags.map((f) => (
                  <div className="flag" key={f.id}>
                    <div className="row">
                      <ShieldAlert size={15} aria-hidden color="#ffb547" />
                      <strong>{FLAG_LABEL[f.type]}</strong>
                      <span className="muted">in the {f.field}</span>
                    </div>
                    <div style={{ overflowWrap: "anywhere" }}>
                      <mark>{f.excerpt}</mark>
                    </div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {FLAG_REASON[f.type]}
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
                ? `I have read each flagged span and I confirm this content can be shared with ${targetLabel ?? "the scope I chose"}.`
                : `I confirm this content can be shared with ${targetLabel ?? "the scope I chose"}.`}
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
              {!target ? "Choose a scope to continue." : "Tick the confirmation to continue."}
            </span>
          ) : null}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSend}
            aria-describedby={canSend ? undefined : "send-why"}
            onClick={submit}
          >
            {busy ? "Sending" : "Send for review"}
          </button>
        </div>
      </div>
    </div>
  );
}
