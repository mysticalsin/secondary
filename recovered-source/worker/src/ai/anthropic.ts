// Anthropic Messages API client over fetch (no SDK: the Worker needs nothing else). One tool-free
// request per call: no `tools`, no `tool_choice`, so a response can only ever be text. The key comes
// from the ANTHROPIC_API_KEY secret and is never logged. Timeout and retries are bounded.

import {
  commitModelCall,
  type ModelCallEvent,
  type ModelCallReply,
  startModelCall,
} from "../../../../src/state/model-call.ts";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ModelUsage = { inputTokens: number; outputTokens: number };

export type ModelReply = ModelCallReply;

export interface ModelRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  retries: number;
  fetch?: FetchFn;
  /** Test seam: backoff between retries. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type MessagesBody = {
  model?: unknown;
  stop_reason?: unknown;
  content?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

export async function callModel(r: ModelRequest): Promise<ModelReply> {
  const doFetch: FetchFn = r.fetch ?? ((i, init) => fetch(i, init));
  const sleep = r.sleep ?? wait;
  const body = JSON.stringify({
    model: r.model,
    max_tokens: r.maxTokens,
    // The system prompt is frozen text, so it is the cacheable prefix.
    system: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: r.user }],
    // Short, bounded answers: low effort keeps thinking from eating the output cap.
    output_config: { effort: "low" },
  });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const eventFrom = (data: MessagesBody): ModelCallEvent => {
    if (data.stop_reason === "refusal") return { type: "refused" };
    if (data.stop_reason === "max_tokens") return { type: "truncated" };
    const text = Array.isArray(data.content)
      ? (data.content as { type?: unknown; text?: unknown }[])
          .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
          .join("")
      : "";
    if (!text.trim()) return { type: "empty" };
    return {
      type: "success",
      text,
      model: typeof data.model === "string" ? data.model : r.model,
      usage: {
        inputTokens: num(data.usage?.input_tokens),
        outputTokens: num(data.usage?.output_tokens),
      },
    };
  };

  let state = startModelCall(r.retries);
  while (state.tag === "calling") {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), r.timeoutMs);
    let event: ModelCallEvent;
    try {
      const res = await doFetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": r.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body,
        signal: ctl.signal,
      });
      event = res.ok
        ? eventFrom((await res.json()) as MessagesBody)
        : { type: "http", status: res.status };
    } catch (e) {
      event = {
        type: e instanceof Error && e.name === "AbortError" ? "timeout" : "transport",
      };
    } finally {
      clearTimeout(timer);
    }
    const next = commitModelCall(state, event);
    if (!next.ok) return { ok: false, code: "upstream_error" };
    if (next.state.tag === "done") return next.state.reply;
    state = next.state;
    for (const effect of next.effects) {
      if (effect.type === "backoff") await sleep(effect.delayMs);
    }
  }
  return state.reply;
}

/** The first JSON object in a model reply, tolerating a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}
