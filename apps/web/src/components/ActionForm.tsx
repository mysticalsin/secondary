import { ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../state";
import type { NodeDetail, PersonalFlag } from "../types";
import { ErrorBox } from "./ui";

type FormAction = "comment" | "edit" | "contribute";
export const FORM_ACTIONS: readonly string[] = ["comment", "edit", "contribute"];

const FLAG_LABEL: Record<PersonalFlag["type"], string> = {
  email: "Email address",
  phone: "Phone number",
  health: "Health information",
  family: "Family or private life",
  hr: "HR or pay matter",
};

/**
 * Inline form for the drawer actions that need input: comment, edit and contribute. The API
 * re-checks permission, revision and sensitivity; this form only collects what it asks for.
 */
export function ActionForm({
  action,
  nodeId,
  detail,
  onDone,
  onCancel,
}: {
  action: FormAction;
  nodeId: string;
  detail: NodeDetail;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const { me } = useApp();
  const [title, setTitle] = useState(action === "edit" ? detail.node.label : "");
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [flags, setFlags] = useState<PersonalFlag[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const revision = detail.record?.revision;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (action === "comment") {
        const r = await api.act({ nodeId, action, payload: { text: text.trim() } });
        onDone(`Comment added. Receipt ${r.receiptId}.`);
      } else if (action === "edit") {
        if (revision === undefined) throw new ApiError(409, "This node has no editable record.");
        const r = await api.act({
          nodeId,
          action,
          revision,
          payload: { title: title.trim(), ...(text.trim() ? { body: text } : {}) },
        });
        onDone(`Saved as revision ${r.revision ?? revision + 1}. Receipt ${r.receiptId}.`);
      } else {
        const r = await api.act({
          nodeId,
          action,
          payload: {
            title: title.trim(),
            body: text,
            user_validated: {
              by: me?.principal.id ?? "",
              at: new Date().toISOString(),
              revision: 1,
            },
            acknowledged_flags: flags.map((f) => f.id),
          },
        });
        onDone(`Sent to review. Receipt ${r.receiptId}.`);
      }
    } catch (x) {
      if (x instanceof ApiError && Array.isArray(x.body.sensitivity_flags)) {
        setFlags(x.body.sensitivity_flags as PersonalFlag[]);
        setConfirmed(false);
      }
      setErr(x instanceof ApiError ? x.reason : "The action failed.");
    } finally {
      setBusy(false);
    }
  };

  const needsTitle = action !== "comment";
  const ready =
    !busy &&
    (action === "comment" ? text.trim().length > 0 : title.trim().length > 0) &&
    (action !== "contribute" || confirmed);

  return (
    <form className="stack action-form" onSubmit={submit} aria-label={`${action} form`}>
      {needsTitle ? (
        <div className="field">
          <label htmlFor="af-title">Title</label>
          <input
            id="af-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="af-text">
          {action === "comment" ? "Comment" : action === "edit" ? "New body (optional)" : "Body"}
        </label>
        <textarea
          id="af-text"
          className="textarea"
          style={{ minHeight: 90 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {flags.length > 0 ? (
        <div className="stack">
          {flags.map((f) => (
            <div className="flag" key={f.id}>
              <div className="row">
                <ShieldAlert size={15} aria-hidden color="#ffb547" />
                <strong>{FLAG_LABEL[f.type]}</strong>
              </div>
              <mark>{f.excerpt}</mark>
            </div>
          ))}
        </div>
      ) : null}
      {action === "contribute" ? (
        <label className="check" htmlFor="af-confirm">
          <input
            id="af-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {flags.length > 0
              ? "I have read each flagged span and confirm this can be shared here."
              : "I confirm this content can be shared here. It goes to review first."}
          </span>
        </label>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
      <div className="row">
        <button type="submit" className="btn primary sm" disabled={!ready}>
          {busy
            ? "Sending"
            : action === "comment"
              ? "Add comment"
              : action === "edit"
                ? "Save edit"
                : "Send for review"}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
