/**
 * Stream-open retry machine. Responses are local. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { streamRound } from "../../recovered-source/worker/src/agent/stream.ts";
import { requireFail, requireOk, requireTag } from "./require-ok.ts";
import {
  commitStreamOpen,
  streamMayRetry,
  type StreamOpenEvent,
  type StreamOpenState,
  transitionStreamOpen,
} from "../../src/state/stream-open.ts";

const opening = (attempt: 0 | 1): StreamOpenState => ({ tag: "opening", attempt });
const streaming: StreamOpenState = { tag: "streaming" };
const failed: StreamOpenState = { tag: "failed", code: "timeout" };

const events = {
  http429: { type: "http", status: 429, hasBody: true } as const,
  http400: { type: "http", status: 400, hasBody: true } as const,
  http200: { type: "http", status: 200, hasBody: true } as const,
  http204: { type: "http", status: 204, hasBody: false } as const,
  timeout: { type: "timeout" } as const,
  transport: { type: "transport" } as const,
};

const states = {
  first: opening(0),
  second: opening(1),
  streaming,
  failed,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "first:http429",
  "first:http400",
  "first:http200",
  "first:http204",
  "first:timeout",
  "first:transport",
  "second:http429",
  "second:http400",
  "second:http200",
  "second:http204",
  "second:timeout",
  "second:transport",
  "streaming:timeout",
  "streaming:transport",
]);

const okSse = [
  'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":1,"output_tokens":1}}}',
  "",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
  "",
  'data: {"type":"message_stop"}',
  "",
  "",
].join("\n");

const sse = (status: number, body?: string): Response => {
  if (body === undefined) return new Response(null, { status });
  return new Response(new TextEncoder().encode(body), { status });
};

const round = (
  fetch: (url: string) => Promise<Response>,
  sleep: (ms: number) => Promise<void> = async () => {},
) =>
  streamRound({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    tools: [],
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 20,
    timeoutMs: 50,
    fetch: async (url) => fetch(url),
    sleep,
  });

test("stream open: every legal transition", () => {
  const again = requireOk(transitionStreamOpen(opening(0), events.http429));
  assert.deepEqual(again.state, { tag: "opening", attempt: 1 });
  assert.deepEqual(again.effects, [{ type: "retry", delayMs: 250 }]);
  assert.equal(requireTag(requireOk(transitionStreamOpen(opening(1), events.http429)).state, "failed").code, "upstream_error");
  assert.deepEqual(requireOk(transitionStreamOpen(opening(0), events.http400)).state, {
    tag: "failed",
    code: "upstream_error",
  });
  const read = requireOk(transitionStreamOpen(opening(0), events.http200));
  assert.equal(requireTag(read.state, "streaming").tag, "streaming");
  assert.deepEqual(read.effects, [{ type: "read" }]);
  assert.equal(requireTag(requireOk(transitionStreamOpen(opening(1), events.http200)).state, "streaming").tag, "streaming");

  for (const id of ["first", "second"] as const) {
    assert.equal(requireTag(requireOk(transitionStreamOpen(states[id], events.http204)).state, "failed").code, "upstream_error");
    assert.equal(requireTag(requireOk(transitionStreamOpen(states[id], events.timeout)).state, "failed").code, "timeout");
    assert.equal(requireTag(requireOk(transitionStreamOpen(states[id], events.transport)).state, "failed").code, "upstream_error");
  }

  const lateTimeout = requireOk(transitionStreamOpen(streaming, events.timeout));
  assert.equal(requireTag(lateTimeout.state, "failed").code, "timeout");
  assert.deepEqual(lateTimeout.effects, [{ type: "fail" }]);
  assert.equal(
    requireTag(requireOk(transitionStreamOpen(streaming, events.transport)).state, "failed").code,
    "upstream_error",
  );
});

test("stream open: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 24);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionStreamOpen(states[stateId], events[eventId] as StreamOpenEvent);
      if (legal.has(id)) requireOk(result);
      else assert.equal(requireFail(result).machine, "stream_open", id);
    }
  }
});

test("stream open: guards allow and deny", () => {
  assert.equal(streamMayRetry(opening(0)), true);
  assert.equal(streamMayRetry(opening(1)), false);
  assert.equal(streamMayRetry(streaming), false);
  assert.equal(
    requireTag(requireOk(transitionStreamOpen(opening(0), { type: "http", status: 200, hasBody: true })).state, "streaming").tag,
    "streaming",
  );
  assert.equal(
    requireTag(requireOk(transitionStreamOpen(opening(0), { type: "http", status: 200, hasBody: false })).state, "failed").tag,
    "failed",
  );
  assert.equal(
    requireTag(requireOk(transitionStreamOpen(opening(0), { type: "http", status: 503, hasBody: false })).state, "opening").tag,
    "opening",
  );
});

test("stream open: a retryable status retries once and a broken stream does not", async () => {
  const delays: number[] = [];
  let n = 0;
  const retried = await round(
    async () => {
      n += 1;
      return n === 1 ? sse(429, "") : sse(200, okSse);
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(requireOk(retried).stopReason, "end_turn");
  assert.deepEqual(delays, [250]);
  assert.equal(n, 2);

  let fatalTries = 0;
  const fatal = await round(async () => {
    fatalTries += 1;
    return sse(400, "");
  }, async () => {
    throw new Error("fatal status must not sleep");
  });
  assert.deepEqual(fatal, { ok: false, code: "upstream_error", usage: null });
  assert.equal(fatalTries, 1);

  let timed = 0;
  const timeout = await round(async () => {
    timed += 1;
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  });
  assert.deepEqual(timeout, { ok: false, code: "timeout", usage: null });
  assert.equal(timed, 1);

  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const rejected = commitStreamOpen(streaming, events.http429);
    assert.equal(rejected.ok, false);
    assert.match(lines[0] ?? "", /stream_open/);
  } finally {
    console.warn = original;
  }
});
