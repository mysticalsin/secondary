/**
 * One streamed assistant message. Frame order and the block buffer live here.
 * The socket loop only reads bytes and runs the effects.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type SseBlock = { type: string; [k: string]: unknown };

export type SseAssembly = {
  tag: "assembling";
  blocks: (SseBlock | undefined)[];
  /** Partial tool JSON, keyed by block index. A present key is the old Map entry. */
  json: Record<string, string>;
  invalid: number[];
  model: string;
  stopReason: string;
  stopped: boolean;
  inputTokens: number;
  outputTokens: number;
};

export type SseState = SseAssembly | { tag: "broken" };

export type SseEvent =
  | { type: "message_start"; message: Record<string, unknown> }
  | { type: "content_block_start"; index: number; block: Record<string, unknown> | null }
  | { type: "content_block_delta"; index: number; delta: Record<string, unknown> | null }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: Record<string, unknown>; usage: Record<string, unknown> }
  | { type: "message_stop" }
  | { type: "error" }
  | { type: "other" };

export type SseEffect = { type: "text"; delta: string } | { type: "tool" };

export type SseStep = { ok: true; state: SseState; effects: SseEffect[] } | IllegalTransition;

/** Non-positive and non-finite indexes collapse to 0, matching the old `num` helper. */
export const sseIndex = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A content block the assembler can store. Missing or non-string type fails the round. */
export const hasBlockType = (block: Record<string, unknown> | null): block is SseBlock =>
  !!block && typeof block.type === "string";

/** A delta applies only to a block that already started, and only with a delta object. */
export const canApplyDelta = (
  state: SseAssembly,
  index: number,
  delta: Record<string, unknown> | null,
): boolean => state.blocks[index] !== undefined && delta !== null;

export function freshSse(model = ""): SseAssembly {
  return {
    tag: "assembling",
    blocks: [],
    json: {},
    invalid: [],
    model,
    stopReason: "",
    stopped: false,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Classify one parsed SSE object. Unknown types, including ping, are `other`. */
export function sseEvent(ev: Record<string, unknown>): SseEvent {
  switch (ev.type) {
    case "message_start":
      return { type: "message_start", message: isObj(ev.message) ? ev.message : {} };
    case "content_block_start":
      return {
        type: "content_block_start",
        index: sseIndex(ev.index),
        block: isObj(ev.content_block) ? ev.content_block : null,
      };
    case "content_block_delta":
      return {
        type: "content_block_delta",
        index: sseIndex(ev.index),
        delta: isObj(ev.delta) ? ev.delta : null,
      };
    case "content_block_stop":
      return { type: "content_block_stop", index: sseIndex(ev.index) };
    case "message_delta":
      return {
        type: "message_delta",
        delta: isObj(ev.delta) ? ev.delta : {},
        usage: isObj(ev.usage) ? ev.usage : {},
      };
    case "message_stop":
      return { type: "message_stop" };
    case "error":
      return { type: "error" };
    default:
      return { type: "other" };
  }
}

const stay = (
  state: SseAssembly,
  patch: Partial<SseAssembly> = {},
  effects: SseEffect[] = [],
): SseStep => ({ ok: true, state: { ...state, ...patch }, effects });

const fail = (): SseStep => ({ ok: true, state: { tag: "broken" }, effects: [] });

const markInvalid = (invalid: number[], index: number): number[] =>
  invalid.includes(index) ? invalid : [...invalid, index];

export function transitionSse(state: SseState, event: SseEvent): SseStep {
  if (state.tag === "broken") {
    return reject("sse_assembly", "broken", event.type, "the stream is already broken");
  }
  switch (event.type) {
    case "message_start": {
      const usage = isObj(event.message.usage) ? event.message.usage : {};
      return stay(state, {
        model: typeof event.message.model === "string" ? event.message.model : state.model,
        inputTokens:
          sseIndex(usage.input_tokens) +
          sseIndex(usage.cache_creation_input_tokens) +
          sseIndex(usage.cache_read_input_tokens),
        outputTokens: sseIndex(usage.output_tokens),
      });
    }
    case "content_block_start": {
      if (!hasBlockType(event.block)) return fail();
      const block = structuredClone(event.block);
      if (block.type === "text" && typeof block.text !== "string") block.text = "";
      if (block.type === "thinking" && typeof block.thinking !== "string") block.thinking = "";
      const blocks = state.blocks.slice();
      blocks[event.index] = block;
      const tool = block.type === "tool_use" || block.type === "server_tool_use";
      return stay(
        state,
        {
          blocks,
          json: tool ? { ...state.json, [String(event.index)]: "" } : state.json,
        },
        tool ? [{ type: "tool" }] : [],
      );
    }
    case "content_block_delta": {
      const current = state.blocks[event.index];
      if (!canApplyDelta(state, event.index, event.delta) || !current || !event.delta) return fail();
      const delta = event.delta;
      const block = { ...current };
      const blocks = state.blocks.slice();
      let json = state.json;
      const effects: SseEffect[] = [];
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        block.text = `${typeof current.text === "string" ? current.text : ""}${delta.text}`;
        effects.push({ type: "text", delta: delta.text });
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const key = String(event.index);
        json = { ...state.json, [key]: `${state.json[key] ?? ""}${delta.partial_json}` };
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        block.thinking = `${typeof current.thinking === "string" ? current.thinking : ""}${delta.thinking}`;
      } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
        block.signature = delta.signature;
      } else if (delta.type === "citations_delta" && delta.citation !== undefined) {
        block.citations = [...(Array.isArray(current.citations) ? current.citations : []), delta.citation];
      } else {
        return stay(state);
      }
      blocks[event.index] = block;
      return stay(state, { blocks, json }, effects);
    }
    case "content_block_stop": {
      const key = String(event.index);
      const current = state.blocks[event.index];
      if (!current || !(key in state.json)) return stay(state);
      const raw = state.json[key] ?? "";
      let input: unknown = {};
      let invalid = state.invalid;
      try {
        const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
        if (isObj(parsed)) input = parsed;
        else {
          input = {};
          invalid = markInvalid(state.invalid, event.index);
        }
      } catch {
        input = {};
        invalid = markInvalid(state.invalid, event.index);
      }
      const blocks = state.blocks.slice();
      blocks[event.index] = { ...current, input };
      return stay(state, { blocks, invalid });
    }
    case "message_delta": {
      let inputTokens = state.inputTokens;
      let outputTokens = state.outputTokens;
      if (sseIndex(event.usage.output_tokens)) outputTokens = sseIndex(event.usage.output_tokens);
      const more = sseIndex(event.usage.input_tokens) + sseIndex(event.usage.cache_creation_input_tokens);
      if (more) {
        inputTokens = Math.max(inputTokens, more + sseIndex(event.usage.cache_read_input_tokens));
      }
      return stay(state, {
        stopReason: typeof event.delta.stop_reason === "string" ? event.delta.stop_reason : state.stopReason,
        inputTokens,
        outputTokens,
      });
    }
    case "message_stop":
      return stay(state, { stopped: true });
    case "error":
      return fail();
    case "other":
      return stay(state);
    default: {
      const unreachable: never = event;
      return reject("sse_assembly", "assembling", "unknown", `unhandled ${JSON.stringify(unreachable)}`);
    }
  }
}

export const commitSse = (state: SseState, event: SseEvent): SseStep => commit(transitionSse(state, event));

type StoredBlock = { index: number; block: SseBlock };

export type StoredSse =
  | { v: 1; tag: "broken" }
  | {
      v: 1;
      tag: "assembling";
      blocks: StoredBlock[];
      json: Record<string, string>;
      invalid: number[];
      model: string;
      stopReason: string;
      stopped: boolean;
      inputTokens: number;
      outputTokens: number;
    };

const isBlock = (v: unknown): v is SseBlock => isObj(v) && typeof v.type === "string";

export function encodeSse(state: SseState): StoredSse {
  if (state.tag === "broken") return { v: 1, tag: "broken" };
  const blocks: StoredBlock[] = [];
  state.blocks.forEach((block, index) => {
    if (block) blocks.push({ index, block });
  });
  return {
    v: 1,
    tag: "assembling",
    blocks,
    json: state.json,
    invalid: state.invalid,
    model: state.model,
    stopReason: state.stopReason,
    stopped: state.stopped,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
  };
}

/** Unknown JSON loads as an empty assembly. It does not look like a broken round. */
export function decodeSse(raw: unknown): SseState {
  if (!isObj(raw) || raw.v !== 1) return freshSse();
  if (raw.tag === "broken") return { tag: "broken" };
  if (raw.tag !== "assembling" || !Array.isArray(raw.blocks) || !isObj(raw.json)) return freshSse();
  if (!Array.isArray(raw.invalid) || typeof raw.model !== "string") return freshSse();
  if (typeof raw.stopReason !== "string" || typeof raw.stopped !== "boolean") return freshSse();
  if (typeof raw.inputTokens !== "number" || typeof raw.outputTokens !== "number") return freshSse();
  const blocks: (SseBlock | undefined)[] = [];
  for (const item of raw.blocks) {
    if (!isObj(item) || typeof item.index !== "number" || !isBlock(item.block)) return freshSse();
    blocks[item.index] = item.block;
  }
  const json: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.json)) {
    if (typeof value !== "string") return freshSse();
    json[key] = value;
  }
  const invalid: number[] = [];
  for (const n of raw.invalid) {
    if (typeof n !== "number") return freshSse();
    invalid.push(n);
  }
  return {
    tag: "assembling",
    blocks,
    json,
    invalid,
    model: raw.model,
    stopReason: raw.stopReason,
    stopped: raw.stopped,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
  };
}
