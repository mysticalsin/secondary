// The conversation state of My Agent. Each turn streams: lines arrive, the checked view grows, and
// the thread re-renders. History is kept on this device as programs (plans) only, never data.
import {
  type ActionEventValue,
  type AgentView,
  newViewStream,
  viewOfProgram,
} from "@secondary/contracts/agent-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import {
  clearHistory,
  type HistoryEntry,
  readHistory,
  readSettings,
  writeHistory,
} from "./settings";
import { errorKey, streamTurn, type TurnBody } from "./stream";

export interface Answer {
  id: string;
  /** What the person asked, as shown in the thread. */
  label: string;
  program: string;
  view: AgentView | null;
  status: "streaming" | "done" | "error" | "stopped";
  mode?: "ai" | "deterministic";
  reason?: string;
  serverDropped: number;
  /** Tokens used by the answer, or null when none were reported. */
  tokens: number | null;
  errorKey?: ReturnType<typeof errorKey>;
  at: number;
}

export interface SendInput {
  label: string;
  text?: string;
  action?: ActionEventValue;
  previous?: string;
}

const fromHistory = (h: HistoryEntry): Answer => ({
  id: h.id,
  label: h.label,
  program: h.program,
  view: viewOfProgram(h.program),
  status: "done",
  ...(h.mode ? { mode: h.mode } : {}),
  ...(h.reason ? { reason: h.reason } : {}),
  serverDropped: h.dropped ?? 0,
  tokens: h.tokens ?? null,
  at: h.at,
});

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export function useAgentThread() {
  const { lang } = useI18n();
  const { epoch } = useApp();
  const [answers, setAnswers] = useState<Answer[]>(() => readHistory().map(fromHistory));
  const abort = useRef<AbortController | null>(null);
  const live = useRef(true);
  const list = useRef<Answer[]>(answers);
  list.current = answers;

  const patch = useCallback((id: string, p: Partial<Answer>) => {
    setAnswers((all) => all.map((a) => (a.id === id ? { ...a, ...p } : a)));
  }, []);

  // A different person (the dev persona picker) has their own history.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    abort.current?.abort();
    setAnswers(readHistory().map(fromHistory));
  }, [epoch]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      abort.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (input: SendInput) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const id = newId();
      const s = readSettings();
      const body: TurnBody = {
        ...(input.text ? { text: input.text } : {}),
        ...(input.action ? { action: input.action } : {}),
        ...(input.previous ? { previous: input.previous } : {}),
        lang: s.lang === "follow" ? lang : s.lang,
        density: s.density,
      };
      const base: Answer = {
        id,
        label: input.label,
        program: "",
        view: null,
        status: "streaming",
        serverDropped: 0,
        tokens: null,
        at: Date.now(),
      };
      // Anything still streaming from an earlier turn stops here.
      setAnswers((all) => [
        ...all.map((a) => (a.status === "streaming" ? { ...a, status: "stopped" as const } : a)),
        base,
      ]);
      let vs = newViewStream();
      let text = "";
      let mode: Answer["mode"];
      let reason: string | undefined;
      let dropped = 0;
      let tokens: number | null = null;
      let failed: string | null = null;
      try {
        await streamTurn(body, ctl.signal, {
          onMeta: (m) => {
            mode = m.mode;
            reason = m.reason;
            patch(id, { mode: m.mode, ...(m.reason ? { reason: m.reason } : {}) });
          },
          onLine: (line) => {
            text += `${line}\n`;
            patch(id, { program: text, view: vs.set(text) });
          },
          onReset: () => {
            text = "";
            vs = newViewStream();
            patch(id, { program: "", view: null, serverDropped: 0 });
          },
          onDropped: (n) => {
            dropped = n;
            patch(id, { serverDropped: n });
          },
          onUsage: (u) => {
            tokens = u.inputTokens + u.outputTokens;
            patch(id, { tokens });
          },
          onError: (code) => {
            failed = code;
          },
        });
        if (failed) {
          patch(id, { status: "error", errorKey: errorKey(failed) });
          return;
        }
        const view = vs.set(text, true);
        patch(id, { program: text, view, status: "done" });
        const entry: HistoryEntry = {
          id,
          label: input.label,
          program: text,
          at: Date.now(),
          ...(mode ? { mode } : {}),
          ...(reason ? { reason } : {}),
          tokens,
          dropped,
        };
        const kept = list.current
          .filter((a) => a.status === "done" && a.program)
          .map(
            (a): HistoryEntry => ({
              id: a.id,
              label: a.label,
              program: a.program,
              at: a.at,
              ...(a.mode ? { mode: a.mode } : {}),
              ...(a.reason ? { reason: a.reason } : {}),
              tokens: a.tokens,
              dropped: a.serverDropped,
            }),
          );
        writeHistory([...kept.filter((k) => k.id !== id), entry]);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          if (live.current) patch(id, { status: "stopped" });
          return;
        }
        if (live.current) patch(id, { status: "error", errorKey: errorKey(e) });
      }
    },
    [lang, patch],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const clear = useCallback(() => {
    abort.current?.abort();
    clearHistory();
    setAnswers([]);
  }, []);
  const retry = useCallback(
    (id: string, again: SendInput) => {
      setAnswers((all) => all.filter((a) => a.id !== id));
      void send(again);
    },
    [send],
  );

  return { answers, send, stop, clear, retry, busy: answers.some((a) => a.status === "streaming") };
}
