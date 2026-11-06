// Tokens per answer: the same ten answers written as ViewPlan JSON (named props, nested, minified: the
// most favourable shape for JSON) and as the line format. Output tokens are what a model writes per
// answer; prompt tokens are what it reads per request.
//
// Counter: Anthropic's count_tokens when ANTHROPIC_API_KEY is set (exact for the model), otherwise a
// local estimate with js-tiktoken o200k_base, which is NOT Claude's tokenizer. The ratio between two
// formats is the meaningful number; absolute counts differ by tokenizer.
//
//   node --experimental-strip-types packages/contracts/scripts/bench-tokens.ts [--json]

import { getEncoding } from "js-tiktoken";
import { toJSONSchema } from "zod";
import {
  type AgentNode,
  agentSystemPrompt,
  COMPONENTS,
  planProgram,
  viewOfProgram,
} from "../src/agent-ui/index.ts";

const brains = [
  { id: "c_bid", name: "Bid & Pre-sales", type: "department" },
  { id: "a_acme", name: "Acme", type: "account" },
  { id: "c_delivery", name: "Delivery excellence", type: "department" },
  { id: "me", name: "My Secondary", type: "personal" },
];

export const QUESTIONS: {
  text?: string;
  action?: { action: string; values: Record<string, string> };
}[] = [
  { text: "Show me where Bid & Pre-sales stands this month" },
  { text: "How is Acme doing this week?" },
  { text: "Compare Bid & Pre-sales and Delivery excellence" },
  { action: { action: "focus", values: { brain: "a_acme" } } },
  { action: { action: "filter", values: { brain: "c_bid", q: "pricing method" } } },
  { text: "Find pages about public sector pricing" },
  { text: "Where does Delivery excellence stand this quarter?" },
  { text: "What needs my attention?" },
  { text: "montre-moi Acme ce mois" },
  { action: { action: "compare", values: { a: "a_acme", b: "c_bid" } } },
];

/** The same view as the nested JSON plan a model would write instead of lines. */
function asJson(n: AgentNode): unknown {
  const slot = (COMPONENTS[n.type as keyof typeof COMPONENTS] as { slot?: string } | undefined)
    ?.slot;
  const props: Record<string, unknown> = { ...n.props };
  if (slot) props[slot] = n.children.map(asJson);
  return { type: n.type, props };
}

export interface Row {
  question: string;
  jsonTokens: number;
  prettyTokens: number;
  lineTokens: number;
  saving: number;
}

async function counter(): Promise<{ name: string; count: (s: string) => Promise<number> }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const model = process.env.AI_MODEL ?? "claude-sonnet-5-5";
    return {
      name: `Anthropic count_tokens (${model})`,
      count: async (s) => {
        const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model, messages: [{ role: "user", content: s }] }),
        });
        const j = (await r.json()) as { input_tokens: number };
        return j.input_tokens;
      },
    };
  }
  const enc = getEncoding("o200k_base");
  return {
    name: "ESTIMATE: js-tiktoken o200k_base (not Claude's tokenizer; compare the ratio, not the counts)",
    count: async (s) => enc.encode(s).length,
  };
}

export async function bench() {
  const c = await counter();
  const rows: Row[] = [];
  for (const q of QUESTIONS) {
    const { program } = planProgram({ ...q, brains });
    const view = viewOfProgram(program);
    if (!view.root || view.dropped) throw new Error(`invalid benchmark program: ${program}`);
    const plan = { version: 1, title: "View", components: [asJson(view.root)] };
    const jsonTokens = await c.count(JSON.stringify(plan));
    const prettyTokens = await c.count(JSON.stringify(plan, null, 2));
    const lineTokens = await c.count(program);
    rows.push({
      question: q.text ?? `[action] ${q.action?.action}`,
      jsonTokens,
      prettyTokens,
      lineTokens,
      saving: 1 - lineTokens / jsonTokens,
    });
  }
  const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
  const jsonPrompt = [
    "Output one JSON object {version:1,title,components:[{type,props}]}. Components (props are queries only):",
    ...Object.entries(COMPONENTS).map(
      ([name, s]) =>
        `${name}: ${s.description} props=${JSON.stringify(toJSONSchema(s.props as never, { io: "input" }))}`,
    ),
  ].join("\n");
  const prompts = {
    json: await c.count(jsonPrompt),
    line: await c.count(agentSystemPrompt()),
  };
  return {
    counter: c.name,
    rows,
    total: {
      json: sum((r) => r.jsonTokens),
      pretty: sum((r) => r.prettyTokens),
      line: sum((r) => r.lineTokens),
    },
    meanSaving: rows.reduce((n, r) => n + r.saving, 0) / rows.length,
    prompts,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await bench();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`counter: ${r.counter}\n`);
    console.log(
      "question".padEnd(52),
      "json".padStart(6),
      "pretty".padStart(7),
      "lines".padStart(6),
      "vs json".padStart(8),
      "vs pretty".padStart(10),
    );
    for (const x of r.rows)
      console.log(
        x.question.slice(0, 50).padEnd(52),
        String(x.jsonTokens).padStart(6),
        String(x.prettyTokens).padStart(7),
        String(x.lineTokens).padStart(6),
        `${(x.saving * 100).toFixed(1)}%`.padStart(8),
        `${((1 - x.lineTokens / x.prettyTokens) * 100).toFixed(1)}%`.padStart(10),
      );
    console.log(
      `\ntotal minified json ${r.total.json}, pretty json ${r.total.pretty}, lines ${r.total.line}; saving ${((1 - r.total.line / r.total.json) * 100).toFixed(1)}% vs minified, ${((1 - r.total.line / r.total.pretty) * 100).toFixed(1)}% vs pretty (mean per answer ${(r.meanSaving * 100).toFixed(1)}% vs minified)`,
    );
    console.log(
      `system prompt tokens: json-plan ${r.prompts.json}, line language ${r.prompts.line}`,
    );
  }
}
