// A streaming Anthropic Messages client for one round of the My Agent tool loop. It POSTs with
// `stream: true`, reads the server-sent events and rebuilds the assistant message block by block, so the
// whole content (text, thinking with its signature, redacted thinking, tool calls, server blocks) can be
// sent back unchanged in the next round. Nothing here decides what is shown: the caller checks the text.
//
// Bounds: one timeout for the round, a cap on bytes read, and one retry only while no byte has been
// read (a 429 or 5xx status). After the first byte there is never a retry: a broken stream is a failure.
// No temperature, top_p, top_k, prefill, forced tool_choice or budget_tokens: the default model takes
// none of them. The key is sent as a header and never logged.

import {
  commitSse,
  freshSse,
  sseEvent,
  type SseState,
} from "../../../../src/state/sse-assembly.ts";
import {
  commitStreamOpen,
  type StreamOpenEvent,
  type StreamOpenState,
} from "../../../../src/state/stream-open.ts";
import { ANTHROPIC_URL, type FetchFn } from "../ai/anthropic.ts";

const ANTHROPIC_VERSION = "2023-06-01";
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
  let open: StreamOpenState = { tag: "opening", attempt: 0 };
  try {
    let res: Response | undefined;
    while (open.tag === "opening") {
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
      const next = commitStreamOpen(open, {
        type: "http",
        status: res.status,
        hasBody: res.body != null,
      });
      if (!next.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, code: "upstream_error", usage: known.usage };
      }
      open = next.state;
      if (open.tag === "opening") {
        await res.body?.cancel().catch(() => {});
        for (const effect of next.effects) {
          if (effect.type === "retry") await sleep(effect.delayMs);
        }
        continue;
      }
      break;
    }
    if (open.tag !== "streaming" || !res?.ok || !res.body) {
      await res?.body?.cancel().catch(() => {});
      return {
        ok: false,
        code: open.tag === "failed" ? open.code : "upstream_error",
        usage: known.usage,
      };
    }

    let assembly: SseState = freshSse(r.model);
    const onEvent = (ev: Record<string, unknown>): boolean => {
      const step = commitSse(assembly, sseEvent(ev));
      if (!step.ok || step.state.tag !== "assembling") return false;
      assembly = step.state;
      // Cached prefix tokens are tokens the model read: the reducer counts them as input.
      known.usage = { inputTokens: assembly.inputTokens, outputTokens: assembly.outputTokens };
      for (const effect of step.effects) {
        if (effect.type === "text") r.onText?.(effect.delta);
        else r.onToolUse?.();
      }
      return true;
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
      if (broken || (assembly.tag === "assembling" && assembly.stopped)) break;
    }
    await reader.cancel().catch(() => {});
    if (broken || assembly.tag !== "assembling" || !assembly.stopped || !assembly.stopReason)
      return { ok: false, code: "upstream_error", usage: known.usage };

    const content = assembly.blocks.filter((b): b is Block => b !== undefined);
    const bad = new Set(assembly.invalid);
    const toolUses: ToolUse[] = [];
    for (const [i, b] of assembly.blocks.entries())
      if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
        toolUses.push({ id: b.id, name: b.name, input: b.input ?? {}, invalid: bad.has(i) });
    const text = content
      .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
      .join("");
    return {
      ok: true,
      content,
      stopReason: assembly.stopReason,
      text,
      toolUses,
      model: assembly.model,
      usage: { inputTokens: assembly.inputTokens, outputTokens: assembly.outputTokens },
    };
  } catch (e) {
    const event: StreamOpenEvent =
      e instanceof Error && e.name === "AbortError" ? { type: "timeout" } : { type: "transport" };
    const next = commitStreamOpen(open, event);
    return {
      ok: false,
      code: next.ok && next.state.tag === "failed" ? next.state.code : "upstream_error",
      usage: known.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}
