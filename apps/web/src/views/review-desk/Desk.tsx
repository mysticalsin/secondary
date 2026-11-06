import { CircleCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorBox } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import { QUESTIONS_CHANGED } from "../waiting/events";
import { useBrainNames } from "../waiting/shared";
import { deskApi } from "./api";
import { HelpDialog } from "./Dialogs";
import { Pane, type PaneActions } from "./Pane";
import { Queue, SELECTABLE } from "./Queue";
import { Strip } from "./Strip";
import type { DeskRow, Section } from "./types";
import "./review.css";
import { useState } from "react";

type Rows = Record<Exclude<Section, "fyi">, DeskRow[]>;

function DeskSkeleton() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="skeleton rv-sk-strip" />
      <div className="rv-grid">
        <div className="rv-sk-col">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton" key={i} style={{ height: 76 }} />
          ))}
        </div>
        <div className="rv-sk-col">
          <div className="skeleton" style={{ height: 220 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
        <div className="rv-sk-col">
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      </div>
    </div>
  );
}

function EmptyArt() {
  return (
    <svg width="120" height="88" viewBox="0 0 120 88" aria-hidden className="rv-art">
      <rect
        x="14"
        y="36"
        width="92"
        height="40"
        rx="10"
        fill="var(--panel-2)"
        stroke="var(--line)"
      />
      <path d="M14 56h28l6 8h24l6-8h28" fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle cx="60" cy="24" r="16" fill="var(--purple)" />
      <path
        d="M52 24l6 6 11-12"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="104" cy="14" r="4" fill="var(--yellow)" />
      <circle cx="18" cy="12" r="3" fill="var(--lilac-4)" />
    </svg>
  );
}

export function Desk() {
  const { t } = useI18n();
  const { say } = useApp();
  const nav = useNavigate();
  const { id: routeId } = useParams();
  const [sp, setSp] = useSearchParams();
  const brain = sp.get("brain") ?? "";
  const names = useBrainNames();
  const desk = useApi(() => deskApi.desk(), []);
  const qs = useApi(() => ux2.questions(), []);
  const [help, setHelp] = useState(false);
  const actions = useRef<PaneActions | null>(null);
  const rowsAll = desk.data?.sections;

  const rows: Rows = useMemo(() => {
    const keep = (r: DeskRow) => !brain || r.brain.id === brain;
    const out = {} as Rows;
    for (const s of SELECTABLE) out[s] = (rowsAll?.[s] ?? []).filter(keep);
    return out;
  }, [rowsAll, brain]);
  const flat = useMemo(() => SELECTABLE.flatMap((s) => rows[s]), [rows]);
  const selId = flat.find((r) => r.id === routeId)?.id ?? flat[0]?.id ?? null;
  const row = flat.find((r) => r.id === selId) ?? null;
  const q = (qs.data ?? []).find((x) => x.id === selId);
  const detail = useApi(
    () => (selId ? deskApi.detail(selId) : Promise.resolve(null)),
    [selId, desk.data?.generatedAt],
  );

  const go = useCallback(
    (id: string | null) =>
      nav(
        `${id ? `/review/${encodeURIComponent(id)}` : "/review"}${brain ? `?brain=${encodeURIComponent(brain)}` : ""}`,
        {
          replace: true,
        },
      ),
    [nav, brain],
  );
  const open = useCallback(() => {
    const h = document.getElementById("rv-focus-h");
    h?.focus();
    h?.scrollIntoView?.({ block: "start" });
  }, []);
  const refresh = useCallback(() => {
    desk.reload();
    qs.reload();
    window.dispatchEvent(new Event(QUESTIONS_CHANGED));
  }, [desk.reload, qs.reload]);

  const move = useCallback(
    (by: number) => {
      if (!flat.length) return;
      const at = Math.max(
        0,
        flat.findIndex((r) => r.id === selId),
      );
      const next = flat[Math.min(flat.length - 1, Math.max(0, at + by))];
      if (!next) return;
      go(next.id);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-id="${CSS.escape(next.id)}"]`)
          ?.scrollIntoView?.({ block: "nearest" }),
      );
    },
    [flat, selId, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog']")) return;
      const k = e.key === "?" ? "?" : e.key.toLowerCase();
      const a = actions.current;
      if (k === "j") move(1);
      else if (k === "k") move(-1);
      else if (k === "enter" && (el === document.body || !el?.closest("button, a"))) open();
      else if (k === "a") a ? a.approve() : say(t("v8r.nothing.selected"));
      else if (k === "r") a?.requestChanges();
      else if (k === "s") a?.snooze();
      else if (k === "m") a?.mention();
      else if (k === "?") setHelp(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, open, say, t]);

  const decided = useCallback(() => {
    const at = flat.findIndex((r) => r.id === selId);
    const next = flat[at + 1] ?? flat[at - 1] ?? null;
    go(next?.id ?? null);
    refresh();
  }, [flat, selId, go, refresh]);

  return (
    <div className="page v4page rv-page" data-testid="review-desk">
      <header className="rv-head">
        <h1 className="ptitle">{t("v8r.title")}</h1>
        <p className="muted">{t("v8r.lead")}</p>
        <div className="rv-head-r">
          {brain ? (
            <button type="button" className="btn soft sm" onClick={() => setSp({})}>
              {t("v4.waiting.clear", { name: names(brain) })}
            </button>
          ) : null}
          <button type="button" className="btn ghost sm" onClick={() => setHelp(true)}>
            {t("v8r.kbd")}
            <kbd aria-hidden>?</kbd>
          </button>
        </div>
      </header>
      {desk.error || qs.error ? (
        <ErrorBox message={desk.error ?? qs.error ?? ""} onRetry={refresh} />
      ) : !desk.data || !qs.data ? (
        <DeskSkeleton />
      ) : (
        <>
          <Strip desk={desk.data} />
          {flat.length || (!brain && desk.data.sections.fyi.length) ? (
            <div className="rv-grid">
              <Queue
                desk={desk.data}
                rows={rows}
                selectedId={selId}
                onSelect={(id) => {
                  go(id);
                  requestAnimationFrame(open);
                }}
              />
              {row ? (
                <Pane
                  key={`${row.id}:${q?.detail?.revisionHash ?? ""}`}
                  row={row}
                  q={q}
                  detail={detail}
                  actionsRef={actions}
                  onDecided={decided}
                  onChanged={refresh}
                />
              ) : (
                <div className="rv-nopane">
                  <EmptyArt />
                  <h2>{t("v8r.empty.title")}</h2>
                  <p className="muted">{t("v8r.empty.lead")}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rv-empty" data-testid="rv-empty">
              <EmptyArt />
              <h2>{brain ? t("v4.waiting.nomatch") : t("v8r.empty.title")}</h2>
              <p className="muted">{brain ? t("v4.contents.nomatch.lead") : t("v8r.empty.lead")}</p>
              <p className="rv-clear">
                <CircleCheck size={16} aria-hidden />{" "}
                {t("v8r.empty.week", { n: desk.data.kpis.clearedThisWeek })}
              </p>
            </div>
          )}
        </>
      )}
      {help ? <HelpDialog onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

/** `/waiting` and `/waiting/:id` keep working: they land on the desk, brain filter included. */
export function WaitingRedirect() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate replace to={`/review${id ? `/${encodeURIComponent(id)}` : ""}${search}`} />;
}
