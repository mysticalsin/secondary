import { ExternalLink, Lock, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../lib/focus";
import { useApp } from "../state";
import type { Counts, NodeAction, NodeDetail } from "../types";
import { useApi } from "../useApi";
import { ActionForm, FORM_ACTIONS } from "./ActionForm";
import { Await, Chip, fmtRev, PlaneBadge, statusTone, useStatus } from "./ui";

const GROUPS: NodeAction["group"][] = ["Collaborate", "Govern", "Admin"];

export interface ActionFeedback {
  action: string;
  ok: boolean;
  text: string;
}

function CountsBlock({ counts }: { counts: Counts | null }) {
  const { t } = useI18n();
  if (!counts) {
    return <p className="muted">{t("dr.counts.hidden")}</p>;
  }
  const cells: [string, number][] = [
    [t("dr.counts.items"), counts.items],
    [t("dr.counts.topics"), counts.topics],
    [t("dr.counts.open"), counts.open],
    [t("dr.counts.gaps"), counts.gaps],
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
  form,
}: {
  detail: NodeDetail;
  onOpen: (id: string) => void;
  onAct: (a: NodeAction) => void;
  feedback?: ActionFeedback | null;
  /** Inline input form for the action in progress (comment, edit, contribute). */
  form?: ReactNode;
}) {
  const { t, td } = useI18n();
  const sl = useStatus();
  const { node } = detail;
  const locked = node.access === "locked";
  const ai = node.facts["AI processing"];
  const askReason = !ai || ai === "allowed" ? t("dr.ask.off") : t("dr.ask.ai", { state: sl(ai) });
  return (
    <div className="drawer-body">
      <div className="stack">
        <div className="row">
          <span className="chip t-open">{td("nodekind", node.kind, node.kind)}</span>
          <PlaneBadge plane={node.plane} />
          {locked ? (
            <span className="chip t-risk">
              <Lock size={12} aria-hidden /> {t("common.locked")}
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
        {locked ? <p className="muted">{t("dr.locked.note")}</p> : null}
      </div>

      {!locked ? (
        <section aria-labelledby="dr-counts">
          <h4 id="dr-counts" className="eyebrow section-title">
            {t("dr.counts")}
          </h4>
          <CountsBlock counts={node.counts} />
        </section>
      ) : null}

      {Object.keys(node.facts).length > 0 ? (
        <section aria-labelledby="dr-facts">
          <h4 id="dr-facts" className="eyebrow section-title">
            {t("dr.facts")}
          </h4>
          <dl className="kv">
            {Object.entries(node.facts).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{td("fact", k, k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="dr-actions">
        <h4 id="dr-actions" className="eyebrow section-title">
          {t("dr.actions")}
        </h4>
        {GROUPS.map((g) => {
          const list = detail.actions.filter((a) => a.group === g);
          if (list.length === 0) return null;
          return (
            <div className="action-group" key={g}>
              <div className="muted" style={{ fontWeight: 700, fontSize: 14 }}>
                {td("group", g, g)}
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
                        {td("action", a.action, a.label)}
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
        {form}
      </section>

      {detail.comments && detail.comments.length > 0 ? (
        <section aria-labelledby="dr-comments">
          <h4 id="dr-comments" className="eyebrow section-title">
            {t("dr.comments")}
          </h4>
          {detail.comments.map((c) => (
            <p className="itemrow" key={c.id}>
              {c.text}
            </p>
          ))}
        </section>
      ) : null}

      {detail.items.length > 0 ? (
        <section aria-labelledby="dr-items">
          <h4 id="dr-items" className="eyebrow section-title">
            {t("dr.items")}
          </h4>
          {detail.items.map((it) => (
            <div className="itemrow" key={`${it.title}-${it.revision}`}>
              <strong>{it.title}</strong>
              <div className="meta">
                <Chip tone={statusTone(it.evidence)}>
                  {t("dr.evidence", { state: sl(it.evidence) })}
                </Chip>
                <span>{it.source}</span>
                <span>{it.ownerRole}</span>
                <span>{fmtRev(it.revision)}</span>
                {it.reviewedBy2 ? <Chip tone="done">{t("dr.twoperson")}</Chip> : null}
              </div>
              <div>
                <button type="button" className="btn sm ghost" disabled aria-describedby="src-off">
                  <ExternalLink size={14} aria-hidden /> {t("dr.source")}
                </button>
              </div>
            </div>
          ))}
          <p className="reason" id="src-off">
            {t("dr.source.off")}
          </p>
        </section>
      ) : null}

      {detail.backlinks.length > 0 ? (
        <section aria-labelledby="dr-links">
          <h4 id="dr-links" className="eyebrow section-title">
            {t("dr.linked")}
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
          {t("dr.ask")}
        </h4>
        <button type="button" className="btn sm ghost" disabled aria-describedby="ask-reason">
          <Sparkles size={14} aria-hidden /> {t("dr.ask")}
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
  const { t, td } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  // On a phone the drawer is a sheet over the page: keep focus inside it and give focus back on close.
  const [sheet, setSheet] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 900px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq) return;
    const on = () => setSheet(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useFocusTrap(boxRef, sheet && !!drawerId);
  const nav = useNavigate();
  const state = useApi(
    () => (drawerId ? api.node(drawerId) : Promise.reject(new Error("none"))),
    [drawerId],
  );
  const [fb, setFb] = useState<ActionFeedback | null>(null);
  const [formAction, setFormAction] = useState<"comment" | "edit" | "contribute" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Whatever had focus when the drawer opened gets it back when the drawer closes.
  const opener = useRef<Element | null>(null);
  if (opener.current === null && typeof document !== "undefined")
    opener.current = document.activeElement;
  useEffect(
    () => () => {
      const el = opener.current;
      if ((el instanceof HTMLElement || el instanceof SVGElement) && document.contains(el))
        el.focus();
    },
    [],
  );

  useEffect(() => {
    setFb(null);
    setFormAction(null);
    closeRef.current?.focus();
  }, [drawerId]);

  if (!drawerId) return null;

  const act = async (a: NodeAction) => {
    if (a.action === "review" || a.action === "approve_release") {
      nav("/review");
      return;
    }
    if (FORM_ACTIONS.includes(a.action)) {
      setFb(null);
      setFormAction(a.action as "comment" | "edit" | "contribute");
      return;
    }
    try {
      const res = await api.act({ nodeId: drawerId, action: a.action });
      const text = t("dr.done", { receipt: res.receiptId });
      setFb({ action: a.action, ok: true, text });
      say(t("dr.said", { label: td("action", a.action, a.label), receipt: res.receiptId }));
    } catch (e) {
      setFb({
        action: a.action,
        ok: false,
        text: e instanceof ApiError ? e.reason : t("common.failed"),
      });
    }
  };

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is dialog on a phone and complementary beside the page
    <div
      className="drawer"
      ref={boxRef}
      aria-label={t("common.details")}
      role={sheet ? "dialog" : "complementary"}
      aria-modal={sheet ? true : undefined}
    >
      <div className="drawer-grip" aria-hidden />
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">{t("common.details")}</div>
          <h3>
            {state.data
              ? state.data.node.label
              : state.error
                ? t("dr.unavailable")
                : t("common.loading")}
          </h3>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          onClick={closeDrawer}
          aria-label={t("dr.close")}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <Await state={state}>
        {(d) => (
          <NodeDetailView
            detail={d}
            onOpen={openNode}
            onAct={act}
            feedback={fb}
            form={
              formAction ? (
                <ActionForm
                  key={formAction}
                  action={formAction}
                  nodeId={drawerId}
                  detail={d}
                  onCancel={() => setFormAction(null)}
                  onDone={(text) => {
                    setFormAction(null);
                    setFb({ action: formAction, ok: true, text });
                    say(text);
                    state.reload();
                  }}
                />
              ) : null
            }
          />
        )}
      </Await>
    </div>
  );
}
