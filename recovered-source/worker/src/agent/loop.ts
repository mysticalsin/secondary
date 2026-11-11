// The bounded tool loop of one AI turn: at most AGENT_LIMITS.maxRounds model rounds. A round that ends
// in `tool_use` runs the tools (read only, with the caller's rights) and sends every result back in ONE
// user message, after the assistant message exactly as streamed (thinking blocks and signatures
// included: earlier turns are never edited). Only the last round's text is the answer; text written
// before a tool call is dropped with its round.
//
// Budget: each round reserves its estimate before the call and settles to the real tokens after it.
// Nothing here shows anything to the person: the caller checks the text line by line.

import {
  commitAgentTurn,
  type AgentTurnEvent,
  type AgentTurnState,
  startAgentTurn,
} from "../../../../src/state/agent-turn.ts";
import {
  AGENT_TOOLS,
  type AgentToolName,
  agentSystemPrompt,
  agentToolDefs,
} from "../../../../packages/contracts/src/agent-ui/index.ts";
import type { FetchFn } from "../ai/anthropic.ts";
import type { AiGate } from "../ai/brief.ts";
import { type BudgetStore, reserve } from "../ai/budget.ts";
import { AGENT_LIMITS, estimateTokens } from "../ai/config.ts";
import { type Block, type Message, streamRound, type ToolDef, type Usage } from "./stream.ts";
import type { ToolResult } from "./tools.ts";

export type LoopResult =
  | {
      ok: true;
      /** The text of the last round. */
      text: string;
      model: string;
      /** The model stopped because it ran out of tokens: the text may end mid-line. */
      truncated: boolean;
    }
  | { ok: false; code: "ai_unavailable" | "ai_budget_exhausted" };

export interface LoopOutcome {
  result: LoopResult;
  /** Real tokens the provider reported, over every round that got as far as reporting. */
  usage: Usage;
  /** Model name once any round answered. */
  model: string | null;
  /** Tool names used, in order of first use. */
  tools: string[];
}

export interface LoopInput {
  ai: Extract<AiGate, { ok: true }>;
  budget: BudgetStore;
  user: string;
  runTool: (name: AgentToolName, input: Record<string, unknown>) => Promise<ToolResult>;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  onText?: (delta: string) => void;
  onToolUse?: () => void;
}

let frozen: { system: string; tools: ToolDef[] } | null = null;
/** The system prompt and tool list, built once: frozen text keeps the prompt cache warm. */
export function frozenPrompt(): { system: string; tools: ToolDef[] } {
  frozen ??= { system: agentSystemPrompt(), tools: agentToolDefs() };
  return frozen;
}

const isToolName = (n: string): n is AgentToolName => Object.hasOwn(AGENT_TOOLS, n);
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function runLoop(i: LoopInput): Promise<LoopOutcome> {
  const { system, tools } = frozenPrompt();
  const messages: Message[] = [{ role: "user", content: i.user }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const used: string[] = [];
  let model: string | null = null;
  const done = (result: LoopResult): LoopOutcome => ({ result, usage, model, tools: used });

  let state: AgentTurnState = startAgentTurn(AGENT_LIMITS.maxRounds);
  while (state.tag === "round") {
    const calls = state.calls;
    const estimate =
      estimateTokens(system) +
      estimateTokens(JSON.stringify(tools)) +
      estimateTokens(JSON.stringify(messages)) +
      AGENT_LIMITS.maxOutputTokens;
    const hold = await reserve(i.budget, estimate, i.ai.dailyBudget);
    if (!hold) {
      const denied = commitAgentTurn(state, { type: "budget_denied" });
      return done({
        ok: false,
        code: denied.ok && denied.state.tag === "failed" ? denied.state.code : "ai_budget_exhausted",
      });
    }
    const res = await streamRound({
      apiKey: i.ai.apiKey,
      model: i.ai.model,
      system,
      tools,
      messages,
      maxTokens: AGENT_LIMITS.maxOutputTokens,
      timeoutMs: i.ai.timeoutMs,
      ...(i.onText ? { onText: i.onText } : {}),
      ...(i.onToolUse ? { onToolUse: i.onToolUse } : {}),
      ...(i.fetch ? { fetch: i.fetch } : {}),
      ...(i.sleep ? { sleep: i.sleep } : {}),
    });
    const real = res.usage;
    if (real) {
      usage.inputTokens += real.inputTokens;
      usage.outputTokens += real.outputTokens;
    }
    // Real tokens when the provider said, else the estimate: a failed call is not free.
    await hold.settle(real ? real.inputTokens + real.outputTokens : estimate);
    if (res.ok) model = res.model;
    const event: AgentTurnEvent = !res.ok
      ? { type: "upstream_failed" }
      : res.stopReason === "end_turn" || res.stopReason === "stop_sequence"
        ? { type: "stop_end" }
        : res.stopReason === "max_tokens"
          ? { type: "stop_max_tokens" }
          : res.stopReason === "tool_use"
            ? { type: "stop_tool", count: res.toolUses.length }
            : { type: "stop_other" };
    const next = commitAgentTurn(state, event);
    if (!next.ok) return done({ ok: false, code: "ai_unavailable" });
    if (next.state.tag === "failed") return done({ ok: false, code: next.state.code });
    if (next.state.tag === "answered") {
      return done({
        ok: true,
        text: res.ok ? res.text : "",
        model: res.ok ? res.model : model ?? "",
        truncated: next.state.truncated,
      });
    }
    if (!res.ok || next.state.tag !== "tools") return done({ ok: false, code: "ai_unavailable" });
    state = next.state;

    const results: Block[] = await Promise.all(
      res.toolUses.map(async (t, n): Promise<Block> => {
        const fail = (why: string): Block => ({
          type: "tool_result",
          tool_use_id: t.id,
          content: why,
          is_error: true,
        });
        if (!isToolName(t.name)) return fail("unknown tool");
        if (t.invalid) return fail("invalid input: arguments are not a JSON object");
        if (n >= AGENT_LIMITS.maxCallsPerRound || calls + n >= AGENT_LIMITS.maxCallsPerTurn)
          return fail("too many tool calls");
        const parsed = AGENT_TOOLS[t.name].input.safeParse(asObject(t.input));
        if (!parsed.success) return fail("invalid input: arguments do not match the tool");
        if (!used.includes(t.name)) used.push(t.name);
        try {
          const r = await i.runTool(t.name, parsed.data as Record<string, unknown>);
          return {
            type: "tool_result",
            tool_use_id: t.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          };
        } catch {
          return fail("the tool failed");
        }
      }),
    );
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: results });
    const advanced = commitAgentTurn(state, { type: "tools_finished" });
    if (!advanced.ok || advanced.state.tag !== "round") {
      return done({ ok: false, code: "ai_unavailable" });
    }
    state = advanced.state;
  }
  return done({ ok: false, code: state.tag === "failed" ? state.code : "ai_unavailable" });
}
