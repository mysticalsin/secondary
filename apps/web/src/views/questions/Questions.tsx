import { Check, ListChecks, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, Empty, fmtDate, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Question, QuestionKind } from "../../uxv2/types";
import { v3 } from "../brains/api";
import type { BatchResult } from "../brains/types";

export const QUESTIONS_CHANGED = "secondary:questions";

const KIND_KEY: Record<QuestionKind, Key> = {
  ingest: "q.kind.ingest",
  contradiction: "q.kind.contradiction",
  lint: "q.kind.lint",
  review: "q.kind.review",
  release: "q.kind.release",
};

const FILTERS: { id: "all" | "ingest" | "contradiction" | "approval" | "lint"; key: Key }[] = [
  { id: "all", key: "q.filter.all" },
  { id: "ingest", key: "q.filter.ingest" },
  { id: "contradiction", key: "q.filter.contradiction" },
  { id: "approval", key: "q.filter.approval" },
  { id: "lint", key: "q.filter.lint" },
];

const inFilter = (k: QuestionKind, f: string) =>
  f === "all" || f === k || (f === "approval" && (k === "review" || k === "release"));

/** The option that says yes (include, approve) is the one primary action on a card. */
const isPrimary = (action: string) =>
  /^(ingest|approve|accept|prefer|release|include)/.test(action);

const POSITIVE = /^(ingest|approve|accept|release|include)/;
const NEGATIVE = /^(request|reject|skip)/;

/** Send one answer. The revision the person read always rides with it. */
export function answerQuestion(q: Question, action: string, note?: string) {
  const d = q.detail ?? {};
  return ux2.answer(q.id, {
    action,
    ...(d.revisionHash ? { revisionHash: d.revisionHash } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  });
}

/** What a batch approval does to this item, in words, so no one approves two-person work by accident. */
export function approvalOutcome(q: Question): "final" | "first" {
  const d = q.detail;
  if (!d?.required) return "final";
  return d.required - (d.approvals ?? 0) > 1 ? "first" : "final";
}

/** The option that says yes for a batch, or null when the person has to pick a side on the card. */
export function batchAction(q: Question): string | null {
  return q.options.find((o) => POSITIVE.test(o.action))?.action ?? null;
}

function Sources({ list: sources }: { list: { id: string; title: string }[] }) {
  const list = sources.map((x) => x.title);
  const { t } = useI18n();
  if (!list.length) return null;
  return (
    <p className="muted q-src">
      {t("q.sources")} {list.join(", ")}
    </p>
  );
}

export function QuestionCard({
  q,
  onDone,
  active,
  select,
}: {
  q: Question;
  onDone: (id: string) => void;
  active?: boolean;
  select?: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void };
}) {
  const { t, locale } = useI18n();
  const { say } = useApp();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = q.detail ?? {};

  const act = async (action: string) => {
    setBusy(action);
    setErr(null);
    try {
      await answerQuestion(q, action, note);
      say(t("q.done"));
      onDone(q.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(null);
    }
  };

  const contradiction = q.kind === "contradiction" && d.current && d.incoming;
  const pick = (re: RegExp) => q.options.find((o) => re.test(o.action));
  const keep = pick(/current|keep/);
  const take = pick(/incoming|accept|new/);
  const side = (kind: "current" | "incoming") => {
    const s = kind === "current" ? d.current : d.incoming;
    const opt = kind === "current" ? keep : take;
    if (!s) return null;
    return (
      <div className={`q-side ${kind}`}>
        <h4>{kind === "current" ? t("q.current") : t("q.incoming")}</h4>
        <blockquote>{s.text}</blockquote>
        <Sources list={s.sources} />
        {opt ? (
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            aria-label={t("q.right.aria", {
              side: kind === "current" ? t("q.current") : t("q.incoming"),
            })}
            onClick={() => act(opt.action)}
          >
            <Check size={16} aria-hidden />{" "}
            {busy === opt.action ? t("common.working") : t("q.right")}
          </button>
        ) : null}
      </div>
    );
  };
  const sidedActions = contradiction && keep && take;

  return (
    <article
      className={`q-card assemble${active ? " is-active" : ""}`}
      aria-labelledby={`q-${q.id}`}
      data-kind={q.kind}
      data-active={active ? "true" : undefined}
      id={`qc-${q.id}`}
      tabIndex={-1}
    >
      <header>
        {select ? (
          <label className="q-sel">
            <input
              type="checkbox"
              checked={select.checked}
              disabled={select.disabled}
              onChange={(e) => select.onChange(e.target.checked)}
            />
            <span className="sr-only">{t("b3.q.select", { title: q.title })}</span>
          </label>
        ) : null}
        <span className="chip t-open">{t(KIND_KEY[q.kind])}</span>
        <time className="muted" dateTime={q.createdAt}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/Toronto",
          }).format(new Date(q.createdAt))}
        </time>
      </header>
      <h3 id={`q-${q.id}`}>{q.title}</h3>
      <p>{q.summary}</p>

      {contradiction ? (
        <div className="q-compare" role="group" aria-label={t("q.which")}>
          <p className="q-which">{t("q.which")}</p>
          <div className="q-sides">
            {side("current")}
            {side("incoming")}
          </div>
        </div>
      ) : null}

      {q.kind === "ingest" && d.reason ? (
        <p className="q-reason">
          <b>{t("q.why")}</b> {d.reason}
        </p>
      ) : null}

      {(q.kind === "review" || q.kind === "release") && d.required ? (
        <div className="q-two" data-testid="two-person">
          <ShieldCheck size={16} aria-hidden />
          <span>
            {t("q.two", { n: d.approvals ?? 0, req: d.required })} {t("q.two.rule")}
          </span>
          <span className="q-dots" aria-hidden>
            {Array.from({ length: d.required }, (_, i) => (
              <i key={`d${i}`} className={i < (d.approvals ?? 0) ? "on" : ""} />
            ))}
          </span>
        </div>
      ) : null}

      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}

      {!sidedActions ? (
        <div className="q-actions">
          {q.options.map((o) => (
            <button
              key={o.action}
              type="button"
              className={`btn${isPrimary(o.action) ? " primary" : ""}`}
              disabled={!!busy}
              onClick={() => act(o.action)}
            >
              {busy === o.action ? t("common.working") : o.label}
            </button>
          ))}
          {q.kind === "review" || q.kind === "release" ? (
            <Link className="btn ghost" to="/review">
              {t("q.openreview")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {q.kind === "ingest" || contradiction ? (
        <details className="q-note">
          <summary>{t("q.note.add")}</summary>
          <label className="sr-only" htmlFor={`n-${q.id}`}>
            {t("q.note")}
          </label>
          <textarea
            id={`n-${q.id}`}
            className="textarea"
            style={{ minHeight: 72 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </details>
      ) : null}
    </article>
  );
}

const AGES = ["", "1d", "7d", "30d", "older"] as const;
const AGE_KEY: Record<(typeof AGES)[number], Key> = {
  "": "b3.q.age.any",
  "1d": "b3.q.age.1d",
  "7d": "b3.q.age.7d",
  "30d": "b3.q.age.30d",
  older: "b3.q.age.older",
};
const KINDS: QuestionKind[] = ["ingest", "contradiction", "lint", "review", "release"];

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** The batch panel: says per item what the approval does, then shows what each item answered. */
export function BatchPanel({
  items,
  onCancel,
  onDone,
}: {
  items: Question[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t, td } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<BatchResult | null>(null);
  const title = (id: string) => items.find((x) => x.id === id)?.title ?? id;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(
        await v3.batch(
          items.map((q) => ({
            id: q.id,
            action: batchAction(q) as string,
            ...(q.detail?.revisionHash ? { revisionHash: q.detail.revisionHash } : {}),
          })),
        ),
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card batch-panel" aria-labelledby="batch-h" data-testid="batch-panel">
      <h3 id="batch-h">
        {res ? t("b3.q.batch.result") : t("b3.q.batch.title", { n: items.length })}
      </h3>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      {res ? (
        <>
          <p role="status">{t("b3.q.batch.sum", { ok: res.ok, failed: res.failed })}</p>
          <ul className="run-items">
            {res.results.map((r) => (
              <li key={r.id}>
                <span className={`chip t-${r.ok ? "done" : "risk"}`}>
                  {r.ok ? td("b3.q.st", r.status, r.status) : t("b3.q.refused")}
                </span>
                <span>
                  {title(r.id)}
                  {r.reason ? <span className="muted"> {r.reason}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn primary" onClick={onDone}>
            {t("b3.q.batch.close")}
          </button>
        </>
      ) : (
        <>
          <p className="muted">{t("b3.q.batch.lead")}</p>
          <ul className="run-items" aria-label={t("b3.q.batch.title", { n: items.length })}>
            {items.map((q) => {
              const first = approvalOutcome(q) === "first";
              return (
                <li key={q.id} data-outcome={first ? "first" : "final"}>
                  <span className={`chip t-${first ? "attn" : "done"}`}>
                    {t(first ? "b3.q.first" : "b3.q.final")}
                  </span>
                  <span>
                    {q.title}
                    <span className="muted">
                      {" "}
                      {first
                        ? t("b3.q.first.d", {
                            n: q.detail?.approvals ?? 0,
                            req: q.detail?.required ?? 2,
                          })
                        : t("b3.q.final.d")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={go}>
              {busy ? t("common.working") : t("b3.q.batch.go", { n: items.length })}
            </button>
            <button type="button" className="btn ghost" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function Questions() {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const [params] = useSearchParams();
  const [term, setTerm] = useState("");
  const [typed, setTyped] = useState("");
  const [brain, setBrain] = useState(params.get("brain") ?? "");
  const [kind, setKind] = useState("");
  const [age, setAge] = useState<(typeof AGES)[number]>("");
  const list = useApi(() => ux2.questions({ q: term, brain, kind, age }), [term, brain, kind, age]);
  const brains = useApi(
    () => v3.brains().catch(() => ({ brains: [] as { id: string; name: string }[] })),
    [],
  );
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [review, setReview] = useState(false);
  const [cur, setCur] = useState(-1);
  const done = useCallback((id: string) => {
    setGone((g) => new Set(g).add(id));
    setPicked((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    window.dispatchEvent(new Event(QUESTIONS_CHANGED));
  }, []);
  // A fresh list keeps the picks that are still in it, so a reload never drops what you chose.
  useEffect(() => {
    setGone(new Set());
    const ids = new Set((list.data ?? []).map((x) => x.id));
    setPicked((p) => new Set([...p].filter((id) => ids.has(id))));
  }, [list.data]);
  // Typing in the search box waits a beat, so the server is asked once per pause.
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(typed.trim()), 250);
    return () => window.clearTimeout(id);
  }, [typed]);

  const all = list.data ?? [];
  const open = all.filter((q) => !gone.has(q.id));
  const shown = open.filter((q) => inFilter(q.kind, filter));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const chosen = useMemo(() => shown.filter((q) => picked.has(q.id)), [shown, picked]);

  const move = useCallback((d: number) => {
    const n = shownRef.current.length;
    if (!n) return;
    setCur((c) => {
      const next = c < 0 ? (d > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, c + d));
      const q = shownRef.current[next];
      if (q) {
        const el = document.getElementById(`qc-${q.id}`);
        el?.scrollIntoView?.({ block: "nearest" });
        el?.focus({ preventScroll: true });
      }
      return next;
    });
  }, []);

  const quick = useCallback(
    async (verb: "approve" | "request") => {
      const q = shownRef.current[cur];
      if (!q) return;
      const opt = q.options.find((o) => (verb === "approve" ? POSITIVE : NEGATIVE).test(o.action));
      if (!opt || (verb === "approve" && q.kind === "contradiction")) {
        say(t(q.kind === "contradiction" ? "b3.q.pickside" : "b3.q.noaction"));
        return;
      }
      try {
        await answerQuestion(q, opt.action);
        say(t("q.done"));
        done(q.id);
      } catch (e) {
        say(e instanceof ApiError ? e.reason : t("common.failed"));
      }
    },
    [cur, done, say, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || review) return;
      const k = e.key.toLowerCase();
      if (k === "j") move(1);
      else if (k === "k") move(-1);
      else if (k === "a") void quick("approve");
      else if (k === "r") void quick("request");
      else if (k === "x" && cur >= 0) {
        const q = shownRef.current[cur];
        if (q && batchAction(q))
          setPicked((p) => {
            const n = new Set(p);
            n.has(q.id) ? n.delete(q.id) : n.add(q.id);
            return n;
          });
        setSelecting(true);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, quick, cur, review]);

  const selectable = shown.filter((q) => batchAction(q));
  const brainOpts = brains.data?.brains ?? [];

  return (
    <div className="page questions">
      <PageHead eyebrow={t("nav.questions")} title={t("q.title")} lead={t("q.lead")} />
      <div className="q-tools" role="search" aria-label={t("b3.q.tools")}>
        <div className="field grow">
          <label htmlFor="q-search">{t("b3.q.search")}</label>
          <input
            id="q-search"
            className="input"
            type="search"
            value={typed}
            placeholder={t("b3.q.search.ph")}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="q-brain">{t("b3.q.brain")}</label>
          <select
            id="q-brain"
            className="select"
            value={brain}
            onChange={(e) => setBrain(e.target.value)}
          >
            <option value="">{t("b3.f.any")}</option>
            {brainOpts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            {brain && !brainOpts.some((b) => b.id === brain) ? (
              <option value={brain}>{brain}</option>
            ) : null}
          </select>
        </div>
        <div className="field">
          <label htmlFor="q-kind">{t("b3.q.kind")}</label>
          <select
            id="q-kind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t("b3.f.any")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_KEY[k])}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="q-age">{t("b3.q.age")}</label>
          <select
            id="q-age"
            className="select"
            value={age}
            onChange={(e) => setAge(e.target.value as (typeof AGES)[number])}
          >
            {AGES.map((a) => (
              <option key={a || "any"} value={a}>
                {t(AGE_KEY[a])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Await state={list} skeleton={3}>
        {() => (
          <>
            <div className="pills q-filters" role="group" aria-label={t("q.filter")}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="pill"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {t(f.key)}
                  <span className="num muted">
                    {open.filter((q) => inFilter(q.kind, f.id)).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="q-bar">
              <p className="muted" role="status">
                {tn(open.length, "q.count.one", "q.count.other")}
              </p>
              <button
                type="button"
                className="btn sm"
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting((v) => !v);
                  setPicked(new Set());
                  setReview(false);
                }}
              >
                <ListChecks size={14} aria-hidden /> {t("b3.q.selectmode")}
              </button>
              {selecting ? (
                <>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setPicked(new Set(selectable.map((q) => q.id)))}
                  >
                    {t("b3.q.selectall", { n: selectable.length })}
                  </button>
                  {review ? null : (
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={!chosen.length}
                      onClick={() => setReview(true)}
                    >
                      {t("b3.q.batch.open", { n: chosen.length })}
                    </button>
                  )}
                </>
              ) : null}
            </div>
            <p className="kbd-hints" data-testid="kbd-hints">
              <span>
                <kbd>J</kbd> / <kbd>K</kbd> {t("b3.q.k.move")}
              </span>
              <span>
                <kbd>A</kbd> {t("b3.q.k.approve")}
              </span>
              <span>
                <kbd>R</kbd> {t("b3.q.k.request")}
              </span>
              <span>
                <kbd>X</kbd> {t("b3.q.k.select")}
              </span>
            </p>
            {review ? (
              <BatchPanel
                items={chosen}
                onCancel={() => setReview(false)}
                onDone={() => {
                  setReview(false);
                  setSelecting(false);
                  setPicked(new Set());
                  window.dispatchEvent(new Event(QUESTIONS_CHANGED));
                  list.reload();
                }}
              />
            ) : null}
            {shown.length ? (
              <div className="q-list">
                {shown.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    onDone={done}
                    active={i === cur}
                    select={
                      selecting
                        ? {
                            checked: picked.has(q.id),
                            disabled: !batchAction(q),
                            onChange: (v) =>
                              setPicked((p) => {
                                const n = new Set(p);
                                v ? n.add(q.id) : n.delete(q.id);
                                return n;
                              }),
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <Empty title={t("q.empty.title")}>{t("q.empty.lead")}</Empty>
            )}
          </>
        )}
      </Await>
    </div>
  );
}
