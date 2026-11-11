/**
 * Stream-open retry machine. Responses are local. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { streamRound } from "../../recovered-source/worker/src/agent/stream.ts";
import {
  commitStreamOpen,
  decodeStreamOpen,
  encodeStreamOpen,
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
  const again = transitionStreamOpen(opening(0), events.http429);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.deepEqual(again.state, { tag: "opening", attempt: 1 });
    assert.deepEqual(again.effects, [{ type: "retry", delayMs: 250 }]);
  }
  const spent = transitionStreamOpen(opening(1), events.http429);
  assert.equal(spent.ok, true);
  if (spent.ok && spent.state.tag === "failed") assert.equal(spent.state.code, "upstream_error");

  const fatal = transitionStreamOpen(opening(0), events.http400);
  assert.equal(fatal.ok, true);
  if (fatal.ok) assert.deepEqual(fatal.state, { tag: "failed", code: "upstream_error" });

  const read = transitionStreamOpen(opening(0), events.http200);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.state.tag, "streaming");
    assert.deepEqual(read.effects, [{ type: "read" }]);
  }
  const secondRead = transitionStreamOpen(opening(1), events.http200);
  assert.equal(secondRead.ok, true);
  if (secondRead.ok) assert.equal(secondRead.state.tag, "streaming");

  for (const id of ["first", "second"] as const) {
    const empty = transitionStreamOpen(states[id], events.http204);
    assert.equal(empty.ok, true);
    if (empty.ok && empty.state.tag === "failed") assert.equal(empty.state.code, "upstream_error");
    const timed = transitionStreamOpen(states[id], events.timeout);
    assert.equal(timed.ok, true);
    if (timed.ok && timed.state.tag === "failed") assert.equal(timed.state.code, "timeout");
    const thrown = transitionStreamOpen(states[id], events.transport);
    assert.equal(thrown.ok, true);
    if (thrown.ok && thrown.state.tag === "failed") assert.equal(thrown.state.code, "upstream_error");
  }

  const lateTimeout = transitionStreamOpen(streaming, events.timeout);
  assert.equal(lateTimeout.ok, true);
  if (lateTimeout.ok && lateTimeout.state.tag === "failed") {
    assert.equal(lateTimeout.state.code, "timeout");
    assert.deepEqual(lateTimeout.effects, [{ type: "fail" }]);
  }
  const lateThrow = transitionStreamOpen(streaming, events.transport);
  assert.equal(lateThrow.ok, true);
  if (lateThrow.ok && lateThrow.state.tag === "failed") {
    assert.equal(lateThrow.state.code, "upstream_error");
  }
});

test("stream open: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 24);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionStreamOpen(states[stateId], events[eventId] as StreamOpenEvent);
      if (legal.has(id)) assert.equal(result.ok, true, id);
      else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.machine, "stream_open");
      }
    }
  }
});

test("stream open: guards allow and deny", () => {
  assert.equal(streamMayRetry(opening(0)), true);
  assert.equal(streamMayRetry(opening(1)), false);
  assert.equal(streamMayRetry(streaming), false);
  const withBody = transitionStreamOpen(opening(0), { type: "http", status: 200, hasBody: true });
  const without = transitionStreamOpen(opening(0), { type: "http", status: 200, hasBody: false });
  assert.equal(withBody.ok && withBody.state.tag === "streaming", true);
  assert.equal(without.ok && without.state.tag === "failed", true);
  const retryable = transitionStreamOpen(opening(0), { type: "http", status: 503, hasBody: false });
  assert.equal(retryable.ok && retryable.state.tag === "opening", true);
});

test("stream open: unknown stored value fails closed and a known value round-trips", () => {
  assert.deepEqual(decodeStreamOpen({ v: 9 }), { tag: "failed", code: "upstream_error" });
  assert.deepEqual(decodeStreamOpen("legacy"), { tag: "failed", code: "upstream_error" });
  const stored = encodeStreamOpen(opening(1));
  assert.deepEqual(decodeStreamOpen(JSON.parse(JSON.stringify(stored))), opening(1));
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
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.stopReason, "end_turn");
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
