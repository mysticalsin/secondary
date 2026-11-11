/**
 * Opening one streaming model round. Retry is allowed once, and only on a
 * retryable HTTP status before the body is parsed. A timeout never retries.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";
import { isRetryableHttpStatus } from "./retryable-http.ts";

export type StreamFailure = "upstream_error" | "timeout";

export type StreamOpenState =
  | { tag: "opening"; attempt: 0 | 1 }
  | { tag: "streaming" }
  | { tag: "failed"; code: StreamFailure };

export type StreamOpenEvent =
  | { type: "http"; status: number; hasBody: boolean }
  | { type: "timeout" }
  | { type: "transport" };

export type StreamOpenEffect = { type: "retry"; delayMs: number } | { type: "read" } | { type: "fail" };

export type StreamOpenStep =
  | { ok: true; state: StreamOpenState; effects: StreamOpenEffect[] }
  | IllegalTransition;

export const streamMayRetry = (state: StreamOpenState): boolean =>
  state.tag === "opening" && state.attempt === 0;

const fail = (code: StreamFailure): StreamOpenStep => ({
  ok: true,
  state: { tag: "failed", code },
  effects: [{ type: "fail" }],
});

export function transitionStreamOpen(
  state: StreamOpenState,
  event: StreamOpenEvent,
): StreamOpenStep {
  if (state.tag === "failed") {
    return reject("stream_open", "failed", event.type, "the round already failed");
  }
  if (state.tag === "streaming") {
    if (event.type === "timeout") return fail("timeout");
    if (event.type === "transport") return fail("upstream_error");
    return reject(
      "stream_open",
      "streaming",
      event.type,
      "headers were already accepted, so this round cannot retry",
    );
  }
  if (event.type === "timeout") return fail("timeout");
  if (event.type === "transport") return fail("upstream_error");
  if (isRetryableHttpStatus(event.status)) {
    if (streamMayRetry(state)) {
      return {
        ok: true,
        state: { tag: "opening", attempt: 1 },
        effects: [{ type: "retry", delayMs: 250 }],
      };
    }
    return fail("upstream_error");
  }
  if (event.status >= 200 && event.status < 300 && event.hasBody) {
    return { ok: true, state: { tag: "streaming" }, effects: [{ type: "read" }] };
  }
  return fail("upstream_error");
}

export const commitStreamOpen = (state: StreamOpenState, event: StreamOpenEvent): StreamOpenStep =>
  commit(transitionStreamOpen(state, event));

