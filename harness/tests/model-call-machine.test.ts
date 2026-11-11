/**
 * Model-call retry machine. Fetch is a fake. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { callModel } from "../../recovered-source/worker/src/ai/anthropic.ts";
import { commit } from "../../src/state/illegal.ts";
import { requireFail, requireOk, requireTag } from "./require-ok.ts";
import {
  commitModelCall,
  modelAttemptsRemain,
  type ModelCallEvent,
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

  const again = requireOk(step("canRetry", "http429"));
  const againState = requireTag(again.state, "calling");
  assert.equal(againState.attempt, 1);
  assert.equal(againState.last, "upstream_error");
  assert.deepEqual(again.effects, [{ type: "backoff", delayMs: 250 }]);

  const fatal = requireOk(step("canRetry", "http400"));
  assert.deepEqual(requireTag(fatal.state, "done").reply, { ok: false, code: "upstream_error" });
  assert.deepEqual(fatal.effects, [{ type: "finish" }]);

  assert.equal(requireTag(requireOk(step("canRetry", "timeout")).state, "calling").last, "timeout");
  assert.equal(
    requireTag(requireOk(step("canRetry", "transport")).state, "calling").last,
    "upstream_error",
  );

  for (const event of ["refused", "truncated", "empty"] as const) {
    assert.deepEqual(requireTag(requireOk(step("canRetry", event)).state, "done").reply, {
      ok: false,
      code: event,
    });
  }

  assert.deepEqual(requireTag(requireOk(step("canRetry", "success")).state, "done").reply, {
    ok: true,
    text: "yes",
    model: "claude",
    usage,
  });
  assert.deepEqual(requireTag(requireOk(step("lastTry", "http429")).state, "done").reply, {
    ok: false,
    code: "upstream_error",
  });
  assert.deepEqual(requireTag(requireOk(step("lastTry", "timeout")).state, "done").reply, {
    ok: false,
    code: "timeout",
  });
  assert.deepEqual(requireTag(requireOk(step("lastTry", "transport")).state, "done").reply, {
    ok: false,
    code: "upstream_error",
  });

  assert.equal(requireTag(requireOk(transitionModelCall(calling(0, 1.5), events.http429)).state, "calling").attempt, 1);
  assert.equal(requireTag(requireOk(transitionModelCall(calling(1, 1.5), events.http429)).state, "done").tag, "done");
  assert.deepEqual(requireOk(transitionModelCall(calling(1, 3), events.timeout)).effects, [
    { type: "backoff", delayMs: 500 },
  ]);
});

test("model call: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 36);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionModelCall(states[stateId], events[eventId]);
      if (legal.has(id)) requireOk(result);
      else assert.equal(requireFail(result).machine, "model_call", id);
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
  assert.equal(requireTag(requireOk(transitionModelCall(calling(0, 1), { type: "http", status: 503 })).state, "calling").tag, "calling");
  assert.equal(requireTag(requireOk(transitionModelCall(calling(0, 1), { type: "http", status: 422 })).state, "done").tag, "done");
});

test("model call: an unknown event is logged by type and not by payload", () => {
  const secret = "HIDDEN-REPLY";
  const event = { type: "mystery", text: secret } as unknown as ModelCallEvent;
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = commitModelCall(calling(0, 1), event);
    assert.equal(result.ok, false);
    assert.equal("event" in result && result.event, "mystery");
    assert.equal("reason" in result && result.reason, "unhandled event");
    assert.equal(lines.length, 1);
    assert.equal((lines[0] ?? "").includes(secret), false);
  } finally {
    console.warn = original;
  }
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
