// Meeting brief generation. The order is fixed so that a refusal never costs tokens:
// switch and key, then the contract constraint, then the budget, then evidence, then the model.

import type { AdmittedView, Principal } from "@secondary/policy";
import { callModel, extractJson, type FetchFn } from "./anthropic.ts";
import { type BudgetStore, reserve } from "./budget.ts";
import { type AiEnv, aiState, estimateTokens, LIMITS } from "./config.ts";
import { type Evidence, gatherEvidence } from "./evidence.ts";
import {
  type BriefSection,
  buildUserPrompt,
  SYSTEM_PROMPT,
  validateBrief,
  withoutPersonalClaims,
} from "./prompt.ts";
import { countByCategory, type ExcludedSegment } from "./segments.ts";

export const REGION_NOTE = "Anthropic API, processing location per Anthropic terms";
export const PROCESSOR = "Anthropic API";

export type Brief = {
  target: { accountId: string | null; nodeId: string; meetingId: string | null };
  question: string | null;
  title: string;
  sections: BriefSection[];
  /** Everything the model was shown, so a citation resolves to a source item. */
  evidence: { id: string; nodeId: string; title: string; plane: string }[];
  /** What R-110 removed from the prompt. Shown to the owner in the response, never stored. */
  excluded: (ExcludedSegment & { evidenceId: string })[];
  insufficientEvidence: boolean;
  dropped: { uncited: number; badCitations: number };
  disclosure: {
    processor: string;
    model: string;
    region: string;
    generatedAt: string;
    usage: { inputTokens: number; outputTokens: number };
  };
};

export type Refusal =
  | { ok: false; status: 503; error: "ai_disabled" | "ai_not_configured"; reason: string }
  | { ok: false; status: 403; error: "ai_constraint"; reason: string; aiProcessing: string }
  | { ok: false; status: 429; error: "ai_budget_exhausted"; reason: string }
  | { ok: false; status: 502; error: "ai_unavailable"; reason: string };

export type AiGate =
  | { ok: true; apiKey: string; model: string; dailyBudget: number; timeoutMs: number }
  | Refusal;

/**
 * The one gate every AI path goes through (briefs, planner, any ingest hook). `switchOn` is the
 * tenant's `ai` kill switch: pass `session.switches.ai`. Off means no call, whatever the env says.
 */
export function gate(env: AiEnv, switchOn = true): AiGate {
  if (!switchOn)
    return {
      ok: false,
      status: 503,
      error: "ai_disabled",
      reason: "AI processing is switched off",
    };
  const s = aiState(env);
  if (s.state === "disabled")
    return {
      ok: false,
      status: 503,
      error: "ai_disabled",
      reason: "AI processing is not enabled",
    };
  if (s.state === "contract_missing")
    return {
      ok: false,
      status: 503,
      error: "ai_not_configured",
      reason: "AI processor contract not approved",
    };
  if (s.state === "not_configured")
    return {
      ok: false,
      status: 503,
      error: "ai_not_configured",
      reason: "AI processor not configured",
    };
  return {
    ok: true,
    apiKey: s.apiKey,
    model: s.model,
    dailyBudget: s.dailyBudget,
    timeoutMs: s.timeoutMs,
  };
}

/** The account's contract record. Anything but an explicit "allowed" refuses, with no call. */
export function contractGate(
  view: AdmittedView,
  accountId: string | undefined,
): Extract<Refusal, { error: "ai_constraint" }> | null {
  if (!accountId) return null;
  const v = view.nodes.get(accountId)?.facts["AI use with client"];
  const state = v === "allowed" || v === "not allowed" ? v : "unknown";
  if (state === "allowed") return null;
  return {
    ok: false,
    status: 403,
    error: "ai_constraint",
    aiProcessing: state,
    reason:
      state === "not allowed"
        ? "This customer's contract does not allow AI processing of their material"
        : "This customer's AI processing status is unknown, so nothing was sent",
  };
}

export type BriefInput = {
  env: Env;
  tenantId: string;
  view: AdmittedView;
  principal: Principal;
  ai: Extract<AiGate, { ok: true }>;
  budget: BudgetStore;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now: number;
  target: { accountId: string | null; nodeId: string; meetingId: string | null };
  question: string | null;
};

export async function generateBrief(i: BriefInput): Promise<{ ok: true; brief: Brief } | Refusal> {
  const root = i.view.nodes.get(i.target.nodeId);
  const meeting = i.target.meetingId ? i.view.nodes.get(i.target.meetingId) : undefined;
  const ev = await gatherEvidence(i.env, i.tenantId, i.view, {
    rootId: i.target.nodeId,
    ...(i.target.meetingId ? { firstId: i.target.meetingId } : {}),
    ...(i.question ? { question: i.question } : {}),
  });
  const base = {
    target: i.target,
    question: i.question,
    evidence: ev.items.map(({ id, nodeId, title, plane }) => ({ id, nodeId, title, plane })),
    excluded: ev.excluded,
  };
  const disclosure = (model: string, usage = { inputTokens: 0, outputTokens: 0 }) => ({
    processor: PROCESSOR,
    model,
    region: REGION_NOTE,
    generatedAt: new Date(i.now).toISOString(),
    usage,
  });
  // No evidence: say so without spending a token.
  if (!ev.items.length)
    return {
      ok: true,
      brief: {
        ...base,
        title: "Meeting brief",
        sections: [
          {
            heading: "Unknown",
            claims: [
              {
                text: "No admitted evidence was available for this request.",
                citations: [],
                unknown: true,
              },
            ],
          },
        ],
        insufficientEvidence: true,
        dropped: { uncited: 0, badCitations: 0 },
        disclosure: disclosure(i.ai.model),
      },
    };

  const user = buildUserPrompt({
    accountLabel: root?.label ?? i.target.nodeId,
    ...(meeting ? { meetingLabel: meeting.label } : {}),
    ...(i.question ? { question: i.question } : {}),
    evidence: ev.items as Evidence[],
  });
  const estimate = estimateTokens(SYSTEM_PROMPT) + estimateTokens(user) + LIMITS.maxOutputTokens;
  const hold = await reserve(i.budget, estimate, i.ai.dailyBudget);
  if (!hold)
    return {
      ok: false,
      status: 429,
      error: "ai_budget_exhausted",
      reason: "The daily AI budget for your organisation is used up",
    };
  const reply = await callModel({
    apiKey: i.ai.apiKey,
    model: i.ai.model,
    system: SYSTEM_PROMPT,
    user,
    maxTokens: LIMITS.maxOutputTokens,
    timeoutMs: i.ai.timeoutMs,
    retries: LIMITS.retries,
    ...(i.fetch ? { fetch: i.fetch } : {}),
    ...(i.sleep ? { sleep: i.sleep } : {}),
  });
  await hold.settle(reply.ok ? reply.usage.inputTokens + reply.usage.outputTokens : estimate);
  const unavailable: Refusal = {
    ok: false,
    status: 502,
    error: "ai_unavailable",
    reason: "The AI processor did not return a usable brief. Nothing was saved",
  };
  if (!reply.ok) return unavailable;
  const parsed = validateBrief(extractJson(reply.text), new Set(ev.items.map((e) => e.id)));
  if (!parsed) return unavailable;
  const sections = withoutPersonalClaims(parsed.sections);
  const unknownOnly = sections.length === 0;
  return {
    ok: true,
    brief: {
      ...base,
      title: parsed.title,
      sections: unknownOnly
        ? [
            {
              heading: "Unknown",
              claims: [
                {
                  text: "The model returned nothing that the evidence supports.",
                  citations: [],
                  unknown: true,
                },
              ],
            },
          ]
        : sections,
      insufficientEvidence: unknownOnly,
      dropped: parsed.dropped,
      disclosure: disclosure(reply.model, reply.usage),
    },
  };
}

/** Readable text for the Personal Brain item. Titles and ids only, never excerpts or excluded text. */
export function renderBrief(b: Brief): string {
  const cited = new Map(b.evidence.map((e) => [e.id, e]));
  const lines = [b.title, ""];
  for (const s of b.sections) {
    lines.push(`## ${s.heading}`);
    for (const c of s.claims)
      lines.push(
        c.unknown
          ? `- Unknown: ${c.text}`
          : `- ${c.text} [${c.citations.map((x) => cited.get(x)?.nodeId ?? x).join(", ")}]`,
      );
    lines.push("");
  }
  const ex = countByCategory(b.excluded);
  const n = b.excluded.length;
  if (n)
    lines.push(
      `Excluded as personal (R-110): ${n} segment${n === 1 ? "" : "s"} (${Object.entries(ex)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}).`,
    );
  lines.push(
    `Generated by ${b.disclosure.processor}, model ${b.disclosure.model}. ${b.disclosure.region}. ${b.disclosure.generatedAt}.`,
  );
  return lines.join("\n").slice(0, 8_000);
}
