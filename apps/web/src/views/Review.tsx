import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { Chip, Empty, ErrorBox, Eyebrow, fmtDate, PageHead, PlaneBadge } from "../components/ui";
import { useApp } from "../state";
import type { Candidate } from "../types";
import { useApi } from "../useApi";

export function CandidateDetail({ c, onDone }: { c: Candidate; onDone: (msg: string) => void }) {
  const { openNode } = useApp();
  const [comment, setComment] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setComment("");
    setAsking(false);
    setErr(null);
  }, [c.id, c.revision]);

  const run = async (kind: "approve" | "changes") => {
    setBusy(true);
    setErr(null);
    try {
      const res =
        kind === "approve"
          ? await api.act({ nodeId: c.nodeId, action: "approve_release", revision: c.revision })
          : await api.act({
              nodeId: c.nodeId,
              action: "review",
              revision: c.revision,
              payload: { decision: "request_changes", comment: comment.trim() },
            });
      onDone(
        kind === "approve"
          ? `Approved ${c.revision}. Receipt ${res.receiptId}.`
          : `Changes requested. Receipt ${res.receiptId}.`,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : "The action failed.");
    } finally {
      setBusy(false);
    }
  };

  const tp = c.twoPerson;
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
          By {c.author} · submitted {fmtDate(c.submittedAt)} ·{" "}
          <button type="button" className="linkbtn" onClick={() => openNode(c.nodeId)}>
            Open node
          </button>
        </p>
      </div>

      <div className="exact">
        <strong>Exact revision {c.revision}.</strong>{" "}
        {c.previousRevision ? `Compared with ${c.previousRevision}. ` : "First revision. "}
        Your decision applies to this revision only. If the author changes it, you review again.
      </div>

      <section aria-labelledby="diff-h">
        <Eyebrow>
          {c.previousRevision
            ? `Changes from ${c.previousRevision} to ${c.revision}`
            : "Proposed content"}
        </Eyebrow>
        <div
          className="diff"
          id="diff-h"
          style={{ marginTop: 8 }}
          role="group"
          aria-label="Revision diff"
        >
          {c.diff.map((d, i) => (
            <div key={i} className={d.type}>
              <span className="sign" aria-hidden>
                {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
              </span>
              <span>
                {d.type === "add" ? (
                  <span className="sr-only">Added: </span>
                ) : d.type === "del" ? (
                  <span className="sr-only">Removed: </span>
                ) : null}
                {d.text}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="flags-h">
        <Eyebrow>Sensitivity flags (R-111)</Eyebrow>
        <div id="flags-h" className="stack" style={{ marginTop: 8 }}>
          {c.flags.length === 0 ? (
            <p className="muted">
              No sensitive spans were flagged. Read the content yourself before you approve.
            </p>
          ) : (
            c.flags.map((f, i) => (
              <div className="flag" key={i}>
                <div className="row">
                  <ShieldAlert size={15} aria-hidden color="#ffb547" />
                  <strong>{f.kind}</strong>
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
        <Eyebrow>Approval status</Eyebrow>
        <p id="tp-h" style={{ marginTop: 6 }}>
          {tp.required ? (
            <>
              <Chip tone={tp.approvals >= tp.needed ? "done" : "progress"}>Two-person rule</Chip>{" "}
              {tp.approvals} of {tp.needed} approvals recorded.
            </>
          ) : (
            <>
              One approval is enough for this scope. {tp.approvals} of {tp.needed} recorded.
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="dec-h" className="stack">
        <Eyebrow>Your decision</Eyebrow>
        <div id="dec-h" className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!c.approve.allowed || busy}
            aria-describedby={c.approve.allowed ? undefined : "approve-why"}
            onClick={() => run("approve")}
          >
            Approve {c.revision}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!c.requestChanges.allowed || busy}
            aria-describedby={c.requestChanges.allowed ? undefined : "changes-why"}
            onClick={() => setAsking(true)}
          >
            Request changes
          </button>
        </div>
        {!c.approve.allowed ? (
          <div className="reason" id="approve-why">
            Approve is off: {c.approve.reason}
          </div>
        ) : null}
        {!c.requestChanges.allowed ? (
          <div className="reason" id="changes-why">
            Request changes is off: {c.requestChanges.reason}
          </div>
        ) : null}
        {asking && c.requestChanges.allowed ? (
          <div className="stack">
            <div className="field">
              <label htmlFor="rc">What needs to change</label>
              <textarea
                id="rc"
                className="textarea"
                style={{ minHeight: 100 }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Be specific. The author sees this text."
              />
            </div>
            <div className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => run("changes")}>
                Send request
              </button>
              <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {err ? <ErrorBox message={err} /> : null}
      </section>
    </article>
  );
}

export function Review() {
  const state = useApi(() => api.review(), []);
  const { say } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const list = state.data?.candidates ?? [];
  const current = list.find((c) => c.id === sel) ?? list[0];

  return (
    <div className="page">
      <PageHead
        eyebrow="Review"
        title={
          <>
            Approve what is <em>ready.</em>
          </>
        }
        lead="Candidates in your review scope. Self-approval is blocked, and some scopes need two people."
      />
      {state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : null}
      {!state.error && !state.loading && list.length === 0 ? (
        <Empty title="Nothing is waiting for you">
          Your review queue is empty, or your role has no review scope.
        </Empty>
      ) : null}
      {list.length > 0 ? (
        <div className="split">
          <ul
            className="stack"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label="Review queue"
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
                    {c.scopeLabel} · {c.revision} · {c.author}
                  </span>
                  <span className="row">
                    {c.flags.length > 0 ? <Chip tone="attn">{c.flags.length} flagged</Chip> : null}
                    {!c.approve.allowed ? <Chip tone="risk">You cannot approve</Chip> : null}
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
          {current ? (
            <CandidateDetail
              key={`${current.id}-${current.twoPerson.approvals}`}
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
