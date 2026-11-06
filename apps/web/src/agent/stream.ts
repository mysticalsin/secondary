// The My Agent stream client: POST /v1/agent/turn, read the server-sent events (meta, line,
// dropped, usage, done, error) and hand each one to the caller as it arrives. In the dev mock the
// response comes from src/mock/agent.ts instead of the network; the parsing is the same.
import type { TurnRequestValue } from "@secondary/contracts/agent-ui";
import { ApiError, getPersona, MOCK } from "../api";

export type TurnBody = TurnRequestValue;

export interface TurnEvents {
  onMeta?: (m: { turnId: string; mode: "ai" | "deterministic"; reason?: string }) => void;
  onLine?: (text: string) => void;
  /** The lines so far are not the answer: clear them (a second meta may follow). */
  onReset?: () => void;
  onDropped?: (count: number) => void;
  onUsage?: (u: { inputTokens: number; outputTokens: number; model: string | null }) => void;
  onDone?: (d: { turnId: string; lines: number }) => void;
  onError?: (code: string) => void;
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental parser of text/event-stream: push chunks, get whole events back. */
export class SseParser {
  private buf = "";
  push(chunk: string): SseEvent[] {
    // A "\r" at the end of a chunk may be the first half of "\r\n": hold it back.
    let work = this.buf + chunk;
    let hold = "";
    if (work.endsWith("\r")) {
      hold = "\r";
      work = work.slice(0, -1);
    }
    work = work.replace(/\r\n?/g, "\n");
    const out: SseEvent[] = [];
    let i = work.indexOf("\n\n");
    while (i >= 0) {
      const ev = parseBlock(work.slice(0, i));
      if (ev) out.push(ev);
      work = work.slice(i + 2);
      i = work.indexOf("\n\n");
    }
    this.buf = work + hold;
    return out;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const c = line.indexOf(":");
    const field = c < 0 ? line : line.slice(0, c);
    const value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

const obj = (s: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Hand one parsed event to the matching handler. Unknown events and bad payloads are ignored. */
export function dispatch(ev: SseEvent, h: TurnEvents): void {
  const d = obj(ev.data);
  if (!d) return;
  switch (ev.event) {
    case "meta":
      if (typeof d.turnId === "string" && (d.mode === "ai" || d.mode === "deterministic"))
        h.onMeta?.({
          turnId: d.turnId,
          mode: d.mode,
          ...(typeof d.reason === "string" ? { reason: d.reason } : {}),
        });
      break;
    case "line":
      if (typeof d.text === "string") h.onLine?.(d.text);
      break;
    case "reset":
      h.onReset?.();
      break;
    case "dropped":
      if (typeof d.count === "number") h.onDropped?.(d.count);
      break;
    case "usage":
      h.onUsage?.({
        inputTokens: Number(d.inputTokens) || 0,
        outputTokens: Number(d.outputTokens) || 0,
        model: typeof d.model === "string" ? d.model : null,
      });
      break;
    case "done":
      h.onDone?.({ turnId: String(d.turnId ?? ""), lines: Number(d.lines) || 0 });
      break;
    case "error":
      h.onError?.(typeof d.code === "string" ? d.code : "error");
      break;
  }
}

async function open(body: TurnBody, signal: AbortSignal): Promise<Response> {
  const persona = getPersona();
  if (MOCK) {
    const { agentTurnResponse } = await import("../mock/agent");
    return agentTurnResponse(body, persona, signal);
  }
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  if (persona) headers["X-Demo-Persona"] = persona;
  return fetch("/v1/agent/turn", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
}

/** Run one turn. Resolves when the stream ends; throws ApiError for an HTTP refusal, AbortError on abort. */
export async function streamTurn(
  body: TurnBody,
  signal: AbortSignal,
  h: TurnEvents,
): Promise<void> {
  const res = await open(body, signal);
  if (!res.ok) {
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, String(data.error ?? res.status), data);
  }
  if (!res.body) throw new ApiError(502, "no_stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const sse = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of sse.push(dec.decode(value, { stream: true }))) dispatch(ev, h);
    }
    for (const ev of sse.push(`${dec.decode()}\n\n`)) dispatch(ev, h);
  } finally {
    reader.releaseLock?.();
  }
}

/** The wording key for an error code or status. */
export function errorKey(
  e: unknown,
): "v6.error.rate_limited" | "v6.error.forbidden" | "v6.error.invalid" | "v6.error.generic" {
  const code =
    e instanceof ApiError
      ? e.status === 429
        ? "rate_limited"
        : e.status === 403
          ? "forbidden"
          : e.status === 400
            ? "invalid"
            : ""
      : typeof e === "string"
        ? e
        : "";
  if (code === "rate_limited") return "v6.error.rate_limited";
  if (code === "forbidden" || code === "brains_v3_disabled") return "v6.error.forbidden";
  if (code === "invalid" || code === "invalid_request") return "v6.error.invalid";
  return "v6.error.generic";
}
