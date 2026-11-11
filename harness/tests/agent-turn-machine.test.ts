/**
 * Agent turn rounds. No model call and no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  commitAgentTurn,
  decodeAgentTurn,
  encodeAgentTurn,
  hasToolUses,
  isLastRound,
  startAgentTurn,
  type AgentTurnEvent,
  type AgentTurnState,
  transitionAgentTurn,
} from "../../src/state/agent-turn.ts";

const round = (n: number, maxRounds = 4, calls = 0): Extract<AgentTurnState, { tag: "round" }> => ({
  tag: "round",
  round: n,
  calls,
  maxRounds,
});
const tools: AgentTurnState = {
  tag: "tools",
  round: 1,
  calls: 0,
  maxRounds: 4,
  toolUses: 2,
};
const answered: AgentTurnState = { tag: "answered", truncated: false };
const failed: AgentTurnState = { tag: "failed", code: "ai_unavailable" };

const events = {
  budget_denied: { type: "budget_denied" } as const,
  upstream_failed: { type: "upstream_failed" } as const,
  stop_end: { type: "stop_end" } as const,
  stop_max_tokens: { type: "stop_max_tokens" } as const,
  stop_tool: { type: "stop_tool", count: 2 } as const,
  stop_empty: { type: "stop_tool", count: 0 } as const,
  stop_other: { type: "stop_other" } as const,
  tools_finished: { type: "tools_finished" } as const,
};

const states = {
  early: round(1),
  last: round(4),
  tools,
  answered,
  failed,
};

type StateId = keyof typeof states;
type EventId = keyof typeof events;

const legal = new Set<string>([
  "early:budget_denied",
  "early:upstream_failed",
  "early:stop_end",
  "early:stop_max_tokens",
  "early:stop_tool",
  "early:stop_empty",
  "early:stop_other",
  "last:budget_denied",
  "last:upstream_failed",
  "last:stop_end",
  "last:stop_max_tokens",
  "last:stop_tool",
  "last:stop_empty",
  "last:stop_other",
  "tools:tools_finished",
]);

test("agent turn: every legal transition", () => {
  const answer = transitionAgentTurn(round(1), events.stop_end);
  assert.equal(answer.ok, true);
  if (answer.ok) assert.deepEqual(answer.state, { tag: "answered", truncated: false });
  const cut = transitionAgentTurn(round(4), events.stop_max_tokens);
  assert.equal(cut.ok, true);
  if (cut.ok) assert.deepEqual(cut.state, { tag: "answered", truncated: true });
  const budget = transitionAgentTurn(round(2), events.budget_denied);
  assert.equal(budget.ok, true);
  if (budget.ok && budget.state.tag === "failed") assert.equal(budget.state.code, "ai_budget_exhausted");
  const run = transitionAgentTurn(round(1), events.stop_tool);
  assert.equal(run.ok, true);
  if (run.ok && run.state.tag === "tools") {
    assert.equal(run.state.toolUses, 2);
    assert.deepEqual(run.effects, [{ type: "run_tools" }]);
  }
  const banned = transitionAgentTurn(round(4), events.stop_tool);
  assert.equal(banned.ok, true);
  if (banned.ok && banned.state.tag === "failed") assert.equal(banned.state.code, "ai_unavailable");
  const empty = transitionAgentTurn(round(1), events.stop_empty);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.state.tag, "failed");
  const other = transitionAgentTurn(round(1), events.stop_other);
  assert.equal(other.ok, true);
  if (other.ok) assert.equal(other.state.tag, "failed");
  const next = transitionAgentTurn(tools, events.tools_finished);
  assert.equal(next.ok, true);
  if (next.ok) assert.deepEqual(next.state, round(2, 4, 2));
  assert.equal(startAgentTurn(0).tag, "failed");
  assert.deepEqual(startAgentTurn(4), round(1));
});

test("agent turn: illegal pairs are the complement of the legal table", () => {
  const stateIds = Object.keys(states) as StateId[];
  const eventIds = Object.keys(events) as EventId[];
  assert.equal(stateIds.length * eventIds.length, 40);
  for (const stateId of stateIds) {
    for (const eventId of eventIds) {
      const id = `${stateId}:${eventId}`;
      const result = transitionAgentTurn(states[stateId], events[eventId] as AgentTurnEvent);
      if (legal.has(id)) assert.equal(result.ok, true, id);
      else assert.equal(result.ok, false, id);
    }
  }
});

test("agent turn: guards allow and deny", () => {
  assert.equal(isLastRound(round(4)), true);
  assert.equal(isLastRound(round(3)), false);
  assert.equal(hasToolUses(2), true);
  assert.equal(hasToolUses(0), false);
});

test("agent turn: unknown stored value fails and a known value round-trips", () => {
  assert.deepEqual(decodeAgentTurn({ v: 2 }), failed);
  const stored = encodeAgentTurn(tools);
  assert.deepEqual(decodeAgentTurn(JSON.parse(JSON.stringify(stored))), tools);
});

test("agent turn: tools on the last round fail, and finishing tools counts every use", () => {
  const last = transitionAgentTurn(round(4, 4, 3), { type: "stop_tool", count: 1 });
  assert.equal(last.ok, true);
  if (last.ok) assert.equal(last.state.tag, "failed");
  const continued = transitionAgentTurn(
    { tag: "tools", round: 2, calls: 3, maxRounds: 4, toolUses: 2 },
    events.tools_finished,
  );
  assert.equal(continued.ok, true);
  if (continued.ok) assert.deepEqual(continued.state, round(3, 4, 5));
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const rejected = commitAgentTurn(answered, events.stop_end);
    assert.equal(rejected.ok, false);
    assert.match(lines[0] ?? "", /agent_turn/);
  } finally {
    console.warn = original;
  }
});
