import { ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import {
  Chip,
  Empty,
  ErrorBox,
  Eyebrow,
  fmtDate,
  fmtRev,
  PageHead,
  PlaneBadge,
  Skeleton,
} from "../components/ui";
import { useI18n } from "../i18n";
import { diffStats, lineDiff } from "../lib/diff";
import { whoIs } from "../personas";
import { useApp } from "../state";
import type { Candidate } from "../types";
import { useApi } from "../useApi";
import { wikiWsOf } from "./wiki/api";
import { useWho, WikiProposalDetail } from "./wiki/WikiProposalDetail";

/** Candidate ids look like cand:<targetNodeId>:<8 hex>. The node to open is the target. */
const targetOf = (id: string) => /^cand:(.+):[0-9a-f]{8}$/.exec(id)?.[1] ?? id;

function Diff({ before, after }: { before: string | null; after: string }) {
  const { t } = useI18n();
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const st = diffStats(lines);
  if (before === null && !after.trim()) return <p className="muted">{t("review.diff.empty")}</p>;
  return (
    <>
      <p className="muted" style={{ fontSize: 14 }}>
        {before === null
          ? t("review.diff.first", { n: st.added })
          : t("review.diff.stats", { added: st.added, removed: st.removed })}
      </p>
      <div className="diff" role="group" aria-label={t("review.diff.aria")}>
        {lines.map((d, i) => (
          // The diff is static once built, so index keys are stable.
          <div key={`${i}-${d.type}`} className={d.type}>
            <span className="sign" aria-hidden>
              {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
            </span>
            <span>
              {d.type === "add" ? <span className="sr-only">{t("review.diff.added")} </span> : null}
              {d.type === "del" ? (
                <span className="sr-only">{t("review.diff.removed")} </span>
              ) : null}
              {d.text || " "}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export function CandidateDetail({ c, onDone }: { c: Candidate; onDone: (msg: string) => void }) {
  const { openNode } = useApp();
  const { t, td, tn } = useI18n();
  const who = (id: string) => whoIs(id, (rid, f) => td("role", rid, f));
  const detail = useApi(() => api.reviewDetail(c.nodeId), [c.nodeId, c.revision]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setNote("");
    setAsking(false);
    setErr(null);
  }, [c.id, c.revision]);

  const run = async (kind: "approve" | "changes") => {
    setBusy(true);
    setErr(null);
    try {
      if (kind === "approve") {
        const res = await api.act({
          nodeId: c.nodeId,
          action: "approve_release",
          revision: Number(c.revision),
        });
        onDone(t("review.done.approved", { rev: fmtRev(c.revision), receipt: res.receiptId }));
      } else {
        await api.reviewDecide(c.nodeId, {
          revision: Number(c.revision),
          verdict: "changes_requested",
          comment: reason.trim(),
        });
        onDone(t("review.done.changes"));
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.reviewComment(c.nodeId, note.trim());
      setNote("");
      detail.reload();
    } catch (x) {
      setErr(x instanceof ApiError ? x.reason : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const d = detail.data;
  const tp = d?.twoPerson ?? c.twoPerson;
  const mineDecision = d?.decisions.find((x) => x.mine);
  return (
    <article className="card stack" aria-labelledby="cand-h" style={{ gap: 20 }}>
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <PlaneBadge plane={c.plane} />
          <span className="muted">{c.scopeLabel}</span>
        </div>
        <h3 id="cand-h" style={{ marginBottom: 4 }}>
          {c.title}
        </h3>
        <p className="muted">
          {t("review.by", { who: who(c.author), date: fmtDate(c.submittedAt) })} ·{" "}
          <button type="button" className="linkbtn" onClick={() => openNode(targetOf(c.nodeId))}>
            {t("review.opennode")}
          </button>
        </p>
      </div>

      <div className="exact">
        <strong>{t("review.exact", { rev: fmtRev(c.revision) })}</strong>{" "}
        {d?.previous
          ? t("review.compared", { rev: fmtRev(d.previous.revision) })
          : t("review.firstrev")}{" "}
        {t("review.exact.note")}
      </div>

      <section aria-labelledby="diff-h">
        <Eyebrow>
          <span id="diff-h">
            {d?.previous
              ? t("review.changes", {
                  from: fmtRev(d.previous.revision),
                  to: fmtRev(d.current.revision),
                })
              : t("review.proposed")}
          </span>
        </Eyebrow>
        <div style={{ marginTop: 8 }}>
          {detail.loading && !d ? (
            <Skeleton n={2} />
          ) : d ? (
            <Diff before={d.previous ? d.previous.body : null} after={d.current.body} />
          ) : (
            <Diff before={null} after={c.diff.map((x) => x.text).join("\n")} />
          )}
        </div>
      </section>

      <section aria-labelledby="flags-h">
        <Eyebrow>
          <span id="flags-h">{t("review.flags")}</span>
        </Eyebrow>
        <div className="stack" style={{ marginTop: 8 }}>
          {c.flags.length === 0 ? (
            <p className="muted">{t("review.flags.none")}</p>
          ) : (
            c.flags.map((f, i) => (
              // Flags are a fixed list per revision.
              <div className="flag" key={`${f.kind}-${i}`}>
                <div className="row">
                  <ShieldAlert size={15} aria-hidden color="#ffb547" />
                  <strong>{td("flag", f.kind, f.kind)}</strong>
                </div>
                <div>
                  <mark>{f.span}</mark>
                </div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {f.reason}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="tp-h">
        <Eyebrow>
          <span id="tp-h">{t("review.approval")}</span>
        </Eyebrow>
        <p style={{ marginTop: 6 }}>
          {tp.required ? (
            <>
              <Chip tone={tp.approvals >= tp.needed ? "done" : "progress"}>
                {t("review.twoperson")}
              </Chip>{" "}
              {t("review.approvals", { n: tp.approvals, needed: tp.needed })}
            </>
          ) : (
            t("review.oneapproval", { n: tp.approvals, needed: tp.needed })
          )}
        </p>
        {d && d.decisions.length > 0 ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {d.decisions.map((x) => (
              <li key={`${x.actorId}-${x.kind}-${x.at}`} className="muted">
                {x.mine ? t("review.you") : who(x.actorId)} ·{" "}
                {x.kind === "approved"
                  ? t("review.d.approved")
                  : x.kind === "changes_requested"
                    ? t("review.d.changes")
                    : t("review.d.reviewed")}{" "}
                · {fmtDate(x.at)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="thread-h" className="stack">
        <Eyebrow>
          <span id="thread-h">{t("review.thread")}</span>
        </Eyebrow>
        {d && d.comments.length > 0 ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {d.comments.map((m) => (
              <li key={m.id} className="itemrow">
                <div className="muted" style={{ fontSize: 14 }}>
                  {m.mine ? t("review.you") : who(m.authorId)} · {fmtDate(m.at)}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {detail.loading && !d ? t("common.loading") : t("review.thread.none")}
          </p>
        )}
        <form onSubmit={addNote} className="stack">
          <div className="field">
            <label htmlFor="rv-note">{t("review.addcomment")}</label>
            <textarea
              id="rv-note"
              className="textarea"
              style={{ minHeight: 70 }}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div>
            <button type="submit" className="btn sm" disabled={busy || !note.trim()}>
              {t("review.postcomment")}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="dec-h" className="stack">
        <Eyebrow>
          <span id="dec-h">{t("review.decision")}</span>
        </Eyebrow>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!c.approve.allowed || busy}
            aria-describedby={c.approve.allowed ? undefined : "approve-why"}
            onClick={() => run("approve")}
          >
            {t("review.approve", { rev: fmtRev(c.revision) })}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!c.requestChanges.allowed || busy}
            aria-describedby={c.requestChanges.allowed ? undefined : "changes-why"}
            aria-expanded={asking}
            onClick={() => setAsking(true)}
          >
            {t("review.requestchanges")}
          </button>
        </div>
        {mineDecision?.kind === "changes_requested" ? (
          <p className="muted">{t("review.youasked")}</p>
        ) : null}
        {!c.approve.allowed ? (
          <div className="reason" id="approve-why">
            {t("review.approve.off", { why: c.approve.reason })}
          </div>
        ) : null}
        {!c.requestChanges.allowed ? (
          <div className="reason" id="changes-why">
            {t("review.changes.off", { why: c.requestChanges.reason })}
          </div>
        ) : null}
        {asking && c.requestChanges.allowed ? (
          <div className="stack">
            <div className="field">
              <label htmlFor="rc">{t("review.rc.label")}</label>
              <textarea
                id="rc"
                className="textarea"
                style={{ minHeight: 100 }}
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("review.rc.ph")}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={busy || !reason.trim()}
                onClick={() => run("changes")}
              >
                {t("review.rc.send")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
        {err ? <ErrorBox message={err} /> : null}
        <p className="muted" style={{ fontSize: 14 }}>
          {tn(tp.needed, "review.rule.one", "review.rule.other", { n: tp.needed })}
        </p>
      </section>
    </article>
  );
}

export function Review() {
  const state = useApi(() => api.review(), []);
  const { say } = useApp();
  const { t, td } = useI18n();
  const wikiWho = useWho();
  const [sel, setSel] = useState<string | null>(null);
  const list = state.data ?? [];
  const current = list.find((c) => c.id === sel) ?? list[0];

  return (
    <div className="page">
      <PageHead
        eyebrow={t("nav.review")}
        title={
          <>
            {t("review.title.a")} <em>{t("review.title.b")}</em>
          </>
        }
        lead={t("review.lead")}
      />
      {state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : null}
      {!state.error && !state.loading && list.length === 0 ? (
        <Empty title={t("review.empty.title")}>{t("review.empty.body")}</Empty>
      ) : null}
      {list.length > 0 ? (
        <div className="split">
          <ul
            className="stack"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label={t("review.queue")}
          >
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="qitem"
                  aria-current={current?.id === c.id}
                  onClick={() => setSel(c.id)}
                >
                  <strong>{c.title}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {c.scopeLabel} ·{" "}
                    {c.kind?.startsWith("wiki_")
                      ? td("wiki.kind", c.kind, c.kind)
                      : fmtRev(c.revision)}{" "}
                    ·{" "}
                    {c.kind?.startsWith("wiki_")
                      ? wikiWho(c.author)
                      : whoIs(c.author, (rid, f) => td("role", rid, f))}
                  </span>
                  <span className="row">
                    {c.flags.length > 0 ? (
                      <Chip tone="attn">{t("review.flagged", { n: c.flags.length })}</Chip>
                    ) : null}
                    {!c.approve.allowed ? <Chip tone="risk">{t("review.cannot")}</Chip> : null}
                    {c.twoPerson.required ? (
                      <Chip tone="progress">
                        {c.twoPerson.approvals}/{c.twoPerson.needed}
                      </Chip>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current?.kind?.startsWith("wiki_") ? (
            <WikiProposalDetail
              key={current.id}
              ws={wikiWsOf(targetOf(current.nodeId))}
              id={current.id}
              onDone={(m) => {
                say(m);
                setSel(null);
                state.reload();
              }}
            />
          ) : current ? (
            <CandidateDetail
              key={`${current.id}-${current.twoPerson.approvals}-${current.revision}`}
              c={current}
              onDone={(m) => {
                say(m);
                setSel(null);
                state.reload();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
