// A streaming Anthropic Messages client for one round of the My Agent tool loop. It POSTs with
// `stream: true`, reads the server-sent events and rebuilds the assistant message block by block, so the
// whole content (text, thinking with its signature, redacted thinking, tool calls, server blocks) can be
// sent back unchanged in the next round. Nothing here decides what is shown: the caller checks the text.
//
// Bounds: one timeout for the round, a cap on bytes read, and one retry only while no byte has been
// read (a 429 or 5xx status). After the first byte there is never a retry: a broken stream is a failure.
// No temperature, top_p, top_k, prefill, forced tool_choice or budget_tokens: the default model takes
// none of them. The key is sent as a header and never logged.

import { ANTHROPIC_URL, type FetchFn } from "../ai/anthropic.ts";

const ANTHROPIC_VERSION = "2023-06-01";
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
/** Bytes of event stream one round may deliver. Far above a program of 8 KB plus thinking. */
const MAX_STREAM_BYTES = 1_000_000;

export type Block = { type: string; [k: string]: unknown };
export type Message = { role: "user" | "assistant"; content: string | Block[] };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
  /** The model's arguments were not a JSON object. */
  invalid: boolean;
}

export type RoundResult =
  | {
      ok: true;
      /** The assistant message, block for block as streamed. */
      content: Block[];
      stopReason: string;
      /** Text of the text blocks, in order. */
      text: string;
      toolUses: ToolUse[];
      model: string;
      usage: Usage;
    }
  | { ok: false; code: "upstream_error" | "timeout"; usage: Usage | null };

export interface RoundRequest {
  apiKey: string;
  model: string;
  system: string;
  tools: ToolDef[];
  messages: Message[];
  maxTokens: number;
  timeoutMs: number;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  /** Each text delta as it arrives, so finished lines can go to the person while the round runs. */
  onText?: (delta: string) => void;
  /** A tool call begins: whatever text this round wrote is not the answer. */
  onToolUse?: () => void;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function roundBody(r: RoundRequest): string {
  return JSON.stringify({
    model: r.model,
    max_tokens: r.maxTokens,
    stream: true,
    // Frozen text: the cacheable prefix, with the tools in front of it.
    system: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }],
    tools: r.tools,
    tool_choice: { type: "auto" },
    messages: r.messages,
    // Low effort keeps thinking from eating the output cap.
    output_config: { effort: "low" },
  });
}

export async function streamRound(r: RoundRequest): Promise<RoundResult> {
  const doFetch: FetchFn = r.fetch ?? ((i, init) => fetch(i, init));
  const sleep = r.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const body = roundBody(r);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs);
  const known: { usage: Usage | null } = { usage: null };
  try {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await doFetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": r.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body,
        signal: ctl.signal,
      });
      // Before the first byte of a stream a retry is safe; afterwards it never is.
      if (RETRYABLE.has(res.status) && attempt === 0) {
        await res.body?.cancel().catch(() => {});
        await sleep(250);
        continue;
      }
      break;
    }
    if (!res?.ok || !res.body) {
      await res?.body?.cancel().catch(() => {});
      return { ok: false, code: "upstream_error", usage: known.usage };
    }

    const blocks: (Block | undefined)[] = [];
    const json = new Map<number, string>();
    const invalid = new Set<number>();
    let model = r.model;
    let stopReason = "";
    let stopped = false;
    const u = { in: 0, out: 0 };
    const seen = () => {
      known.usage = { inputTokens: u.in, outputTokens: u.out };
    };

    const onEvent = (ev: Record<string, unknown>): boolean => {
      switch (ev.type) {
        case "message_start": {
          const m = isObj(ev.message) ? ev.message : {};
          if (typeof m.model === "string") model = m.model;
          const mu = isObj(m.usage) ? m.usage : {};
          // Cached prefix tokens are tokens the model read: they count as input.
          u.in =
            num(mu.input_tokens) +
            num(mu.cache_creation_input_tokens) +
            num(mu.cache_read_input_tokens);
          u.out = num(mu.output_tokens);
          seen();
          return true;
        }
        case "content_block_start": {
          const i = num(ev.index);
          if (!isObj(ev.content_block) || typeof ev.content_block.type !== "string") return false;
          const b = structuredClone(ev.content_block) as Block;
          if (b.type === "text" && typeof b.text !== "string") b.text = "";
          if (b.type === "thinking" && typeof b.thinking !== "string") b.thinking = "";
          if (b.type === "tool_use" || b.type === "server_tool_use") {
            json.set(i, "");
            r.onToolUse?.();
          }
          blocks[i] = b;
          return true;
        }
        case "content_block_delta": {
          const i = num(ev.index);
          const b = blocks[i];
          const d = isObj(ev.delta) ? ev.delta : null;
          if (!b || !d) return false;
          if (d.type === "text_delta" && typeof d.text === "string") {
            b.text = `${typeof b.text === "string" ? b.text : ""}${d.text}`;
            r.onText?.(d.text);
          } else if (d.type === "input_json_delta" && typeof d.partial_json === "string")
            json.set(i, `${json.get(i) ?? ""}${d.partial_json}`);
          else if (d.type === "thinking_delta" && typeof d.thinking === "string")
            b.thinking = `${typeof b.thinking === "string" ? b.thinking : ""}${d.thinking}`;
          else if (d.type === "signature_delta" && typeof d.signature === "string")
            b.signature = d.signature;
          else if (d.type === "citations_delta" && d.citation !== undefined)
            b.citations = [...(Array.isArray(b.citations) ? b.citations : []), d.citation];
          return true;
        }
        case "content_block_stop": {
          const i = num(ev.index);
          const b = blocks[i];
          if (b && json.has(i)) {
            const raw = json.get(i) ?? "";
            try {
              const v: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
              if (isObj(v)) b.input = v;
              else {
                b.input = {};
                invalid.add(i);
              }
            } catch {
              b.input = {};
              invalid.add(i);
            }
          }
          return true;
        }
        case "message_delta": {
          const d = isObj(ev.delta) ? ev.delta : {};
          if (typeof d.stop_reason === "string") stopReason = d.stop_reason;
          const mu = isObj(ev.usage) ? ev.usage : {};
          if (num(mu.output_tokens)) u.out = num(mu.output_tokens);
          const more = num(mu.input_tokens) + num(mu.cache_creation_input_tokens);
          if (more) u.in = Math.max(u.in, more + num(mu.cache_read_input_tokens));
          seen();
          return true;
        }
        case "message_stop":
          stopped = true;
          return true;
        case "error":
          return false;
        default:
          return true; // ping and event types this client does not know
      }
    };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let bytes = 0;
    let broken = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_STREAM_BYTES) {
        broken = true;
        break;
      }
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      for (let at = buf.indexOf("\n\n"); at >= 0; at = buf.indexOf("\n\n")) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        let ev: unknown;
        try {
          ev = JSON.parse(data);
        } catch {
          broken = true;
          break;
        }
        if (!isObj(ev) || !onEvent(ev)) {
          broken = true;
          break;
        }
      }
      if (broken || stopped) break;
    }
    await reader.cancel().catch(() => {});
    if (broken || !stopped || !stopReason)
      return { ok: false, code: "upstream_error", usage: known.usage };

    const content = blocks.filter((b): b is Block => b !== undefined);
    const toolUses: ToolUse[] = [];
    for (const [i, b] of blocks.entries())
      if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
        toolUses.push({ id: b.id, name: b.name, input: b.input ?? {}, invalid: invalid.has(i) });
    const text = content
      .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
      .join("");
    return {
      ok: true,
      content,
      stopReason,
      text,
      toolUses,
      model,
      usage: { inputTokens: u.in, outputTokens: u.out },
    };
  } catch (e) {
    return {
      ok: false,
      code: e instanceof Error && e.name === "AbortError" ? "timeout" : "upstream_error",
      usage: known.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}
