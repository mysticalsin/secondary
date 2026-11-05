import { Check, FolderTree, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api";
import { Await } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { BrainFrame } from "./shared";
import type { CoachProposal, CoachQuestion, CoachView } from "./types";

type Answers = Record<string, string | string[]>;

function Preview({ p }: { p: CoachProposal }) {
  const { t } = useI18n();
  return (
    <div className="tree-preview" data-testid="coach-preview">
      <p className="muted">{p.rationale}</p>
      <ul className="ptree" aria-label={t("b3.coach.tree")}>
        <li>
          <span className="ptree-root">
            <FolderTree size={16} aria-hidden /> {t(`b3.tpl.${p.template}` as never)}
          </span>
          <ul>
            {p.collections.map((c) => (
              <li key={c.type} className={c.action}>
                <span>{c.label}</span>
                <span className={`chip t-${c.action === "add" ? "progress" : "done"}`}>
                  {t(c.action === "add" ? "b3.coach.add" : "b3.coach.keep")}
                </span>
                {c.required.length ? (
                  <span className="muted ptree-req">{c.required.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}

/** Chat-style interview. It only proposes. Nothing changes until a manager applies the tree. */
export function CoachChat({
  id,
  view,
  manages,
}: {
  id: string;
  view: CoachView;
  manages: boolean;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<CoachProposal | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const qs = view.questions;
  const q: CoachQuestion | undefined = qs[i];
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [i, proposal, created]);

  const answer = (qq: CoachQuestion, raw: string) => {
    const v = raw.trim();
    if (!v) return;
    setAnswers((a) => ({
      ...a,
      [qq.id]:
        qq.kind === "list"
          ? v
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : v,
    }));
    setDraft("");
    setI((n) => n + 1);
  };
  const show = (qq: CoachQuestion) => {
    const a = answers[qq.id];
    return Array.isArray(a) ? a.join(", ") : (a ?? "");
  };
  const propose = async () => {
    setBusy(true);
    setErr(null);
    try {
      setProposal(await v3.propose(id, answers));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!proposal || !manages) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await v3.apply(id, proposal.proposalId, proposal.hash);
      setCreated(r.created);
      say(t("b3.coach.applied", { n: r.created.length }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setI(0);
    setAnswers({});
    setProposal(null);
    setCreated(null);
  };
  const done = i >= qs.length;

  return (
    <section className="coach card" aria-labelledby="coach-h">
      <h3 id="coach-h">{t("b3.coach.title")}</h3>
      <p className="muted">{t("b3.coach.lead")}</p>
      <div className="chat" role="log" aria-label={t("b3.coach.log")}>
        {qs.slice(0, Math.min(i + 1, qs.length)).map((qq, n) => (
          <div key={qq.id} className="chat-turn">
            <p className="msg bot">{qq.prompt}</p>
            {n < i ? <p className="msg me">{show(qq)}</p> : null}
          </div>
        ))}
        {done && !proposal ? <p className="msg bot">{t("b3.coach.ready")}</p> : null}
        {proposal ? (
          <div className="chat-turn">
            <p className="msg bot">{t("b3.coach.proposal")}</p>
            <Preview p={proposal} />
          </div>
        ) : null}
        {created ? (
          <p className="msg bot ok" role="status">
            <Check size={14} aria-hidden /> {t("b3.coach.applied", { n: created.length })}{" "}
            <Link to={`/brains/${encodeURIComponent(id)}`}>{t("b3.imp.back")}</Link>
          </p>
        ) : null}
        <div ref={end} />
      </div>
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}

      {q && !proposal ? (
        q.kind === "choice" ? (
          <div className="pills chat-opts" role="group" aria-label={q.prompt}>
            {(q.options ?? []).map((o) => (
              <button key={o} type="button" className="pill" onClick={() => answer(q, o)}>
                {o}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="chat-in row"
            onSubmit={(e) => {
              e.preventDefault();
              answer(q, draft);
            }}
          >
            <div className="field grow">
              <label htmlFor="coach-in">
                {q.kind === "list" ? t("b3.coach.in.list") : t("b3.coach.in.text")}
              </label>
              <input
                id="coach-in"
                className="input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <button type="submit" className="btn" disabled={!draft.trim()}>
              <Send size={14} aria-hidden /> {t("b3.coach.send")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setI((n) => n + 1)}>
              {t("b3.coach.skip")}
            </button>
          </form>
        )
      ) : null}

      {done && !proposal ? (
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={propose}>
            {busy ? t("common.working") : t("b3.coach.propose")}
          </button>
          <button type="button" className="btn ghost" onClick={reset}>
            {t("b3.coach.restart")}
          </button>
        </div>
      ) : null}
      {proposal && !created ? (
        <div className="row">
          {manages ? (
            <button type="button" className="btn primary" disabled={busy} onClick={apply}>
              {busy ? t("common.working") : t("b3.coach.apply")}
            </button>
          ) : (
            <p className="muted" role="note">
              {t("b3.coach.nomanage")}
            </p>
          )}
          <button type="button" className="btn ghost" onClick={reset}>
            {t("b3.coach.restart")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function CoachPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  return (
    <BrainFrame id={id} tab="coach">
      {(b) =>
        b.manages ? (
          <CoachLoader id={id} />
        ) : (
          <div className="banner info" role="note">
            {t("b3.coach.nomanage")}
          </div>
        )
      }
    </BrainFrame>
  );
}

function CoachLoader({ id }: { id: string }) {
  const view = useApi(() => v3.coach(id), [id]);
  return (
    <Await state={view} skeleton={2}>
      {(v) => <CoachChat id={id} view={v} manages />}
    </Await>
  );
}
