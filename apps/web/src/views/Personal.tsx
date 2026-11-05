import { Lock, Plus, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { ContributeSheet } from "../components/ContributeSheet";
import { Await, Chip, Empty, ErrorBox, fmtDate, PageHead } from "../components/ui";
import { useApp } from "../state";
import type { PersonalItem, PersonalKind } from "../types";
import { useApi } from "../useApi";

const KINDS: [PersonalKind, string][] = [
  ["note", "Note"],
  ["brief", "Private brief"],
  ["draft", "Draft"],
  ["view", "Saved view"],
];

export function Personal() {
  const { say } = useApp();
  const [sp, setSp] = useSearchParams();
  const state = useApi(() => api.personalList(), []);
  const [selId, setSelId] = useState<string | "new" | null>(sp.get("new") ? "new" : null);
  const items = state.data?.items ?? [];
  const current =
    selId === "new" ? null : (items.find((i) => i.id === selId) ?? (selId ? undefined : items[0]));

  useEffect(() => {
    if (sp.get("new")) {
      setSelId("new");
      const n = new URLSearchParams(sp);
      n.delete("new");
      setSp(n, { replace: true });
    }
  }, [sp, setSp]);

  return (
    <div className="page">
      <PageHead
        eyebrow="My Secondary"
        title={
          <>
            Your private <em>second brain.</em>
          </>
        }
        lead="Notes, private briefs and drafts. Only you can read them."
      />
      <div className="privacy-note" role="note" style={{ marginBottom: 16 }}>
        <Lock size={16} aria-hidden />
        <span>
          Private to you. It never appears on the Company Map, in anyone else&apos;s search, or to
          any admin, CEO or auditor role.
        </span>
      </div>
      <Await state={state} skeleton={3}>
        {() => (
          <div className="personal-layout">
            <div className="stack">
              <button type="button" className="btn primary" onClick={() => setSelId("new")}>
                <Plus size={16} aria-hidden /> New note
              </button>
              {items.length === 0 ? (
                <Empty title="No notes yet">Capture your first note.</Empty>
              ) : null}
              <ul
                className="stack"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
                aria-label="Your items"
              >
                {items.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="qitem"
                      aria-current={current?.id === i.id}
                      onClick={() => setSelId(i.id)}
                    >
                      <strong>{i.title}</strong>
                      <span className="muted" style={{ fontSize: 14 }}>
                        {KINDS.find((k) => k[0] === i.kind)?.[1]} · {fmtDate(i.updatedAt)}
                      </span>
                      {i.contributedTo?.length ? (
                        <Chip tone="progress">Contributed {i.contributedTo.length}x</Chip>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <Editor
              key={selId === "new" ? "new" : (current?.id ?? "none")}
              item={selId === "new" ? null : (current ?? null)}
              onSaved={(it) => {
                setSelId(it.id);
                state.reload();
                say("Saved to your Personal Brain.");
              }}
              onContributed={(m) => {
                say(`Sent to review in ${m.scope}. Receipt ${m.receiptId}.`);
                state.reload();
              }}
            />
          </div>
        )}
      </Await>
    </div>
  );
}

function Editor({
  item,
  onSaved,
  onContributed,
}: {
  item: PersonalItem | null;
  onSaved: (i: PersonalItem) => void;
  onContributed: (m: { candidateId: string; receiptId: string; scope: string }) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [kind, setKind] = useState<PersonalKind>(item?.kind ?? "note");
  const [saved, setSaved] = useState<PersonalItem | null>(item);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const dirty = !saved || saved.title !== title || saved.body !== body || saved.kind !== kind;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.personalSave({ id: saved?.id, title, body, kind });
      setSaved(res.item);
      onSaved(res.item);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-label="Editor">
      <div className="field">
        <label htmlFor="p-title">Title</label>
        <input
          id="p-title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this about"
        />
      </div>
      <div className="field">
        <label htmlFor="p-kind">Type</label>
        <select
          id="p-kind"
          className="select"
          style={{ borderRadius: 10, maxWidth: 240 }}
          value={kind}
          onChange={(e) => setKind(e.target.value as PersonalKind)}
        >
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="p-body">Body</label>
        <textarea
          id="p-body"
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write freely. Nothing leaves your Personal Brain until you contribute it."
        />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={busy || !dirty || !title.trim()}
          onClick={save}
        >
          {busy ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!saved || dirty}
          aria-describedby={!saved || dirty ? "contrib-why" : undefined}
          onClick={() => setSheet(true)}
        >
          <Share2 size={16} aria-hidden /> Contribute to Company
        </button>
        <span className="muted" aria-live="polite">
          {saved && !dirty ? `Saved ${fmtDate(saved.updatedAt)}` : dirty ? "Unsaved changes" : ""}
        </span>
      </div>
      {!saved || dirty ? (
        <div className="reason" id="contrib-why">
          Save first. You contribute exactly what you saved.
        </div>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
      {saved?.contributedTo?.length ? (
        <p className="muted" style={{ fontSize: 14 }}>
          Contributed {saved.contributedTo.length} time(s). Each copy is a candidate in review. This
          original stays private.
        </p>
      ) : null}
      {sheet && saved ? (
        <ContributeSheet
          item={saved}
          onClose={() => setSheet(false)}
          onDone={(m) => {
            setSheet(false);
            onContributed(m);
          }}
        />
      ) : null}
    </section>
  );
}
