/**
 * Agent turn rounds. No model call and no network.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireFail, requireOk, requireTag } from "./require-ok.ts";
import {
  boundedToolCount,
  commitAgentTurn,
  hasToolUses,
  isLastRound,
  startAgentTurn,
  toolUsesCounted,
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
  tools_finished: { type: "tools_finished", ran: 2 } as const,
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
  assert.deepEqual(requireOk(transitionAgentTurn(round(1), events.stop_end)).state, {
    tag: "answered",
    truncated: false,
  });
  assert.deepEqual(requireOk(transitionAgentTurn(round(4), events.stop_max_tokens)).state, {
    tag: "answered",
    truncated: true,
  });
  assert.equal(
    requireTag(requireOk(transitionAgentTurn(round(2), events.budget_denied)).state, "failed").code,
    "ai_budget_exhausted",
  );
  const run = requireOk(transitionAgentTurn(round(1), events.stop_tool));
  assert.equal(requireTag(run.state, "tools").toolUses, 2);
  assert.deepEqual(run.effects, [{ type: "run_tools" }]);
  assert.equal(
    requireTag(requireOk(transitionAgentTurn(round(4), events.stop_tool)).state, "failed").code,
    "ai_unavailable",
  );
  assert.equal(requireTag(requireOk(transitionAgentTurn(round(1), events.stop_empty)).state, "failed").tag, "failed");
  assert.equal(requireTag(requireOk(transitionAgentTurn(round(1), events.stop_other)).state, "failed").tag, "failed");
  assert.deepEqual(requireOk(transitionAgentTurn(tools, events.tools_finished)).state, round(2, 4, 2));
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
      if (legal.has(id)) requireOk(result);
      else requireFail(result);
    }
  }
});

test("agent turn: guards allow and deny", () => {
  assert.equal(isLastRound(round(4)), true);
  assert.equal(isLastRound(round(3)), false);
  assert.equal(hasToolUses(2), true);
  assert.equal(hasToolUses(0), false);
});

test("agent turn: a bad tool count is rejected, and an unknown event logs only its type", () => {
  for (const count of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    const rejected = requireFail(transitionAgentTurn(round(1), { type: "stop_tool", count }));
    assert.equal(rejected.event, "stop_tool");
    assert.equal(rejected.reason.includes(String(count)), false);
  }
  assert.equal(boundedToolCount(2), true);
  assert.equal(boundedToolCount(Number.NaN), false);

  const secret = "tool-payload-SECRET";
  const event = { type: "mystery", text: secret } as unknown as AgentTurnEvent;
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = commitAgentTurn(round(1), event);
    assert.equal(result.ok, false);
    assert.equal("event" in result && result.event, "mystery");
    assert.equal("reason" in result && result.reason, "unhandled event");
    assert.equal((lines[0] ?? "").includes(secret), false);
  } finally {
    console.warn = original;
  }
});

test("agent turn: uses the cap refused are not added to the call count", () => {
  assert.equal(toolUsesCounted(5, 10, 6, 12), 2);
  assert.equal(toolUsesCounted(5, 12, 6, 12), 0);
  assert.equal(toolUsesCounted(Number.POSITIVE_INFINITY, 0, 6, 12), 0);
  const partial = requireOk(
    transitionAgentTurn(
      { tag: "tools", round: 1, calls: 10, maxRounds: 4, toolUses: 5 },
      { type: "tools_finished", ran: 2 },
    ),
  );
  assert.equal(requireTag(partial.state, "round").calls, 12);
  const over = requireFail(
    transitionAgentTurn(
      { tag: "tools", round: 1, calls: 10, maxRounds: 4, toolUses: 5 },
      { type: "tools_finished", ran: 6 },
    ),
  );
  assert.equal(over.event, "tools_finished");
  const bad = requireFail(
    transitionAgentTurn(tools, { type: "tools_finished", ran: Number.NaN }),
  );
  assert.equal(bad.reason.includes("NaN"), false);
});

test("agent turn: tools on the last round fail, and finishing tools counts every use", () => {
  assert.equal(
    requireTag(requireOk(transitionAgentTurn(round(4, 4, 3), { type: "stop_tool", count: 1 })).state, "failed").tag,
    "failed",
  );
  assert.deepEqual(
    requireOk(
      transitionAgentTurn(
        { tag: "tools", round: 2, calls: 3, maxRounds: 4, toolUses: 2 },
        events.tools_finished,
      ),
    ).state,
    round(3, 4, 5),
  );
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
