import { Check, Lock, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api";
import { Await, Empty, fmtDate, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { Question, QuestionKind } from "../../uxv2/types";

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

export function QuestionCard({ q, onDone }: { q: Question; onDone: (id: string) => void }) {
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
      await ux2.answer(q.id, {
        action,
        ...(d.revisionHash ? { revisionHash: d.revisionHash } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
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
    <article className="q-card assemble" aria-labelledby={`q-${q.id}`} data-kind={q.kind}>
      <header>
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

export function Questions() {
  const { t, tn } = useI18n();
  const list = useApi(() => ux2.questions(), []);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const done = useCallback((id: string) => {
    setGone((g) => new Set(g).add(id));
    window.dispatchEvent(new Event(QUESTIONS_CHANGED));
  }, []);
  useEffect(() => setGone(new Set()), [list.data]);

  return (
    <div className="page questions">
      <PageHead eyebrow={t("nav.questions")} title={t("q.title")} lead={t("q.lead")} />
      <Await state={list} skeleton={3}>
        {(all) => {
          const open = all.filter((q) => !gone.has(q.id));
          const shown = open.filter((q) => inFilter(q.kind, filter));
          return (
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
              <p className="muted" role="status">
                {tn(open.length, "q.count.one", "q.count.other")}
              </p>
              {shown.length ? (
                <div className="q-list">
                  {shown.map((q) => (
                    <QuestionCard key={q.id} q={q} onDone={done} />
                  ))}
                </div>
              ) : (
                <Empty title={t("q.empty.title")}>{t("q.empty.lead")}</Empty>
              )}
            </>
          );
        }}
      </Await>
    </div>
  );
}
