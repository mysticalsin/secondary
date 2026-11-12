/**
 * SSE content assembly. Frames are local strings. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { streamRound } from "../../recovered-source/worker/src/agent/stream.ts";
import { requireOk, requireTag } from "./require-ok.ts";
import {
  canApplyDelta,
  commitSse,
  freshSse,
  hasBlockType,
  sseEvent,
  type SseEvent,
  type SseState,
  transitionSse,
} from "../../src/state/sse-assembly.ts";

const fresh = freshSse("m");
const withText: SseState = {
  tag: "assembling",
  blocks: [{ type: "text", text: "" }],
  json: {},
  invalid: [],
  model: "m",
  stopReason: "",
  stopped: false,
  inputTokens: 0,
  outputTokens: 0,
};
const broken: SseState = { tag: "broken" };

const events = {
  message_start: { type: "message_start", message: { model: "m2" } } as const,
  block_start_ok: {
    type: "content_block_start",
    index: 0,
    block: { type: "text", text: "" },
  } as const,
  block_start_bad: { type: "content_block_start", index: 0, block: null } as const,
  delta_text: {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "A" },
  } as const,
  delta_missing: { type: "content_block_delta", index: 0, delta: null } as const,
  block_stop: { type: "content_block_stop", index: 0 } as const,
  message_delta: {
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 2 },
  } as const,
  message_stop: { type: "message_stop" } as const,
  error: { type: "error" } as const,
  other: { type: "other" } as const,
};

const states = { fresh, withText, broken };
type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "fresh:message_start",
  "fresh:block_start_ok",
  "fresh:block_start_bad",
  "fresh:delta_text",
  "fresh:delta_missing",
  "fresh:block_stop",
  "fresh:message_delta",
  "fresh:message_stop",
  "fresh:error",
  "fresh:other",
  "withText:message_start",
  "withText:block_start_ok",
  "withText:block_start_bad",
  "withText:delta_text",
  "withText:delta_missing",
  "withText:block_stop",
  "withText:message_delta",
  "withText:message_stop",
  "withText:error",
  "withText:other",
]);

const apply = (state: SseState, event: SseEvent): SseState => requireOk(transitionSse(state, event)).state;

test("sse assembly: every legal transition", () => {
  assert.equal(requireTag(apply(fresh, events.message_start), "assembling").model, "m2");
  assert.equal(requireTag(apply(withText, events.delta_text), "assembling").blocks[0]?.text, "A");
  assert.equal(apply(fresh, events.delta_text).tag, "broken");
  assert.equal(apply(fresh, events.block_start_bad).tag, "broken");
  assert.equal(apply(fresh, events.error).tag, "broken");
  assert.equal(requireTag(apply(fresh, events.message_stop), "assembling").stopped, true);
  const ignored = apply(withText, { type: "content_block_delta", index: 0, delta: { type: "unknown" } });
  assert.deepEqual(ignored, withText);
});

test("sse assembly: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 30);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionSse(states[stateId], events[eventId]);
      if (legal.has(id)) requireOk(result);
      else assert.equal(result.ok, false, id);
    }
  }
});

test("sse assembly: guards allow and deny", () => {
  assert.equal(hasBlockType({ type: "text" }), true);
  assert.equal(hasBlockType(null), false);
  assert.equal(hasBlockType({}), false);
  assert.equal(canApplyDelta(fresh, 0, { type: "text_delta", text: "A" }), false);
  const text = requireTag(withText, "assembling");
  assert.equal(canApplyDelta(text, 0, { type: "text_delta", text: "A" }), true);
  assert.equal(canApplyDelta(text, 0, null), false);
});

test("sse assembly: a missing index shares slot 0, and token sums keep the old rules", () => {
  const missing = sseEvent({ type: "content_block_start", content_block: { type: "text", text: "a" } });
  const zero = sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "a" } });
  assert.deepEqual(apply(fresh, missing), apply(fresh, zero));

  let state = apply(fresh, {
    type: "message_start",
    message: {
      model: "m",
      usage: { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 1 },
    },
  });
  state = apply(state, {
    type: "message_delta",
    delta: {},
    usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 0 },
  });
  const afterQuiet = requireTag(state, "assembling");
  assert.equal(afterQuiet.inputTokens, 3);
  assert.equal(afterQuiet.outputTokens, 1);
  const afterCap = requireTag(
    apply(state, {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 10, output_tokens: 4 },
    }),
    "assembling",
  );
  assert.equal(afterCap.inputTokens, 10);
  assert.equal(afterCap.outputTokens, 4);
  assert.equal(afterCap.stopReason, "end_turn");

  const before = structuredClone(fresh);
  assert.equal(apply(fresh, events.delta_missing).tag, "broken");
  assert.deepEqual(fresh, before);

  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const rejected = commitSse(broken, events.other);
    assert.equal(rejected.ok, false);
    assert.match(lines[0] ?? "", /sse_assembly/);
  } finally {
    console.warn = original;
  }
});

test("sse assembly: an unknown event is logged by type and not by payload", () => {
  const secret = "HIDDEN-TOOL-INPUT";
  const event = { type: "mystery", block: { input: secret } } as unknown as SseEvent;
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = commitSse(fresh, event);
    assert.equal(result.ok, false);
    assert.equal("event" in result && result.event, "mystery");
    assert.equal("reason" in result && result.reason, "unhandled event");
    assert.equal(lines.length, 1);
    assert.equal((lines[0] ?? "").includes(secret), false);
  } finally {
    console.warn = original;
  }
});

test("sse assembly: a local stream rebuilds blocks, and a bad frame fails the round", async () => {
  const frames = [
    { type: "message_start", message: { model: "stream-model", usage: { input_tokens: 3, output_tokens: 1 } } },
    { type: "ping" },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { n: 1 } } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "t", name: "search" },
    },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"x"}' } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "server_tool_use", id: "s", name: "web" } },
    { type: "content_block_stop", index: 2 },
    { type: "content_block_start", index: 3, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 3, delta: { type: "thinking_delta", thinking: "hmm" } },
    { type: "content_block_delta", index: 3, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 3 },
    { type: "content_block_start", index: 4, content_block: { type: "tool_use", id: "bad", name: "search" } },
    { type: "content_block_delta", index: 4, delta: { type: "input_json_delta", partial_json: "not-json" } },
    { type: "content_block_stop", index: 4 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 6 } },
    { type: "message_stop" },
  ];
  const body = frames.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join("");
  const texts: string[] = [];
  let tools = 0;
  const ok = await streamRound({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    tools: [],
    messages: [{ role: "user", content: "q" }],
    maxTokens: 16,
    timeoutMs: 1000,
    fetch: async () => new Response(body),
    onText: (delta) => texts.push(delta),
    onToolUse: () => {
      tools += 1;
    },
  });
  const round = requireOk(ok);
  assert.equal(round.text, "Hi");
  assert.equal(round.model, "stream-model");
  assert.equal(round.stopReason, "tool_use");
  assert.deepEqual(round.usage, { inputTokens: 3, outputTokens: 6 });
  assert.deepEqual(texts, ["Hi"]);
  assert.equal(tools, 3);
  assert.equal(Array.isArray(round.content[0]?.citations), true);
  assert.equal(round.content[3]?.thinking, "hmm");
  assert.equal(round.content[3]?.signature, "sig");
  assert.deepEqual(
    round.toolUses.map((t) => ({ name: t.name, input: t.input, invalid: t.invalid })),
    [
      { name: "search", input: { q: "x" }, invalid: false },
      { name: "search", input: {}, invalid: true },
    ],
  );

  const early = await streamRound({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    tools: [],
    messages: [{ role: "user", content: "q" }],
    maxTokens: 16,
    timeoutMs: 1000,
    fetch: async () =>
      new Response(
        [
          'data: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"nope"}}\n\n',
        ].join(""),
      ),
    onText: () => texts.push("late"),
  });
  assert.deepEqual(early, { ok: false, code: "upstream_error", usage: { inputTokens: 7, outputTokens: 1 } });
  assert.deepEqual(texts, ["Hi"]);
});
