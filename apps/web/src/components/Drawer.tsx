import { ExternalLink, Lock, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";
import { useApp } from "../state";
import type { Counts, NodeAction, NodeDetail } from "../types";
import { useApi } from "../useApi";
import { Await, Chip, PlaneBadge, statusTone } from "./ui";

const GROUPS: NodeAction["group"][] = ["Collaborate", "Govern", "Admin"];

export interface ActionFeedback {
  action: string;
  ok: boolean;
  text: string;
}

function CountsBlock({ counts }: { counts: Counts | null }) {
  if (!counts) {
    return <p className="muted">Counts are hidden for this scope.</p>;
  }
  const cells: [string, number][] = [
    ["Items", counts.items],
    ["Topics or accounts", counts.topics],
    ["Open", counts.open],
    ["Gaps", counts.gaps],
  ];
  return (
    <div className="counts">
      {cells.map(([label, v]) => (
        <div className="count" key={label}>
          <b className="num">{v}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function NodeDetailView({
  detail,
  onOpen,
  onAct,
  feedback,
}: {
  detail: NodeDetail;
  onOpen: (id: string) => void;
  onAct: (a: NodeAction) => void;
  feedback?: ActionFeedback | null;
}) {
  const { node } = detail;
  const locked = node.access === "locked";
  const ai = node.facts["AI processing"];
  const askReason = !ai
    ? "Ask this node is not available in this release."
    : ai === "allowed"
      ? "Ask this node is not available in this release."
      : `AI processing is ${ai} for this account. Ask this node stays off.`;
  return (
    <div className="drawer-body">
      <div className="stack">
        <div className="row">
          <span className="chip t-open">{node.kind}</span>
          <PlaneBadge plane={node.plane} />
          {locked ? (
            <span className="chip t-risk">
              <Lock size={12} aria-hidden /> Locked
            </span>
          ) : null}
          {node.badges
            .filter((b) => b !== "Locked")
            .map((b) => (
              <span key={b} className="chip t-attn">
                {b}
              </span>
            ))}
        </div>
        {locked ? (
          <p className="muted">
            You can see that this scope exists. Its content and counts stay hidden for your role.
          </p>
        ) : null}
      </div>

      {!locked ? (
        <section aria-labelledby="dr-counts">
          <h4 id="dr-counts" className="eyebrow section-title">
            Counts
          </h4>
          <CountsBlock counts={node.counts} />
        </section>
      ) : null}

      {Object.keys(node.facts).length > 0 ? (
        <section aria-labelledby="dr-facts">
          <h4 id="dr-facts" className="eyebrow section-title">
            Facts
          </h4>
          <dl className="kv">
            {Object.entries(node.facts).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="dr-actions">
        <h4 id="dr-actions" className="eyebrow section-title">
          Actions
        </h4>
        {GROUPS.map((g) => {
          const list = detail.actions.filter((a) => a.group === g);
          if (list.length === 0) return null;
          return (
            <div className="action-group" key={g}>
              <div className="muted" style={{ fontWeight: 700, fontSize: 14 }}>
                {g}
              </div>
              {list.map((a) => {
                const rid = `reason-${a.action}`;
                const fb = feedback?.action === a.action ? feedback : null;
                return (
                  <div className="action-row" key={a.action}>
                    <div>
                      <button
                        type="button"
                        className={a.allowed ? "btn sm" : "btn sm ghost"}
                        disabled={!a.allowed}
                        aria-describedby={a.allowed ? undefined : rid}
                        onClick={() => onAct(a)}
                      >
                        {a.label}
                      </button>
                    </div>
                    {!a.allowed ? (
                      <div className="reason" id={rid}>
                        {a.reason}
                      </div>
                    ) : null}
                    {fb ? (
                      <div className={`reason ${fb.ok ? "ok" : "err"}`} role="status">
                        {fb.text}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      {detail.items.length > 0 ? (
        <section aria-labelledby="dr-items">
          <h4 id="dr-items" className="eyebrow section-title">
            Top items
          </h4>
          {detail.items.map((it) => (
            <div className="itemrow" key={`${it.title}-${it.revision}`}>
              <strong>{it.title}</strong>
              <div className="meta">
                <Chip tone={statusTone(it.evidence)}>Evidence: {it.evidence}</Chip>
                <span>{it.source}</span>
                <span>{it.ownerRole}</span>
                <span>{it.revision}</span>
                {it.reviewedBy2 ? <Chip tone="done">Two-person reviewed</Chip> : null}
              </div>
              <div>
                <button type="button" className="btn sm ghost" disabled aria-describedby="src-off">
                  <ExternalLink size={14} aria-hidden /> Open in source
                </button>
              </div>
            </div>
          ))}
          <p className="reason" id="src-off">
            Open in source is disabled in dev.
          </p>
        </section>
      ) : null}

      {detail.backlinks.length > 0 ? (
        <section aria-labelledby="dr-links">
          <h4 id="dr-links" className="eyebrow section-title">
            Linked from
          </h4>
          <ul className="linklist">
            {detail.backlinks.map((b) => (
              <li key={b.id}>
                <button type="button" className="pill" onClick={() => onOpen(b.id)}>
                  {b.label}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {b.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="dr-ask">
        <h4 id="dr-ask" className="eyebrow section-title">
          Ask this node
        </h4>
        <button type="button" className="btn sm ghost" disabled aria-describedby="ask-reason">
          <Sparkles size={14} aria-hidden /> Ask this node
        </button>
        <p className="reason" id="ask-reason" style={{ marginTop: 6 }}>
          {askReason}
        </p>
      </section>
    </div>
  );
}

export function Drawer() {
  const { drawerId, closeDrawer, openNode, say } = useApp();
  const nav = useNavigate();
  const state = useApi(
    () => (drawerId ? api.node(drawerId) : Promise.reject(new Error("none"))),
    [drawerId],
  );
  const [fb, setFb] = useState<ActionFeedback | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFb(null);
    closeRef.current?.focus();
  }, [drawerId]);

  if (!drawerId) return null;

  const act = async (a: NodeAction) => {
    if (a.action === "review" || a.action === "approve_release") {
      nav("/review");
      return;
    }
    try {
      const res = await api.act({ nodeId: drawerId, action: a.action });
      const text = `Done. Receipt ${res.receiptId}.`;
      setFb({ action: a.action, ok: true, text });
      say(`${a.label}: receipt ${res.receiptId}`);
    } catch (e) {
      setFb({
        action: a.action,
        ok: false,
        text: e instanceof ApiError ? e.reason : "The action failed.",
      });
    }
  };

  return (
    <aside className="drawer" aria-label="Details">
      <div className="drawer-grip" aria-hidden />
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">Details</div>
          <h3>{state.data ? state.data.node.label : state.error ? "Not available" : "Loading"}</h3>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          onClick={closeDrawer}
          aria-label="Close details"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <Await state={state}>
        {(d) => <NodeDetailView detail={d} onOpen={openNode} onAct={act} feedback={fb} />}
      </Await>
    </aside>
  );
}
