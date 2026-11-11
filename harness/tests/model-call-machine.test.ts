/**
 * Model-call retry machine. Fetch is a fake. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { callModel } from "../../recovered-source/worker/src/ai/anthropic.ts";
import { commit } from "../../src/state/illegal.ts";
import {
  commitModelCall,
  modelAttemptsRemain,
  type ModelCallState,
  startModelCall,
  transitionModelCall,
} from "../../src/state/model-call.ts";

const usage = { inputTokens: 3, outputTokens: 4 };

const calling = (attempt: number, retries = 2): Extract<ModelCallState, { tag: "calling" }> => ({
  tag: "calling",
  attempt,
  retries,
  last: "upstream_error",
});

const doneFail: ModelCallState = { tag: "done", reply: { ok: false, code: "timeout" } };
const doneOk: ModelCallState = {
  tag: "done",
  reply: { ok: true, text: "kept", model: "m", usage },
};

const events = {
  http429: { type: "http", status: 429 } as const,
  http400: { type: "http", status: 400 } as const,
  http200: { type: "http", status: 200 } as const,
  timeout: { type: "timeout" } as const,
  transport: { type: "transport" } as const,
  refused: { type: "refused" } as const,
  truncated: { type: "truncated" } as const,
  empty: { type: "empty" } as const,
  success: { type: "success", text: "yes", model: "claude", usage } as const,
};

const states = {
  canRetry: calling(0, 2),
  lastTry: calling(2, 2),
  doneFail,
  doneOk,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

/** Legal (state, event) pairs. Everything else in the cross product must be rejected. */
const legal = new Set<string>([
  "canRetry:http429",
  "canRetry:http400",
  "canRetry:timeout",
  "canRetry:transport",
  "canRetry:refused",
  "canRetry:truncated",
  "canRetry:empty",
  "canRetry:success",
  "lastTry:http429",
  "lastTry:http400",
  "lastTry:timeout",
  "lastTry:transport",
  "lastTry:refused",
  "lastTry:truncated",
  "lastTry:empty",
  "lastTry:success",
]);

test("model call: every legal transition", () => {
  const step = (id: StateId, event: EventId) =>
    transitionModelCall(states[id], events[event]);

  const again = step("canRetry", "http429");
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.state.tag, "calling");
    if (again.state.tag === "calling") {
      assert.equal(again.state.attempt, 1);
      assert.equal(again.state.last, "upstream_error");
    }
    assert.deepEqual(again.effects, [{ type: "backoff", delayMs: 250 }]);
  }

  const fatal = step("canRetry", "http400");
  assert.equal(fatal.ok, true);
  if (fatal.ok && fatal.state.tag === "done") {
    assert.deepEqual(fatal.state.reply, { ok: false, code: "upstream_error" });
    assert.deepEqual(fatal.effects, [{ type: "finish" }]);
  }

  const timed = step("canRetry", "timeout");
  assert.equal(timed.ok, true);
  if (timed.ok && timed.state.tag === "calling") assert.equal(timed.state.last, "timeout");

  const thrown = step("canRetry", "transport");
  assert.equal(thrown.ok, true);
  if (thrown.ok && thrown.state.tag === "calling") assert.equal(thrown.state.last, "upstream_error");

  for (const event of ["refused", "truncated", "empty"] as const) {
    const next = step("canRetry", event);
    assert.equal(next.ok, true);
    if (next.ok && next.state.tag === "done" && next.state.reply.ok === false) {
      assert.equal(next.state.reply.code, event);
    }
  }

  const ok = step("canRetry", "success");
  assert.equal(ok.ok, true);
  if (ok.ok && ok.state.tag === "done") {
    assert.deepEqual(ok.state.reply, { ok: true, text: "yes", model: "claude", usage });
  }

  const spent = step("lastTry", "http429");
  assert.equal(spent.ok, true);
  if (spent.ok && spent.state.tag === "done" && spent.state.reply.ok === false) {
    assert.equal(spent.state.reply.code, "upstream_error");
  }
  const spentTimeout = step("lastTry", "timeout");
  assert.equal(spentTimeout.ok, true);
  if (spentTimeout.ok && spentTimeout.state.tag === "done" && spentTimeout.state.reply.ok === false) {
    assert.equal(spentTimeout.state.reply.code, "timeout");
  }
  const spentTransport = step("lastTry", "transport");
  assert.equal(spentTransport.ok, true);
  if (
    spentTransport.ok &&
    spentTransport.state.tag === "done" &&
    spentTransport.state.reply.ok === false
  ) {
    assert.equal(spentTransport.state.reply.code, "upstream_error");
  }

  const fraction = transitionModelCall(calling(0, 1.5), events.http429);
  assert.equal(fraction.ok, true);
  if (fraction.ok && fraction.state.tag === "calling") assert.equal(fraction.state.attempt, 1);
  const fractionStop = transitionModelCall(calling(1, 1.5), events.http429);
  assert.equal(fractionStop.ok, true);
  if (fractionStop.ok) assert.equal(fractionStop.state.tag, "done");

  const secondDelay = transitionModelCall(calling(1, 3), events.timeout);
  assert.equal(secondDelay.ok, true);
  if (secondDelay.ok) assert.deepEqual(secondDelay.effects, [{ type: "backoff", delayMs: 500 }]);
});

test("model call: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 36);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionModelCall(states[stateId], events[eventId]);
      if (legal.has(id)) assert.equal(result.ok, true, id);
      else {
        assert.equal(result.ok, false, id);
        if (!result.ok) assert.equal(result.machine, "model_call");
      }
    }
  }
});

test("model call: guards allow and deny", () => {
  assert.equal(modelAttemptsRemain(calling(0, 2)), true);
  assert.equal(modelAttemptsRemain(calling(2, 2)), false);
  assert.equal(modelAttemptsRemain(calling(0, 0)), false);
  assert.equal(modelAttemptsRemain(calling(1, 1.5)), false);
  assert.equal(startModelCall(-1).tag, "done");
  assert.equal(startModelCall(Number.NaN).tag, "done");
  const retryable = transitionModelCall(calling(0, 1), { type: "http", status: 503 });
  const fatal = transitionModelCall(calling(0, 1), { type: "http", status: 422 });
  assert.equal(retryable.ok && retryable.state.tag === "calling", true);
  assert.equal(fatal.ok && fatal.state.tag === "done", true);
});

test("model call: commit logs a rejected transition and does not change state", () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = commitModelCall(doneFail, events.success);
    assert.equal(result.ok, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /illegal_transition/);
    assert.match(lines[0] ?? "", /model_call/);
    const quiet = commit(transitionModelCall(calling(0), events.success));
    assert.equal(quiet.ok, true);
    assert.equal(lines.length, 1);
  } finally {
    console.warn = original;
  }
});

test("model call: a retryable status is retried once, a fatal status is not", async () => {
  const seen: string[] = [];
  const delays: number[] = [];
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  let n = 0;
  const statuses = [429, 200];
  const reply = await callModel({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    user: "u",
    maxTokens: 20,
    timeoutMs: 50,
    retries: 1,
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetch: async (url) => {
      seen.push(url);
      const status = statuses[n] ?? 500;
      n += 1;
      if (status === 200) {
        return json(200, {
          model: "claude-test",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 2, output_tokens: 1 },
        });
      }
      return json(status, {});
    },
  });
  assert.deepEqual(reply, {
    ok: true,
    text: "hello",
    model: "claude-test",
    usage: { inputTokens: 2, outputTokens: 1 },
  });
  assert.deepEqual(delays, [250]);
  assert.equal(seen.length, 2);

  let fatalTries = 0;
  const fatal = await callModel({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    user: "u",
    maxTokens: 20,
    timeoutMs: 50,
    retries: 3,
    sleep: async () => {
      throw new Error("fatal HTTP must not sleep");
    },
    fetch: async () => {
      fatalTries += 1;
      return json(400, {});
    },
  });
  assert.deepEqual(fatal, { ok: false, code: "upstream_error" });
  assert.equal(fatalTries, 1);

  let timeouts = 0;
  const timed = await callModel({
    apiKey: "not-a-real-key",
    model: "claude-test",
    system: "s",
    user: "u",
    maxTokens: 20,
    timeoutMs: 50,
    retries: 0,
    fetch: async () => {
      timeouts += 1;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.deepEqual(timed, { ok: false, code: "timeout" });
  assert.equal(timeouts, 1);
});
