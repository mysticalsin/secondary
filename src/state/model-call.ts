/**
 * One non-streaming model call. The loop in `callModel` performs fetch and sleep.
 * This function only decides whether that loop may try again.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";
import { isRetryableHttpStatus } from "./retryable-http.ts";

export type ModelFailure = "upstream_error" | "timeout" | "refused" | "truncated" | "empty";

export type ModelCallReply =
  | {
      ok: true;
      text: string;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; code: ModelFailure };

export type ModelCallState =
  | { tag: "calling"; attempt: number; retries: number; last: ModelFailure }
  | { tag: "done"; reply: ModelCallReply };

export type ModelCallEvent =
  | { type: "http"; status: number }
  | { type: "timeout" }
  | { type: "transport" }
  | { type: "refused" }
  | { type: "truncated" }
  | { type: "empty" }
  | {
      type: "success";
      text: string;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
    };

export type ModelCallEffect = { type: "backoff"; delayMs: number } | { type: "finish" };

export type ModelCallStep =
  | { ok: true; state: ModelCallState; effects: ModelCallEffect[] }
  | IllegalTransition;

/** Another iteration of `for (attempt = 0; attempt <= retries; attempt++)` still fits. */
export const modelAttemptsRemain = (state: {
  attempt: number;
  retries: number;
}): boolean => state.attempt + 1 <= state.retries;

const backoffMs = (nextAttempt: number): number => 250 * 2 ** (nextAttempt - 1);

/** `retries < 0` or a non-number never enters the loop and fails closed. */
export function startModelCall(retries: number): ModelCallState {
  if (typeof retries !== "number" || !(retries >= 0)) {
    return { tag: "done", reply: { ok: false, code: "upstream_error" } };
  }
  return { tag: "calling", attempt: 0, retries, last: "upstream_error" };
}

const done = (reply: ModelCallReply): ModelCallStep => ({
  ok: true,
  state: { tag: "done", reply },
  effects: [{ type: "finish" }],
});

const retry = (
  state: Extract<ModelCallState, { tag: "calling" }>,
  last: ModelFailure,
): ModelCallStep => {
  const attempt = state.attempt + 1;
  return {
    ok: true,
    state: { tag: "calling", attempt, retries: state.retries, last },
    effects: [{ type: "backoff", delayMs: backoffMs(attempt) }],
  };
};

export function transitionModelCall(state: ModelCallState, event: ModelCallEvent): ModelCallStep {
  if (state.tag === "done") {
    return reject("model_call", "done", event.type, "the call already finished");
  }
  switch (event.type) {
    case "http": {
      if (event.status >= 200 && event.status < 300) {
        return reject(
          "model_call",
          "calling",
          "http",
          "a success status is a body event, not an HTTP failure",
        );
      }
      if (isRetryableHttpStatus(event.status) && modelAttemptsRemain(state)) {
        return retry(state, "upstream_error");
      }
      return done({ ok: false, code: "upstream_error" });
    }
    case "timeout":
      return modelAttemptsRemain(state) ? retry(state, "timeout") : done({ ok: false, code: "timeout" });
    case "transport":
      return modelAttemptsRemain(state)
        ? retry(state, "upstream_error")
        : done({ ok: false, code: "upstream_error" });
    case "refused":
      return done({ ok: false, code: "refused" });
    case "truncated":
      return done({ ok: false, code: "truncated" });
    case "empty":
      return done({ ok: false, code: "empty" });
    case "success":
      return done({
        ok: true,
        text: event.text,
        model: event.model,
        usage: event.usage,
      });
    default: {
      const unreachable: never = event;
      const kind = (unreachable as { type?: unknown }).type;
      return reject(
        "model_call",
        "calling",
        typeof kind === "string" ? kind : "unknown",
        "unhandled event",
      );
    }
  }
}

export const commitModelCall = (state: ModelCallState, event: ModelCallEvent): ModelCallStep =>
  commit(transitionModelCall(state, event));
