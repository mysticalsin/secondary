// Shared by the My Agent tests: a stand-in for the streaming Messages API and small SSE helpers.

import { createLocalJWKSet } from "jose";
import { createApp } from "../src/index.ts";
import { aiCall } from "./ai-helpers.ts";
import { type Loose, publicJwk, sign, testEnv } from "./helpers.ts";
import { parseSse } from "./uxv2-helpers.ts";

export { aiCall, KEY } from "./ai-helpers.ts";

const jwks = createLocalJWKSet({ keys: [publicJwk] });

export type StubBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; raw?: string };

export type StubRound = {
  blocks: StubBlock[];
  stop?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

export type AgentCall = {
  body: Loose;
  headers: Record<string, string>;
  /** The messages of the request, as sent. */
  messages: Loose[];
};

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** One streamed assistant message, the way the Messages API sends it. */
export function streamOf(round: StubRound): string {
  const u = round.usage ?? { input_tokens: 500, output_tokens: 150 };
  let out = sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [],
      stop_reason: null,
      usage: { input_tokens: u.input_tokens, output_tokens: 1 },
    },
  });
  out += sse("ping", { type: "ping" });
  round.blocks.forEach((b, index) => {
    if (b.type === "text") {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      // small pieces, so a line is split across deltas
      for (let at = 0; at < b.text.length; at += 7)
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: b.text.slice(at, at + 7) },
        });
    } else if (b.type === "thinking") {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "" },
      });
      out += sse("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking: b.thinking },
      });
      out += sse("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: b.signature },
      });
    } else if (b.type === "redacted_thinking") {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "redacted_thinking", data: b.data },
      });
    } else {
      out += sse("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: b.id, name: b.name, input: {} },
      });
      const raw = b.raw ?? JSON.stringify(b.input);
      for (let at = 0; at < raw.length; at += 5)
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: raw.slice(at, at + 5) },
        });
    }
    out += sse("content_block_stop", { type: "content_block_stop", index });
  });
  out += sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: round.stop ?? "end_turn", stop_sequence: null },
    usage: { output_tokens: u.output_tokens },
  });
  out += sse("message_stop", { type: "message_stop" });
  return out;
}

/** A body that arrives in uneven pieces. */
const chunked = (text: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (at >= bytes.length) return ctrl.close();
      const n = 37 + (at % 11);
      ctrl.enqueue(bytes.slice(at, at + n));
      at += n;
    },
  });
};

/** A stand-in for api.anthropic.com/v1/messages with stream:true. `script` gets the request and the round number. */
export function streamModel(script: (call: AgentCall, n: number) => StubRound | Response) {
  const calls: AgentCall[] = [];
  const fetchStub = async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Loose;
    const call: AgentCall = {
      body,
      headers: init?.headers as Record<string, string>,
      messages: JSON.parse(JSON.stringify(body.messages)) as Loose[],
    };
    calls.push(call);
    const r = script(call, calls.length);
    if (r instanceof Response) return r;
    return new Response(chunked(streamOf(r)), {
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { fetch: fetchStub, calls };
}

export const textRound = (text: string, usage?: StubRound["usage"]): StubRound => ({
  blocks: [{ type: "text", text }],
  ...(usage ? { usage } : {}),
});

export const toolRound = (
  blocks: Extract<StubBlock, { type: "tool_use" }>[],
  extra: StubBlock[] = [],
  usage?: StubRound["usage"],
): StubRound => ({
  blocks: [...extra, ...blocks],
  stop: "tool_use",
  ...(usage ? { usage } : {}),
});

export type Turn = {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  events: { event: string; data: Loose }[];
  /** The lines a client would end up with: those after the last `reset`. */
  lines: string[];
  resets: number;
  meta: Loose;
  usage: Loose | undefined;
  dropped: number;
  done: Loose | undefined;
  raw: string;
};

/** POST /v1/agent/turn as a persona and read the whole stream. */
export async function turn(
  persona: string,
  body: unknown,
  o: {
    env?: Record<string, unknown>;
    fetch?: (u: string, i?: RequestInit) => Promise<Response>;
  } = {},
): Promise<Turn> {
  const res = await aiCall(persona, "/v1/agent/turn", { body, ...o });
  const raw = await res.text();
  const events = res.headers.get("content-type")?.includes("text/event-stream")
    ? parseSse(raw)
    : [];
  const lastReset = events.map((e) => e.event).lastIndexOf("reset");
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
    events,
    lines: events
      .slice(lastReset + 1)
      .filter((e) => e.event === "line")
      .map((e) => e.data.text as string),
    resets: events.filter((e) => e.event === "reset").length,
    meta: events.findLast((e) => e.event === "meta")?.data ?? {},
    usage: events.find((e) => e.event === "usage")?.data,
    dropped: events.find((e) => e.event === "dropped")?.data.count ?? 0,
    done: events.find((e) => e.event === "done")?.data,
    raw,
  };
}

/** A request with a body the way a browser sends it, for the app directly (own `fetch` and env). */
export async function raw(
  persona: string,
  path: string,
  o: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    env?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  const app = createApp({ jwks: () => jwks });
  const token = await sign(`${persona}@example.invalid`);
  return app.fetch(
    new Request(`https://secondary.example.test${path}`, {
      method: o.method ?? "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": token,
        "X-Demo-Persona": persona,
        "Content-Type": "application/json",
        ...o.headers,
      },
      ...(o.body !== undefined ? { body: o.body } : {}),
    }),
    testEnv(o.env),
  );
}

/** Receipts the auditor can read for one persona's principal. */
export async function receiptsOf(principal: string): Promise<Loose[]> {
  const res = await aiCall("auditor", `/v1/audit/receipts?principal=${principal}&days=1`);
  return ((await res.json()) as Loose).receipts as Loose[];
}
