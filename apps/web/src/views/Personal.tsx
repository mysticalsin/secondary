import { History, Lock, Plus, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { ContributeSheet } from "../components/ContributeSheet";
import { Await, Chip, Empty, ErrorBox, fmtDate, fmtRev, PageHead } from "../components/ui";
import { type Key, useI18n } from "../i18n";
import { diffStats, lineDiff } from "../lib/diff";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";
import type { ContributionStatus, Draft, PersonalItem, PersonalKind, RevisionRow } from "../types";
import { useApi } from "../useApi";
import { WikiTab } from "./wiki/WikiTab";

const KINDS: PersonalKind[] = ["note", "brief", "draft", "view"];
const AUTOSAVE_MS = 1200;

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function Personal() {
  const { say } = useApp();
  const { t, td } = useI18n();
  const [sp, setSp] = useSearchParams();
  const state = useApi(() => api.personalList(), []);
  const drafts = useApi(() => api.drafts(), []);
  const [selId, setSelId] = useState<string | "new" | null>(sp.get("new") ? "new" : null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [fresh, setFresh] = useState<PersonalItem | null>(null);
  const [area, setArea] = useState<"notes" | "wiki">("notes");
  const items = state.data ?? [];
  const current =
    selId === "new"
      ? null
      : (items.find((i) => i.id === selId) ??
        (fresh && fresh.id === selId ? fresh : selId ? undefined : items[0]));

  useEffect(() => {
    if (sp.get("new")) {
      setSelId("new");
      const n = new URLSearchParams(sp);
      n.delete("new");
      setSp(n, { replace: true });
    }
  }, [sp, setSp]);

  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags ?? []))].sort(), [items]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!tag || (i.tags ?? []).includes(tag)) &&
        (!term ||
          i.title.toLowerCase().includes(term) ||
          i.body.toLowerCase().includes(term) ||
          (i.tags ?? []).some((x) => x.includes(term))),
    );
  }, [items, q, tag]);

  const draftFor = (key: string): Draft | undefined => drafts.data?.find((d) => d.key === key);

  return (
    <div className="page">
      <PageHead
        eyebrow={t("nav.personal")}
        title={
          <>
            {t("p.title.a")} <em>{t("p.title.b")}</em>
          </>
        }
        lead={t("p.lead")}
      />
      <div className="privacy-note" role="note" style={{ marginBottom: 16 }}>
        <Lock size={16} aria-hidden />
        <span>{t("p.privacy")}</span>
      </div>
      <div className="tabs" role="tablist" aria-label={t("wiki.personal.tabs")}>
        {(["notes", "wiki"] as const).map((k) => (
          <button
            key={k}
            id={`p-area-${k}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={area === k}
            aria-controls="p-area-panel"
            tabIndex={area === k ? 0 : -1}
            onClick={() => setArea(k)}
          >
            {t(k === "notes" ? "wiki.personal.tab.notes" : "wiki.personal.tab.wiki")}
          </button>
        ))}
      </div>
      <div id="p-area-panel" role="tabpanel" aria-labelledby={`p-area-${area}`}>
        {area === "wiki" ? (
          <WikiTab ws="me" />
        ) : (
          <Await state={state} skeleton={3}>
            {() => (
              <div className="personal-layout">
                <div className="stack">
                  <button type="button" className="btn primary" onClick={() => setSelId("new")}>
                    <Plus size={16} aria-hidden /> {t("p.new")}
                  </button>
                  <div className="field">
                    <label htmlFor="p-search" className="sr-only">
                      {t("p.search")}
                    </label>
                    <input
                      id="p-search"
                      className="input"
                      type="search"
                      placeholder={t("p.search")}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  {allTags.length > 0 ? (
                    <div className="pills" role="group" aria-label={t("p.tags")}>
                      {allTags.map((x) => (
                        <button
                          key={x}
                          type="button"
                          className="pill"
                          aria-pressed={tag === x}
                          onClick={() => setTag(tag === x ? "" : x)}
                        >
                          #{x}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {items.length === 0 ? (
                    <Empty title={t("p.empty.title")}>{t("p.empty.body")}</Empty>
                  ) : shown.length === 0 ? (
                    <Empty title={t("p.nomatch.title")}>{t("p.nomatch.body")}</Empty>
                  ) : null}
                  <ul
                    className="stack"
                    style={{ listStyle: "none", margin: 0, padding: 0 }}
                    aria-label={t("p.list")}
                  >
                    {shown.map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          className="qitem"
                          aria-current={current?.id === i.id}
                          onClick={() => setSelId(i.id)}
                        >
                          <strong>{i.title}</strong>
                          <span className="muted" style={{ fontSize: 14 }}>
                            {td("kind", i.kind)} · {fmtDate(i.updatedAt)}
                          </span>
                          <span className="row">
                            {(i.tags ?? []).map((x) => (
                              <span key={x} className="muted" style={{ fontSize: 13 }}>
                                #{x}
                              </span>
                            ))}
                            {draftFor(i.id) ? <Chip tone="attn">{t("p.unsaved")}</Chip> : null}
                            {i.contributedTo?.length ? (
                              <Chip tone="progress">
                                {t("p.contributed", { n: i.contributedTo.length })}
                              </Chip>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <Editor
                  key={selId === "new" ? "new" : (current?.id ?? "none")}
                  item={selId === "new" ? null : (current ?? null)}
                  draft={draftFor(selId === "new" ? "new" : (current?.id ?? ""))}
                  onChanged={drafts.reload}
                  onSaved={(it) => {
                    setFresh(it);
                    setSelId(it.id);
                    state.reload();
                    drafts.reload();
                    say(t("p.saved"));
                  }}
                  onDeleted={(copies) => {
                    setSelId(null);
                    state.reload();
                    drafts.reload();
                    say(copies > 0 ? t("p.deleted.copies", { n: copies }) : t("p.deleted"));
                  }}
                  onContributed={(m) => {
                    say(t("p.sent", { scope: m.scope, receipt: m.receiptId }));
                    state.reload();
                  }}
                />
              </div>
            )}
          </Await>
        )}
      </div>
    </div>
  );
}

const STATUS_KEY: Record<ContributionStatus["status"], Key> = {
  in_review: "p.cs.in_review",
  changes_requested: "p.cs.changes_requested",
  released: "p.cs.released",
  withdrawn: "p.cs.withdrawn",
  unknown: "p.cs.unknown",
};

function Contributions({ id, refresh }: { id: string; refresh: number }) {
  const { t } = useI18n();
  const s = useApi(() => api.personalContributions(id), [id, refresh]);
  const list = s.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="p-cs-h" className="stack">
      <h4 id="p-cs-h" className="eyebrow section-title">
        {t("p.cs.title")}
      </h4>
      <p className="muted" style={{ fontSize: 14 }}>
        {t("p.cs.note")}
      </p>
      <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.map((c) => (
          <li key={c.candidateId} className="itemrow">
            <div className="row">
              <strong>{c.scopeLabel}</strong>
              <Chip
                tone={
                  c.status === "released"
                    ? "done"
                    : c.status === "changes_requested"
                      ? "attn"
                      : "progress"
                }
              >
                {t(STATUS_KEY[c.status])}
              </Chip>
              <span className="muted" style={{ fontSize: 14 }}>
                {fmtDate(c.at)}
              </span>
            </div>
            {c.feedback.map((f) => (
              <blockquote key={f.id} className="feedback">
                {f.text}
              </blockquote>
            ))}
            {c.status === "changes_requested" ? (
              <p className="muted" style={{ fontSize: 14 }}>
                {t("p.cs.fixhint")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DiffView({ lines }: { lines: ReturnType<typeof lineDiff> }) {
  const { t } = useI18n();
  return (
    <div className="diff" role="group" aria-label={t("review.diff.aria")}>
      {lines.map((d, i) => (
        // The diff is static once built, so index keys are stable.
        <div key={`${i}-${d.type}`} className={d.type}>
          <span className="sign" aria-hidden>
            {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
          </span>
          <span>
            {d.type === "add" ? <span className="sr-only">{t("review.diff.added")} </span> : null}
            {d.type === "del" ? <span className="sr-only">{t("review.diff.removed")} </span> : null}
            {d.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

function HistoryPanel({
  item,
  dirty,
  onRestored,
}: {
  item: PersonalItem;
  dirty: boolean;
  onRestored: () => void;
}) {
  const { t } = useI18n();
  const rows = useApi(() => api.personalHistory(item.id), [item.id, item.revision]);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const restore = async (r: RevisionRow) => {
    setBusy(true);
    setErr(null);
    try {
      await api.personalRestore(item.id, item.revision, r.revision);
      onRestored();
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="p-hist-h" className="stack">
      <h4 id="p-hist-h" className="eyebrow section-title">
        {t("p.hist.title")}
      </h4>
      <Await state={rows} skeleton={2}>
        {(list) => (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {list.map((r) => {
              const open = pick === r.revision;
              const lines = open ? lineDiff(r.body, item.body) : [];
              const st = diffStats(lines);
              return (
                <li key={r.revision} className="itemrow">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      <strong>{fmtRev(r.revision)}</strong>{" "}
                      <span className="muted">{fmtDate(r.at)}</span>
                      {r.current ? <Chip tone="done">{t("p.hist.current")}</Chip> : null}
                    </span>
                    {r.current ? null : (
                      <span className="row">
                        <button
                          type="button"
                          className="btn sm ghost"
                          aria-expanded={open}
                          onClick={() => setPick(open ? null : r.revision)}
                        >
                          {open ? t("p.hist.hide") : t("p.hist.compare")}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busy || dirty}
                          aria-describedby={dirty ? "p-hist-why" : undefined}
                          onClick={() => restore(r)}
                        >
                          <RotateCcw size={14} aria-hidden /> {t("p.hist.restore")}
                        </button>
                      </span>
                    )}
                  </div>
                  {open ? (
                    <>
                      <p className="muted" style={{ fontSize: 14 }}>
                        {t("p.hist.diffnote", {
                          from: fmtRev(r.revision),
                          to: fmtRev(item.revision),
                          added: st.added,
                          removed: st.removed,
                        })}
                      </p>
                      <DiffView lines={lines} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Await>
      {dirty ? (
        <p className="reason" id="p-hist-why">
          {t("p.hist.dirty")}
        </p>
      ) : null}
      {err ? <ErrorBox message={err} /> : null}
    </section>
  );
}

function ConfirmDelete({
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, true);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={box}
        className="sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="del-h"
        aria-describedby="del-d"
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <div className="sheet-head">
          <h3 id="del-h">{t("p.del.title")}</h3>
        </div>
        <div className="sheet-body">
          <p id="del-d">{t("p.del.body", { title })}</p>
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>
            <Trash2 size={16} aria-hidden /> {t("p.del.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Editor({
  item,
  draft,
  onChanged,
  onSaved,
  onDeleted,
  onContributed,
}: {
  item: PersonalItem | null;
  draft: Draft | undefined;
  onChanged: () => void;
  onSaved: (i: PersonalItem) => void;
  onDeleted: (copies: number) => void;
  onContributed: (m: { candidateId: string; receiptId: string; scope: string }) => void;
}) {
  const { t, td } = useI18n();
  const key = item?.id ?? "new";
  const base = useMemo(
    () => ({
      title: item?.title ?? "",
      body: item?.body ?? "",
      kind: (item?.kind ?? "note") as PersonalKind,
      tags: item?.tags ?? [],
    }),
    [item],
  );
  // A working copy left from an earlier visit comes back, once, and says so.
  const restored = !!draft && (draft.title !== base.title || draft.body !== base.body);
  const [title, setTitle] = useState(restored ? draft.title : base.title);
  const [body, setBody] = useState(restored ? draft.body : base.body);
  const [kind, setKind] = useState<PersonalKind>(restored ? draft.kind : base.kind);
  const [tagText, setTagText] = useState(base.tags.join(", "));
  const [showRestored, setShowRestored] = useState(restored);
  const [saved, setSaved] = useState<PersonalItem | null>(item);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [hist, setHist] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [autoAt, setAutoAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const tags = useMemo(() => parseTags(tagText), [tagText]);

  const contentDirty = title !== base.title || body !== base.body;
  const metaDirty = kind !== base.kind || !sameTags(tags, base.tags);
  const dirty = contentDirty || metaDirty;
  const canSave = !busy && title.trim().length > 0 && (saved === null ? true : dirty);

  // Autosave the working copy. It is not a revision: Save makes one.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!contentDirty && !metaDirty) return;
    if (!title.trim() && !body.trim()) return;
    const h = window.setTimeout(() => {
      api
        .saveDraft(key, { title, body, kind, baseRevision: saved?.revision ?? 0 })
        .then((r) => {
          setAutoAt(r.at);
          changed.current();
        })
        .catch(() => setAutoAt(null));
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(h);
  }, [title, body, kind, contentDirty, metaDirty, key, saved?.revision]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      let result: PersonalItem;
      if (!saved) {
        result = await api.personalCreate({ title: title.trim(), body, kind });
        if (tags.length) await api.personalUpdate(result.id, { revision: 1, tags });
        await api.dropDraft("new").catch(() => {});
        result = { ...result, tags };
      } else {
        const r = await api.personalUpdate(saved.id, {
          revision: saved.revision,
          ...(contentDirty ? { title: title.trim(), body } : {}),
          ...(kind !== base.kind ? { kind } : {}),
          ...(!sameTags(tags, base.tags) ? { tags } : {}),
        });
        result = {
          ...saved,
          title: title.trim(),
          body,
          kind,
          tags,
          revision: r.revision,
          updatedAt: r.updatedAt,
        };
      }
      setSaved(result);
      setShowRestored(false);
      setAutoAt(null);
      setTick((n) => n + 1);
      onSaved(result);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setTitle(base.title);
    setBody(base.body);
    setKind(base.kind);
    setShowRestored(false);
    await api.dropDraft(key).catch(() => {});
    onChanged();
  };

  const remove = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      const r = await api.personalDelete(saved.id);
      onDeleted(r.copiesLeftInReview);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-label={t("p.editor")}>
      {showRestored ? (
        <div className="callout info" role="status">
          <span style={{ flex: 1 }}>{t("p.restored")}</span>
          <button type="button" className="btn sm ghost" onClick={discard}>
            {t("p.discard")}
          </button>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="p-title">{t("p.f.title")}</label>
        <input
          id="p-title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("p.f.title.ph")}
          maxLength={200}
        />
      </div>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="p-kind">{t("p.f.type")}</label>
          <select
            id="p-kind"
            className="select"
            style={{ borderRadius: 10 }}
            value={kind}
            onChange={(e) => setKind(e.target.value as PersonalKind)}
          >
            {KINDS.map((v) => (
              <option key={v} value={v}>
                {td("kind", v)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-tags">{t("p.f.tags")}</label>
          <input
            id="p-tags"
            className="input"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder={t("p.f.tags.ph")}
            aria-describedby="p-tags-h"
          />
          <span className="muted" id="p-tags-h" style={{ fontSize: 13 }}>
            {t("p.f.tags.hint")}
          </span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-body">{t("p.f.body")}</label>
        <textarea
          id="p-body"
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("p.f.body.ph")}
          maxLength={8000}
        />
      </div>
      <div className="row">
        <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
          {busy ? t("common.saving") : saved ? t("p.save.rev") : t("common.save")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!saved || dirty}
          aria-describedby={!saved || dirty ? "contrib-why" : undefined}
          onClick={() => setSheet(true)}
        >
          <Share2 size={16} aria-hidden /> {t("p.contribute")}
        </button>
        {saved ? (
          <>
            <button
              type="button"
              className="btn ghost"
              aria-expanded={hist}
              onClick={() => setHist(!hist)}
            >
              <History size={16} aria-hidden /> {t("p.hist.btn")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(true)}>
              <X size={16} aria-hidden /> {t("p.del.btn")}
            </button>
          </>
        ) : null}
        <span className="muted" aria-live="polite" style={{ fontSize: 14 }}>
          {autoAt
            ? t("p.autosaved", {
                time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
                  new Date(autoAt),
                ),
              })
            : saved && !dirty
              ? t("p.savedat", { date: fmtDate(saved.updatedAt), rev: fmtRev(saved.revision) })
              : ""}
        </span>
      </div>
      {!saved || dirty ? (
        <div className="reason" id="contrib-why">
          {!saved ? t("p.why.save") : t("p.why.dirty")}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>
          {t("p.keptas")}
        </p>
      )}
      {err ? <ErrorBox message={err} /> : null}
      {saved ? <Contributions id={saved.id} refresh={tick} /> : null}
      {hist && saved ? (
        <HistoryPanel
          item={saved}
          dirty={dirty}
          onRestored={() => {
            onChanged();
            api
              .personalList()
              .then((l) => {
                const fresh = l.find((x) => x.id === saved.id);
                if (fresh) {
                  setSaved(fresh);
                  setTitle(fresh.title);
                  setBody(fresh.body);
                  onSaved(fresh);
                }
              })
              .catch(() => {});
          }}
        />
      ) : null}
      {sheet && saved ? (
        <ContributeSheet
          item={saved}
          onClose={() => setSheet(false)}
          onDone={(m) => {
            setSheet(false);
            setTick((n) => n + 1);
            onContributed(m);
          }}
        />
      ) : null}
      {confirm && saved ? (
        <ConfirmDelete
          title={saved.title}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
}
