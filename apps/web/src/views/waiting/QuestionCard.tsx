import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../api";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { ux2 } from "../../uxv2/api";
import type { Question, QuestionKind } from "../../uxv2/types";

const KIND_KEY: Record<QuestionKind, Key> = {
  ingest: "q.kind.ingest",
  contradiction: "q.kind.contradiction",
  lint: "q.kind.lint",
  review: "q.kind.review",
  release: "q.kind.release",
};

/** The option that says yes (include, approve) is the one primary action on a card. */
const isPrimary = (action: string) =>
  /^(ingest|approve|accept|prefer|release|include)/.test(action);

const POSITIVE = /^(ingest|approve|accept|release|include)/;

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
