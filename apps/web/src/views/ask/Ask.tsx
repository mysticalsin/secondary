import { ArrowUp, BookOpen, FilePlus2, Lock } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../api";
import { ViewRenderer } from "../../genui/ViewRenderer";
import { type Key, useI18n } from "../../i18n";
import { AnswerMd } from "../../lib/md";
import { useReveal } from "../../lib/reveal";
import { useApp } from "../../state";
import type { ViewPlan } from "../../types";
import { askStream } from "../../uxv2/api";
import type { AskCitation, AskUsage } from "../../uxv2/types";

interface Run {
  question: string;
  status: "streaming" | "done" | "error";
  stage: string | null;
  citations: AskCitation[];
  plan: ViewPlan | null;
  answer: { markdown: string; unknown: boolean } | null;
  usage: AskUsage | null;
  error: string | null;
}

const ROLE_IDEAS: Record<string, [Key, Key, Key]> = {
  ceo: ["ask.q.ceo.1", "ask.q.ceo.2", "ask.q.ceo.3"],
  head_bid: ["ask.q.bid.1", "ask.q.bid.2", "ask.q.bid.3"],
  acme_lead: ["ask.q.acct.1", "ask.q.acct.2", "ask.q.acct.3"],
  consultant: ["ask.q.cons.1", "ask.q.cons.2", "ask.q.cons.3"],
  reviewer: ["ask.q.rev.1", "ask.q.rev.2", "ask.q.rev.3"],
  platform_admin: ["ask.q.adm.1", "ask.q.adm.2", "ask.q.adm.3"],
  auditor: ["ask.q.adm.1", "ask.q.adm.2", "ask.q.adm.3"],
};
const DEFAULT_IDEAS: [Key, Key, Key] = ["ask.q.def.1", "ask.q.def.2", "ask.q.def.3"];

const STAGE_KEY: Record<string, Key> = {
  index: "ask.stage.index",
  read: "ask.stage.read",
  write: "ask.stage.write",
};

export function brainLink(c: { workspaceId: string; pageId: string }): string {
  return `/brain?ws=${encodeURIComponent(c.workspaceId)}&page=${encodeURIComponent(c.pageId)}`;
}

function Answer({ run, onRetry }: { run: Run; onRetry: () => void }) {
  const { t } = useI18n();
  const { say } = useApp();
  const md = run.answer?.markdown ?? "";
  const { shown, revealing } = useReveal(md, !!run.answer && !run.answer.unknown);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    try {
      await api.personalCreate({
        title: run.question.slice(0, 120),
        body: `${md}\n\n${run.citations.map((c) => `- ${c.title}`).join("\n")}`,
        kind: "note",
      });
      setSaved(true);
      say(t("ask.saved"));
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("ask.failed"));
    }
  };

  if (run.status === "error")
    return (
      <div className="errorbox" role="alert">
        <div>{run.error}</div>
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={onRetry}>
          {t("common.retry")}
        </button>
      </div>
    );

  if (run.answer?.unknown)
    return (
      <div className="unknown assemble" data-testid="unknown">
        <Lock size={18} aria-hidden />
        <div>
          <h3>{t("ask.unknown.title")}</h3>
          <p>{t("ask.unknown.lead")}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn" to="/personal?new=1">
              <FilePlus2 size={16} aria-hidden /> {t("ask.unknown.capture")}
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    <>
      {run.answer ? (
        <div className="answer" data-testid="answer">
          <div className="answer-text" aria-hidden={revealing}>
            <AnswerMd md={shown} />
            {revealing ? <span className="caret" aria-hidden /> : null}
          </div>
          {revealing ? (
            <div className="sr-only" role="status">
              {md}
            </div>
          ) : null}
        </div>
      ) : null}
      {run.citations.length ? (
        <div className="cites" role="group" aria-label={t("ask.sources")}>
          {run.citations.map((c, i) => (
            <Link
              key={`${c.workspaceId}:${c.pageId}`}
              className="cite-chip assemble"
              style={{ animationDelay: `${i * 70}ms` }}
              to={brainLink(c)}
            >
              <BookOpen size={14} aria-hidden />
              {c.title}
            </Link>
          ))}
        </div>
      ) : null}
      {run.plan && !revealing ? (
        <div className="cards assemble">
          <ViewRenderer plan={run.plan} />
        </div>
      ) : null}
      {run.status === "done" && run.answer && !revealing ? (
        <div className="row">
          <button type="button" className="btn sm ghost" onClick={save} disabled={saved}>
            {saved ? t("ask.savedbtn") : t("ask.save")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function UsageFooter({ u }: { u: AskUsage }) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  return (
    <footer className="usage-foot" data-testid="usage-foot">
      <p>
        <span>{t("ask.usage.used", { n: nf.format(u.inputTokens + u.outputTokens) })}</span>
        <span className="saved">{t("ask.usage.saved", { pct: Math.round(u.savedPct) })}</span>
      </p>
      <details>
        <summary>{t("ask.usage.how")}</summary>
        <p className="muted">
          {t("ask.usage.detail", {
            read: nf.format(u.indexTokensRead),
            full: nf.format(u.fullContextEstimate),
          })}{" "}
          {u.processor === "anthropic" ? t("ask.proc.ai") : t("ask.proc.det")}
        </p>
      </details>
    </footer>
  );
}

export function Ask() {
  const { t } = useI18n();
  const { me } = useApp();
  const role = me?.principal.roleIds[0] ?? "";
  const ideas = ROLE_IDEAS[role] ?? DEFAULT_IDEAS;
  const [text, setText] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const ask = useCallback(
    async (question: string) => {
      const qn = question.trim();
      if (!qn) return;
      abort.current?.abort();
      setText("");
      const ctl = new AbortController();
      abort.current = ctl;
      setRun({
        question: qn,
        status: "streaming",
        stage: null,
        citations: [],
        plan: null,
        answer: null,
        usage: null,
        error: null,
      });
      try {
        for await (const ev of askStream(qn, ctl.signal)) {
          if (ctl.signal.aborted) return;
          setRun((r) => {
            if (!r) return r;
            switch (ev.event) {
              case "status":
                return { ...r, stage: ev.data.stage };
              case "citation":
                return { ...r, citations: [...r.citations, ev.data] };
              case "plan":
                return { ...r, plan: ev.data };
              case "answer":
                return { ...r, answer: ev.data };
              case "usage":
                return { ...r, usage: ev.data };
              case "done":
                return { ...r, status: "done", stage: null };
              default:
                return r;
            }
          });
        }
        setRun((r) => (r && r.status === "streaming" ? { ...r, status: "done", stage: null } : r));
      } catch (e) {
        if (ctl.signal.aborted) return;
        setRun((r) =>
          r
            ? {
                ...r,
                status: "error",
                error: e instanceof ApiError ? e.reason : t("ask.failed"),
              }
            : r,
        );
      }
    },
    [t],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  const streaming = run?.status === "streaming";
  const stageText = run?.stage
    ? t(STAGE_KEY[run.stage] ?? "ask.stage.index", { n: run.citations.length })
    : t("ask.stage.index");

  return (
    <div className="page ask-page" data-started={run ? "1" : "0"}>
      <section aria-labelledby="ask-title" className="ask-hero">
        <h2 id="ask-title">{t("ask2.title")}</h2>
        <form onSubmit={submit} className="ask-form" role="search">
          <label htmlFor="ask-input" className="sr-only">
            {t("ask.label")}
          </label>
          <input
            id="ask-input"
            ref={input}
            className="ask-input"
            placeholder={run ? t("ask2.ph.next") : t("ask2.ph")}
            value={text}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className="ask-go"
            disabled={streaming || !text.trim()}
            aria-label={t("ask2.send")}
          >
            <ArrowUp size={22} aria-hidden />
          </button>
        </form>
        {!run ? (
          <ul className="ideas" aria-label={t("ask2.ideas")}>
            {ideas.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => {
                    setText(t(k));
                    void ask(t(k));
                  }}
                >
                  {t(k)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {run ? (
        <section className="ask-result" aria-label={t("ask2.result")} aria-busy={streaming}>
          <h3 className="ask-q">{run.question}</h3>
          {streaming && !run.answer ? (
            <p className="stage" role="status" data-testid="stage">
              <span className="pulse" aria-hidden />
              {stageText}
            </p>
          ) : null}
          <Answer run={run} onRetry={() => void ask(run.question)} />
          {run.usage ? <UsageFooter u={run.usage} /> : null}
        </section>
      ) : null}
    </div>
  );
}
