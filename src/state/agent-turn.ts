/**
 * One agent turn. Each model round either answers, fails, or (before the last
 * round) runs tools and continues. The loop performs the model call and the tools.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type TurnFailure = "ai_budget_exhausted" | "ai_unavailable";

export type AgentTurnState =
  | { tag: "round"; round: number; calls: number; maxRounds: number }
  | { tag: "tools"; round: number; calls: number; maxRounds: number; toolUses: number }
  | { tag: "answered"; truncated: boolean }
  | { tag: "failed"; code: TurnFailure };

export type AgentTurnEvent =
  | { type: "budget_denied" }
  | { type: "upstream_failed" }
  | { type: "stop_end" }
  | { type: "stop_max_tokens" }
  | { type: "stop_tool"; count: number }
  | { type: "stop_other" }
  | { type: "tools_finished" };

export type AgentTurnEffect = { type: "answer" } | { type: "run_tools" } | { type: "stop" };

export type AgentTurnStep =
  | { ok: true; state: AgentTurnState; effects: AgentTurnEffect[] }
  | IllegalTransition;

/** The round the for-loop treated as its last: tools are not run. */
export const isLastRound = (state: { round: number; maxRounds: number }): boolean =>
  state.round === state.maxRounds;

export const hasToolUses = (count: number): boolean => count > 0;

export function startAgentTurn(maxRounds: number): AgentTurnState {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    return { tag: "failed", code: "ai_unavailable" };
  }
  return { tag: "round", round: 1, calls: 0, maxRounds };
}

const stop = (code: TurnFailure): AgentTurnStep => ({
  ok: true,
  state: { tag: "failed", code },
  effects: [{ type: "stop" }],
});

export function transitionAgentTurn(state: AgentTurnState, event: AgentTurnEvent): AgentTurnStep {
  if (state.tag === "tools") {
    if (event.type !== "tools_finished") {
      return reject("agent_turn", "tools", event.type, "the tool round is still open");
    }
    return {
      ok: true,
      state: {
        tag: "round",
        round: state.round + 1,
        calls: state.calls + state.toolUses,
        maxRounds: state.maxRounds,
      },
      effects: [],
    };
  }
  if (state.tag !== "round") {
    return reject("agent_turn", state.tag, event.type, "the turn already finished");
  }
  switch (event.type) {
    case "budget_denied":
      return stop("ai_budget_exhausted");
    case "upstream_failed":
    case "stop_other":
      return stop("ai_unavailable");
    case "stop_end":
      return { ok: true, state: { tag: "answered", truncated: false }, effects: [{ type: "answer" }] };
    case "stop_max_tokens":
      return { ok: true, state: { tag: "answered", truncated: true }, effects: [{ type: "answer" }] };
    case "stop_tool":
      if (!hasToolUses(event.count) || isLastRound(state)) return stop("ai_unavailable");
      return {
        ok: true,
        state: {
          tag: "tools",
          round: state.round,
          calls: state.calls,
          maxRounds: state.maxRounds,
          toolUses: event.count,
        },
        effects: [{ type: "run_tools" }],
      };
    case "tools_finished":
      return reject("agent_turn", "round", "tools_finished", "this round has no tools to finish");
    default: {
      const unreachable: never = event;
      return reject("agent_turn", "round", "unknown", `unhandled ${JSON.stringify(unreachable)}`);
    }
  }
}

export const commitAgentTurn = (state: AgentTurnState, event: AgentTurnEvent): AgentTurnStep =>
  commit(transitionAgentTurn(state, event));

export type StoredAgentTurn = { v: 1; state: AgentTurnState };

const SAFE_TURN: AgentTurnState = { tag: "failed", code: "ai_unavailable" };

const isState = (v: unknown): v is AgentTurnState => {
  if (!v || typeof v !== "object") return false;
  const s = v as AgentTurnState;
  if (s.tag === "failed") return s.code === "ai_budget_exhausted" || s.code === "ai_unavailable";
  if (s.tag === "answered") return typeof s.truncated === "boolean";
  if (s.tag === "round") {
    return Number.isInteger(s.round) && Number.isInteger(s.calls) && Number.isInteger(s.maxRounds);
  }
  return (
    s.tag === "tools" &&
    Number.isInteger(s.round) &&
    Number.isInteger(s.calls) &&
    Number.isInteger(s.maxRounds) &&
    Number.isInteger(s.toolUses)
  );
};

export const encodeAgentTurn = (state: AgentTurnState): StoredAgentTurn => ({ v: 1, state });

/** Unknown JSON loads as a failed turn so a reload cannot run tools. */
export function decodeAgentTurn(raw: unknown): AgentTurnState {
  if (!raw || typeof raw !== "object") return SAFE_TURN;
  const rec = raw as { v?: unknown; state?: unknown };
  if (rec.v !== 1 || !isState(rec.state)) return SAFE_TURN;
  return rec.state;
}
