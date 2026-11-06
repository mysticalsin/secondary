// The conversation: user messages and live answers, the composer, suggested prompts and the
// per-answer actions (pin, refine, show as table). Used by the slide-over panel and the full page.
import type { ActionEventValue } from "@secondary/contracts/agent-ui";
import { ChartNoAxesColumn, CornerDownLeft, Pin, Sparkles, Square, Table2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";
import { v3 } from "../views/brains/api";
import { useAgentHost } from "./host";
import { PinDialog } from "./PinDialog";
import { AgentRender, countCards } from "./Renderer";
import { type Answer, type SendInput, useAgentThread } from "./useAgentThread";
import { useAgentSettings } from "./useSettings";

const MAX = 500;

function Welcome({ send }: { send: (i: SendInput) => void }) {
  const { t } = useI18n();
  const brains = useApi(() => v3.brains(), []);
  const prompts = useMemo(() => {
    const list = (brains.data?.brains ?? []).filter((b) => b.type !== "personal");
    const name = (b: { name: string }) => b.name;
    const out: string[] = [];
    const a = list[0];
    const b = list[1];
    if (a) out.push(t("v6.suggest.stand", { brain: name(a) }));
    if (b) out.push(t("v6.suggest.week", { brain: name(b) }));
    if (a && b) out.push(t("v6.suggest.compare", { a: name(a), b: name(b) }));
    out.push(t("v6.suggest.overview"));
    return out.slice(0, 4);
  }, [brains.data, t]);
  return (
    <div className="ag-welcome">
      <span className="ag-spark" aria-hidden>
        <Sparkles size={22} />
      </span>
      <p>{t("v6.lead")}</p>
      <h3>{t("v6.suggest")}</h3>
      <ul className="ag-suggest">
        {prompts.map((p) => (
          <li key={p}>
            <button type="button" className="ag-chip" onClick={() => send({ label: p, text: p })}>
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notes({ a }: { a: Answer }) {
  const { t, td, tn } = useI18n();
  const s = useAgentSettings();
  const det = a.mode === "deterministic";
  return (
    <div className="ag-notes">
      {det ? (
        <p className="ag-quiet" data-testid="agent-det-note">
          {td("v6.mode.det", a.reason ?? "", t("v6.mode.det"))}
        </p>
      ) : null}
      {a.serverDropped > 0 || (a.view?.dropped ?? 0) > 0 ? (
        <p className="ag-quiet">
          {tn(
            Math.max(a.serverDropped, a.view?.dropped ?? 0),
            "v6.dropped.one",
            "v6.dropped.other",
          )}
        </p>
      ) : null}
      {s.tokens && a.status === "done" ? (
        <p className="ag-quiet mono" data-testid="agent-tokens">
          {det || a.tokens === null || a.tokens === 0
            ? t("v6.tokens.none")
            : t("v6.tokens", { n: a.tokens.toLocaleString() })}
        </p>
      ) : null}
    </div>
  );
}

function Exchange({
  a,
  send,
  retry,
  stop,
  closePanel,
}: {
  a: Answer;
  send: (i: SendInput) => void;
  retry: (id: string, i: SendInput) => void;
  stop: () => void;
  closePanel: () => void;
}) {
  const { t } = useI18n();
  const s = useAgentSettings();
  const [table, setTable] = useState(false);
  const [refining, setRefining] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [text, setText] = useState("");
  const refineBtn = useRef<HTMLButtonElement>(null);
  const done = a.status === "done" && !!a.program;
  const cards = countCards(a.view?.root ?? null);
  const title = useMemo(() => {
    const m = a.program.match(/InsightCard\("((?:[^"\\]|\\.)*)"/);
    return (m?.[1] ?? a.label).replace(/\\"/g, '"').slice(0, 60);
  }, [a.program, a.label]);
  const onTurn = (e: ActionEventValue, label: string) => send({ label, action: e });
  const refine = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    send({ label: v, text: v, previous: a.program });
    setText("");
    setRefining(false);
  };
  return (
    <li className="ag-ex" data-testid="agent-exchange">
      <div className="ag-user">
        <span className="sr-only">{t("v6.you")}: </span>
        {a.label}
      </div>
      <div className="ag-ans">
        <h3 className="sr-only">{t("v6.answer")}</h3>
        {a.status === "streaming" ? (
          <p className="ag-status" data-testid="agent-streaming">
            <i className="ag-dot" aria-hidden />
            {t("v6.status.streaming")}
            {cards ? ` · ${t("v6.status.cards", { n: cards })}` : ""}
            <button type="button" className="ag-link" onClick={stop}>
              <Square size={12} aria-hidden /> {t("v6.stop")}
            </button>
          </p>
        ) : null}
        <AgentRender
          root={a.view?.root ?? null}
          forceTable={table}
          onTurn={onTurn}
          onNavigate={closePanel}
          density={s.density}
          theme={s.theme}
        />
        {a.status === "streaming" && (!a.view?.root || a.view.pending > 0 || !a.view.complete) ? (
          <div className="ag-skel tall" aria-hidden />
        ) : null}
        {a.status === "stopped" && !a.program ? (
          <p className="ag-quiet">{t("v6.status.stopped")}</p>
        ) : null}
        {a.status === "error" ? (
          <div className="errorbox" role="alert">
            <b>{t("v6.error.title")}</b>
            <div>{t(a.errorKey ?? "v6.error.generic")}</div>
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={() => retry(a.id, { label: a.label, text: a.label })}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : null}
        <Notes a={a} />
        {done ? (
          <div className="ag-actions" role="group" aria-label={t("v6.answer")}>
            <button type="button" className="btn soft sm" onClick={() => setPinning(true)}>
              <Pin size={14} aria-hidden /> {t("v6.pin")}
            </button>
            <button
              ref={refineBtn}
              type="button"
              className="btn soft sm"
              aria-expanded={refining}
              onClick={() => setRefining((v) => !v)}
            >
              <CornerDownLeft size={14} aria-hidden /> {t("v6.refine")}
            </button>
            <button
              type="button"
              className="btn soft sm"
              aria-pressed={table}
              onClick={() => setTable((v) => !v)}
            >
              {table ? (
                <ChartNoAxesColumn size={14} aria-hidden />
              ) : (
                <Table2 size={14} aria-hidden />
              )}{" "}
              {table ? t("v6.chart") : t("v6.table")}
            </button>
          </div>
        ) : null}
        {refining ? (
          <form className="ag-refine" onSubmit={refine}>
            <label className="sr-only" htmlFor={`rf-${a.id}`}>
              {t("v6.refine.label")}
            </label>
            <input
              id={`rf-${a.id}`}
              className="input"
              value={text}
              maxLength={MAX}
              placeholder={t("v6.refine.ph")}
              onChange={(e) => setText(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the person just asked to refine
              autoFocus
            />
            <button type="submit" className="btn primary sm" disabled={!text.trim()}>
              {t("v6.refine.send")}
            </button>
            <div className="ag-quick">
              {(["v6.refine.dense", "v6.refine.funnel"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="ag-chip sm"
                  onClick={() => {
                    send({ label: t(k), text: t(k), previous: a.program });
                    setRefining(false);
                  }}
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </form>
        ) : null}
      </div>
      {pinning ? (
        <PinDialog program={a.program} defaultName={title} onClose={() => setPinning(false)} />
      ) : null}
    </li>
  );
}

function Composer({
  onSend,
  busy,
  stop,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  stop: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const go = () => {
    const v = text.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      go();
    }
  };
  return (
    <form
      className="ag-composer"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label className="sr-only" htmlFor="ag-input">
        {t("v6.composer.label")}
      </label>
      <textarea
        id="ag-input"
        ref={ref}
        className="textarea"
        rows={2}
        value={text}
        maxLength={MAX}
        placeholder={t("v6.composer.ph")}
        aria-describedby="ag-hint"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={key}
        data-testid="agent-input"
      />
      <div className="ag-composer-foot">
        <span id="ag-hint" className="muted small">
          {t("v6.composer.hint")} {t("v6.composer.count", { n: text.length })}
        </span>
        {busy ? (
          <button type="button" className="btn sm" onClick={stop}>
            <Square size={13} aria-hidden /> {t("v6.stop")}
          </button>
        ) : (
          <button type="submit" className="btn primary sm" disabled={!text.trim()}>
            {t("v6.composer.send")}
          </button>
        )}
      </div>
    </form>
  );
}

export function Thread({
  variant,
  closePanel,
}: {
  variant: "panel" | "page";
  closePanel?: () => void;
}) {
  const { t } = useI18n();
  const { answers, send, stop, retry, busy } = useAgentThread();
  const { pending, take } = useAgentHost();
  const end = useRef<HTMLDivElement>(null);
  const live = answers[answers.length - 1];

  // A turn another part of the app asked for (a button on a pinned card).
  useEffect(() => {
    if (!pending) return;
    take(pending.n);
    void send({
      label: pending.label,
      ...(pending.text ? { text: pending.text } : {}),
      ...(pending.action ? { action: pending.action as ActionEventValue } : {}),
    });
  }, [pending, take, send]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [answers.length, live?.program]);

  const status =
    live?.status === "streaming"
      ? t("v6.status.streaming")
      : live?.status === "done"
        ? t("v6.status.done")
        : "";

  return (
    <div className={`ag-thread ${variant}`}>
      <p className="sr-only" role="status" aria-live="polite" data-testid="agent-live">
        {status}
      </p>
      <div className="ag-scroll">
        {answers.length ? (
          <ol className="ag-list" aria-label={t("v6.thread")}>
            {answers.map((a) => (
              <Exchange
                key={a.id}
                a={a}
                send={(i) => void send(i)}
                retry={(id, i) => retry(id, i)}
                stop={stop}
                closePanel={closePanel ?? (() => {})}
              />
            ))}
          </ol>
        ) : (
          <Welcome send={(i) => void send(i)} />
        )}
        <div ref={end} />
      </div>
      <Composer busy={busy} stop={stop} onSend={(text) => void send({ label: text, text })} />
    </div>
  );
}
