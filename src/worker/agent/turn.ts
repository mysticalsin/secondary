// One My Agent turn (POST /v1/agent/turn). The answer is a program of lines of the contract's line
// language. Two ways to get it: the deterministic planner (no model, always available) or the model
// through a bounded, read-only tool loop. Both go through the same gate before a line is sent: one
// statement of a registered component, props valid, every brain id one the caller may open.
//
// Order of events: meta, line*, dropped?, usage, done (or error). On the model path a finished line is
// checked and sent while the model is still writing, so cards appear as they are written. If the round
// turns out not to be the answer (a tool call follows, or the model fails), `reset` tells the client to
// clear what it has and the turn goes on (a second `meta` says which mode finally answered). The
// deterministic path sends meta and lines once the plan is known.
//
// The usage ledger and the receipt are written before the stream closes and do not depend on the client
// still listening: sending to a gone client is ignored, and the whole turn runs under waitUntil.

import {
  type BrainRef,
  clean,
  LIMITS,
  matchBrains,
  planProgram,
  type TurnRequestValue,
} from "../../../packages/contracts/src/agent-ui/index.ts";
import { contractGate, gate } from "../ai/brief.ts";
import { sessionSwitchOn } from "../switches.ts";
import { doBudget, withUserCap } from "../ai/budget.ts";
import { viewOf } from "../auth.ts";
import { GOVERNANCE_BRAINS } from "../brains/nav.ts";
import { admittedBrainParams, type Brain, brainOf } from "../brains/open.ts";
import { humanIdsOf } from "../human.ts";
import type { AppDeps } from "../types.ts";
import { audit, type C, sess } from "../ux/util.ts";
import { recordUsage } from "../uxv2/ledger.ts";
import { checkLines, hasRoot } from "./lines.ts";
import { runLoop } from "./loop.ts";
import { esc, runTool } from "./tools.ts";

export type Mode = "ai" | "deterministic";
type Send = (event: string, data: unknown) => Promise<void>;

const MAX_PREVIOUS_LINES = 60;

/** The brains the caller may open, in the order of the sidebar: Personal, governances, accounts, Global. */
export async function admittedBrains(c: C): Promise<Brain[]> {
  const ids = await humanIdsOf(c.env, sess(c));
  const opened = (
    await Promise.all(admittedBrainParams(c).map((p) => brainOf(c, p.param, ids)))
  ).filter((b): b is Brain => b !== null);
  const rank = (b: Brain): number =>
    b.param === "me"
      ? 0
      : b.param === "core"
        ? 99
        : Math.max(1, GOVERNANCE_BRAINS.findIndex(([, , node]) => node === b.param) + 1 || 50);
  return opened.sort((a, z) => rank(a) - rank(z) || a.label.localeCompare(z.label));
}

/** Brain ids a turn names: the ones whose name is in the text, and those in the action's values. */
function namedBrains(req: TurnRequestValue, refs: readonly BrainRef[]): Set<string> {
  const out = new Set<string>();
  const text = req.action?.action === "ask" ? req.action.values.text : req.text;
  if (text) for (const b of matchBrains(text, refs)) out.add(b.id);
  for (const k of ["brain", "a", "b"]) {
    const v = req.action?.values[k];
    if (v) out.add(v);
  }
  return out;
}

/** The one user message of the first round. Page text is never in it; the request text is escaped. */
function promptOf(req: TurnRequestValue): string {
  const parts: string[] = [];
  if (req.action) {
    const values = Object.entries(req.action.values)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    parts.push(`<action>${esc(`${req.action.action} ${values}`.trim())}</action>`);
  }
  if (req.text) parts.push(`<question>${esc(req.text)}</question>`);
  if (req.previous) {
    // Only statement lines of the last answer: a refinement edits a plan, never prose.
    const lines = clean(req.previous).lines.slice(0, MAX_PREVIOUS_LINES);
    if (lines.length)
      parts.push(
        `<current_view>\n${esc(lines.join("\n"))}\n</current_view>\nThe question changes the current view: keep what still fits and write the whole program again.`,
      );
  }
  parts.push(
    `Language: ${req.lang ?? "the language of the question"}. Density: ${req.density ?? "comfortable"}.`,
  );
  return parts.join("\n");
}

export interface TurnInput {
  c: C;
  deps: AppDeps;
  req: TurnRequestValue;
  turnId: string;
  send: Send;
}

export async function runTurn({ c, deps, req, turnId, send }: TurnInput): Promise<void> {
  const s = sess(c);
  const now = s.ctx.now;
  let mode: Mode = "deterministic";
  let reason: string | undefined;
  let lines: string[] = [];
  let dropped = 0;
  let model: string | null = null;
  const tokens = { inputTokens: 0, outputTokens: 0 };
  let tools: string[] = [];
  let failed = false;

  // Lines go out as the model finishes them (each one checked alone). The final pass below checks the
  // whole text again, and only the lines not yet sent are sent then.
  let liveBuf = "";
  let liveSent = 0;
  let metaSent = false;
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (f: () => Promise<void>) => {
    queue = queue.then(f).catch(() => {});
  };
  let admittedIds: ReadonlySet<string> = new Set();
  const liveLine = (line: string) => {
    if (liveSent >= LIMITS.maxLines) return;
    const ok = checkLines(line, admittedIds).lines[0];
    if (!ok) return;
    liveSent++;
    enqueue(async () => {
      if (!metaSent) {
        metaSent = true;
        await send("meta", { turnId, mode: "ai" });
      }
      await send("line", { text: ok });
    });
  };
  const onText = (delta: string) => {
    liveBuf += delta;
    for (let at = liveBuf.indexOf("\n"); at >= 0; at = liveBuf.indexOf("\n")) {
      const line = liveBuf.slice(0, at).trim();
      liveBuf = liveBuf.slice(at + 1);
      if (line) liveLine(line);
    }
  };
  /** What was sent is not the answer: tell the client to start again. */
  const reset = () => {
    liveBuf = "";
    if (!liveSent) return;
    liveSent = 0;
    metaSent = false;
    enqueue(() => send("reset", {}));
  };

  try {
    const brains = await admittedBrains(c);
    const refs: BrainRef[] = brains.map((b) => ({
      id: b.param,
      name: b.label,
      type: b.facts.type,
    }));
    const admitted = new Set(brains.map((b) => b.param));
    admittedIds = admitted;
    const view = viewOf(s);

    // ---- the gate: nothing leaves the system unless every check says yes ----
    const g = gate(c.env, sessionSwitchOn(s, "aiCall"));
    let ai: Extract<typeof g, { ok: true }> | null = null;
    // Personal is never sent to the model, and an account counts only when its contract says "allowed".
    const refused = new Set(
      brains
        .filter((b) => b.facts.type === "account" && contractGate(view, b.nodeId) !== null)
        .map((b) => b.param),
    );
    if (!g.ok) reason = g.error;
    else if ([...namedBrains(req, refs)].some((id) => refused.has(id))) reason = "ai_constraint";
    else ai = g;

    if (ai) {
      try {
        const reach = brains.filter((b) => b.param !== "me" && !refused.has(b.param));
        const budget = withUserCap(
          doBudget(c.env, s.tenantId, now),
          doBudget(c.env, s.tenantId, now, `u-${s.principal.id}`),
          ai.userDailyBudget,
        );
        const out = await runLoop({
          ai,
          budget,
          user: promptOf(req),
          runTool: (name, input) => runTool({ c, brains: reach }, name, input),
          onText,
          onToolUse: reset,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        });
        tokens.inputTokens = out.usage.inputTokens;
        tokens.outputTokens = out.usage.outputTokens;
        model = out.model;
        tools = out.tools;
        if (out.result.ok) {
          // Out of tokens: the last line is unfinished by definition, and is not sent.
          let text = out.result.text;
          let cut = 0;
          if (out.result.truncated) {
            const at = text.lastIndexOf("\n");
            if (text.slice(at + 1).trim()) cut = 1;
            text = at < 0 ? "" : text.slice(0, at);
          }
          const checked = checkLines(text, admitted);
          checked.dropped += cut;
          // Nothing valid, or no root to hang it on: that is no answer.
          if (checked.lines.length && hasRoot(checked.lines)) {
            mode = "ai";
            lines = checked.lines;
            dropped = checked.dropped;
          } else reason = "ai_unavailable";
        } else reason = out.result.code;
      } catch (e) {
        // The model path must never break the page: the deterministic answer takes over.
        console.warn(JSON.stringify({ at: "agent_ai", error: String(e).slice(0, 160) }));
        mode = "deterministic";
        lines = [];
        dropped = 0;
        reason = "ai_unavailable";
        reset();
      }
    }

    if (mode === "deterministic") {
      // Anything the model already showed is withdrawn before the built-in answer starts.
      reset();
      // `previous` is for the model: the planner answers the question or action on its own.
      const plan = planProgram({
        ...(req.text ? { text: req.text } : {}),
        ...(req.action ? { action: req.action } : {}),
        brains: refs,
        ...(req.lang ? { lang: req.lang } : {}),
      });
      const checked = checkLines(plan.program, admitted);
      lines = checked.lines;
      dropped = checked.dropped;
    }
  } catch (e) {
    failed = true;
    console.warn(JSON.stringify({ at: "agent_turn", error: String(e).slice(0, 160) }));
  }

  // ---- the books first, so they are right when the client sees `done` (or has gone away) ----
  const spent = tokens.inputTokens + tokens.outputTokens;
  await recordUsage(c.env, s.tenantId, s.principal.id, now, {
    capability: "agent",
    tokens: spent,
    runs: 1,
    answers: failed ? 0 : 1,
  });
  // Ids and counts only: never the question, a title or any page text.
  const note = `mode=${failed ? "error" : mode} lines=${lines.length} dropped=${dropped}${
    reason ? ` reason=${reason}` : ""
  }${tools.length ? ` tools=${tools.join(",")}` : ""}`;
  const receipted = await audit(c, {
    action: "agent.turn",
    nodeId: turnId,
    scopeId: null,
    revision: null,
    reason: note,
  }).catch(() => false);
  if (!receipted) console.warn(JSON.stringify({ at: "agent_turn", error: "receipt_not_written" }));

  if (failed) {
    await send("error", { code: "internal_error" });
    return;
  }
  await queue;
  if (!metaSent) await send("meta", { turnId, mode, ...(reason ? { reason } : {}) });
  for (const text of lines.slice(mode === "ai" ? liveSent : 0)) await send("line", { text });
  if (dropped > 0) await send("dropped", { count: dropped });
  await send("usage", { ...tokens, model });
  await send("done", { turnId, lines: lines.length });
}
