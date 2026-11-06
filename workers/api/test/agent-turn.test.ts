// POST /v1/agent/turn, the deterministic path and the stream contract: event order, validation, limits,
// scoping by persona, usage, receipts. The AI path has its own file (agent-ai.test.ts).

import { beforeAll, describe, expect, it } from "vitest";
import { viewOfProgram } from "../../../packages/contracts/src/agent-ui/index.ts";
import { aiCall, KEY, raw, receiptsOf, streamModel, textRound, turn } from "./agent-helpers.ts";
import { as, call, json, type Loose, seed } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

/** The agent row of GET /v1/usage for one persona. */
async function agentUsage(
  persona: string,
): Promise<{ tokens: number; runs: number; answers: number }> {
  const u = await json<Loose>(await as(persona, "/v1/usage?period=7d"));
  const row = (u.byCapability as Loose[]).find((r) => r.capability === "agent");
  return { tokens: row?.tokens ?? 0, runs: row?.runs ?? 0, answers: u.me.answers };
}

const programOf = (lines: string[]) => viewOfProgram(lines.join("\n"));
const nodesOf = (n: Loose | null): Loose[] => (n ? [n, ...n.children.flatMap(nodesOf)] : []);

describe("the stream contract", () => {
  it("answers 200 text/event-stream, no-store, in the documented order", async () => {
    const t = await turn("head_bid", { text: "Show me where Bid & Pre-sales stands this month" });
    expect(t.status).toBe(200);
    expect(t.contentType).toContain("text/event-stream");
    expect(t.cacheControl).toBe("no-store");
    const names = t.events.map((e) => e.event);
    expect(names[0]).toBe("meta");
    expect(names.at(-1)).toBe("done");
    expect(names.at(-2)).toBe("usage");
    expect(names.slice(1, -2).every((n) => n === "line" || n === "dropped")).toBe(true);
    expect(t.meta.turnId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.meta).toMatchObject({ mode: "deterministic", reason: "ai_disabled" });
    expect(t.done).toEqual({ turnId: t.meta.turnId, lines: t.lines.length });
    expect(t.usage).toEqual({ inputTokens: 0, outputTokens: 0, model: null });
    expect(t.dropped).toBe(0);
  });

  it("acceptance: a Bid & Pre-sales question streams a funnel, a beeswarm and a top-pages list", async () => {
    const t = await turn("head_bid", { text: "Show me where Bid & Pre-sales stands this month" });
    const v = programOf(t.lines);
    expect(v.dropped).toBe(0);
    expect(v.rejected).toBe(0);
    expect(v.complete).toBe(true);
    const types = nodesOf(v.root as Loose).map((n) => n.type);
    for (const need of ["Funnel", "Beeswarm", "PageList"]) expect(types).toContain(need);
    for (const n of nodesOf(v.root as Loose))
      if (n.props.brain) expect(n.props.brain).toBe("c_bid");
  });

  it("acceptance: a click on Acme comes back as an action and renders the Acme focus panel", async () => {
    const t = await turn("ceo", { action: { action: "focus", values: { brain: "a_acme" } } });
    expect(t.status).toBe(200);
    const nodes = nodesOf(programOf(t.lines).root as Loose);
    expect(nodes.some((n) => n.type === "FitBars" && n.props.brain === "a_acme")).toBe(true);
    expect(nodes.some((n) => n.type === "ActivityGrid" && n.props.brain === "a_acme")).toBe(true);
  });

  it("an ask action answers like the same text, and compare puts two brains side by side", async () => {
    const t = await turn("ceo", {
      action: { action: "compare", values: { a: "c_bid", b: "c_delivery" } },
    });
    const brains = nodesOf(programOf(t.lines).root as Loose).flatMap((n) => n.props.brain ?? []);
    expect(brains).toContain("c_bid");
    expect(brains).toContain("c_delivery");
    const a = await turn("ceo", { action: { action: "ask", values: { text: "Sales" } } });
    expect(a.lines.length).toBeGreaterThan(0);
  });

  it("every streamed line is a finished statement of a registered component", async () => {
    const t = await turn("ceo", { text: "how are my brains doing" });
    expect(t.lines.length).toBeGreaterThan(0);
    for (const l of t.lines)
      expect(l).toMatch(/^(root|[a-z][A-Za-z0-9_]*) = [A-Z][A-Za-z]+\(.*\)$/);
    expect(programOf(t.lines).dropped).toBe(0);
  });

  it("a refinement `previous` is accepted and the deterministic planner ignores it", async () => {
    const first = await turn("head_bid", { text: "Bid & Pre-sales" });
    const again = await turn("head_bid", {
      text: "Bid & Pre-sales",
      previous: first.lines.join("\n"),
    });
    expect(again.lines).toEqual(first.lines);
  });

  it("French labels with lang fr", async () => {
    const t = await turn("head_bid", { text: "Bid & Pre-sales", lang: "fr" });
    expect(t.lines.join("\n")).toContain("Flux de connaissances");
  });
});

describe("scoping: the plan only names brains the caller can open", () => {
  it("a consultant asking for Bid & Pre-sales never sees the brain's id or name", async () => {
    const t = await turn("consultant", { text: "Show me where Bid & Pre-sales stands" });
    expect(t.status).toBe(200);
    expect(t.raw).not.toContain("c_bid");
    expect(t.raw).not.toContain("Bid & Pre-sales");
    expect(t.lines.length).toBeGreaterThan(0);
  });

  it("an action naming a brain the caller cannot open is answered like an unknown one", async () => {
    const named = await turn("consultant", {
      action: { action: "focus", values: { brain: "c_bid" } },
    });
    const missing = await turn("consultant", {
      action: { action: "focus", values: { brain: "no_such_brain" } },
    });
    expect(named.raw).not.toContain("c_bid");
    expect(named.lines).toEqual(missing.lines);
  });
});

describe("the AI gate refuses without a call", () => {
  const model = (calls: { n: number }) =>
    streamModel(() => {
      calls.n++;
      return textRound('root = Stack([k])\nk = KpiTile("P", "c_delivery", "pages")');
    });

  it.each([
    ["no key", { AI_ENABLED: "true", AI_PROCESSOR_CONTRACT: "approved" }, "ai_not_configured"],
    ["not enabled", { ...KEY, AI_ENABLED: "false" }, "ai_disabled"],
    ["no processor contract", { ...KEY, AI_PROCESSOR_CONTRACT: "pending" }, "ai_not_configured"],
  ])("%s: deterministic with reason %s", async (_n, env, reason) => {
    const calls = { n: 0 };
    const m = model(calls);
    const t = await turn("ceo", { text: "Sales" }, { env, fetch: m.fetch });
    expect(t.meta).toMatchObject({ mode: "deterministic", reason });
    expect(t.lines.length).toBeGreaterThan(0);
    expect(calls.n).toBe(0);
  });

  it("budget spent: deterministic with ai_budget_exhausted, no call", async () => {
    const calls = { n: 0 };
    const m = model(calls);
    const t = await turn(
      "ceo",
      { text: "Sales" },
      { env: { ...KEY, AI_DAILY_TOKEN_BUDGET: "100" }, fetch: m.fetch },
    );
    expect(t.meta).toMatchObject({ mode: "deterministic", reason: "ai_budget_exhausted" });
    expect(t.lines.length).toBeGreaterThan(0);
    expect(calls.n).toBe(0);
  });

  it("the tenant kill switch beats a configured key", async () => {
    const calls = { n: 0 };
    const m = model(calls);
    const sw = (enabled: boolean) =>
      as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled } });
    expect((await sw(false)).status).toBe(200);
    try {
      const t = await turn("ceo", { text: "Sales" }, { env: KEY, fetch: m.fetch });
      expect(t.meta).toMatchObject({ mode: "deterministic", reason: "ai_disabled" });
      expect(calls.n).toBe(0);
    } finally {
      await sw(true);
    }
  });

  it.each([
    ["a_lumen", "not allowed"],
    ["a_ember", "unknown"],
  ])("an account (%s, contract %s) named in the question never goes to the model", async (id) => {
    const calls = { n: 0 };
    const m = model(calls);
    const byName = await turn(
      "ceo",
      { text: `show the ${id} account` },
      { env: KEY, fetch: m.fetch },
    );
    expect(byName.meta).toMatchObject({ mode: "deterministic", reason: "ai_constraint" });
    const byAction = await turn(
      "ceo",
      { action: { action: "focus", values: { brain: id } } },
      { env: KEY, fetch: m.fetch },
    );
    expect(byAction.meta).toMatchObject({ mode: "deterministic", reason: "ai_constraint" });
    expect(calls.n).toBe(0);
  });
});

describe("validation", () => {
  const bad = async (body: unknown) => {
    const r = await aiCall("ceo", "/v1/agent/turn", { body });
    expect(r.status, JSON.stringify(body)).toBe(400);
    expect(await json(r)).toEqual({ error: "invalid_body" });
  };

  it("one of text or action is required", async () => {
    await bad({});
    await bad({ lang: "en" });
    await bad({ text: "   " });
  });

  it("unknown keys are refused", async () => {
    await bad({ text: "hello", extra: 1 });
    await bad({ text: "hello", action: { action: "ask", values: { text: "x" }, more: 1 } });
  });

  it("invalid action values are refused", async () => {
    await bad({ action: { action: "delete", values: {} } });
    await bad({ action: { action: "focus", values: {} } });
    await bad({ action: { action: "focus", values: { brain: "Not A Brain!" } } });
    await bad({ action: { action: "compare", values: { a: "c_bid" } } });
    await bad({ action: { action: "ask", values: { text: "x", extra: "y" } } });
    // a link is not a turn
    await bad({ action: { action: "open_brain", values: { brain: "c_bid" } } });
    await bad({ action: { action: "open_page", values: { brain: "c_bid", page: "p" } } });
  });

  it("limits on text, previous, lang and density", async () => {
    await bad({ text: "x".repeat(501) });
    await bad({ text: "hi", previous: "x".repeat(8_193) });
    await bad({ text: "hi", lang: "de" });
    await bad({ text: "hi", density: "tiny" });
    await bad({ text: 5 });
  });

  it("a body that is not JSON is refused", async () => {
    const r = await raw("ceo", "/v1/agent/turn", { body: "{not json" });
    expect(r.status).toBe(400);
  });

  it("no body larger than the limit, and JSON only", async () => {
    const big = await raw("ceo", "/v1/agent/turn", {
      body: JSON.stringify({ text: "hi", previous: "x".repeat(40_000) }),
    });
    expect(big.status).toBe(413);
    const form = await raw("ceo", "/v1/agent/turn", {
      body: "text=hi",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(415);
  });

  it("needs a signed-in caller, and only POST", async () => {
    expect((await call("/v1/agent/turn", { body: { text: "hi" } })).status).toBe(401);
    expect((await as("ceo", "/v1/agent/turn")).status).toBeGreaterThanOrEqual(400);
  });
});

describe("usage and receipts", () => {
  it("a deterministic turn counts a run and an answer with 0 tokens, in GET /v1/usage", async () => {
    const before = await agentUsage("auditor");
    const t = await turn("auditor", { text: "how are my brains" });
    expect(t.status).toBe(200);
    const after = await agentUsage("auditor");
    expect(after.runs - before.runs).toBe(1);
    expect(after.answers - before.answers).toBe(1);
    expect(after.tokens - before.tokens).toBe(0);
  });

  it("one receipt per turn, ids only: never the question, a title or page text", async () => {
    const QUESTION = "Zebra quartz question about Bid & Pre-sales pricing";
    const t = await turn("head_bid", { text: QUESTION });
    const all = await receiptsOf("u_head_bid");
    const mine = all.filter((r) => r.action === "agent.turn" && r.nodeId === t.meta.turnId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ decision: "allow", scopeId: null });
    expect(mine[0].reason).toMatch(/^mode=deterministic lines=\d+ dropped=0 reason=ai_disabled$/);
    const text = JSON.stringify(all);
    expect(text).not.toContain("Zebra");
    expect(text).not.toContain("quartz");
    expect(text).not.toContain("Bid & Pre-sales");
  });

  it("the ledger and the receipt are written even when the client goes away mid-stream", async () => {
    const before = await agentUsage("reviewer");
    const res = await aiCall("reviewer", "/v1/agent/turn", { body: { text: "how are my brains" } });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    let after = before;
    for (let i = 0; i < 40 && after.runs === before.runs; i++) {
      await new Promise((r) => setTimeout(r, 50));
      after = await agentUsage("reviewer");
    }
    expect(after.runs - before.runs).toBe(1);
    const mine = (await receiptsOf("u_reviewer")).filter((r) => r.action === "agent.turn");
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the pilot flag and the rate limit (last: they change what follows)", () => {
  it("is limited per person a minute: 429 with Retry-After", async () => {
    let status = 0;
    let retryAfter: string | null = null;
    let body = "";
    // 45 tries: more than two windows' worth of the 20 a minute, so a minute boundary cannot hide the 429.
    for (let i = 0; i < 45 && status !== 429; i++) {
      const r = await aiCall("consultant", "/v1/agent/turn", { body: { text: "hi there" } });
      status = r.status;
      retryAfter = r.headers.get("retry-after");
      body = await r.text();
    }
    expect(status).toBe(429);
    expect(JSON.parse(body)).toEqual({ error: "rate_limited" });
    expect(retryAfter).toBeTruthy();
    // somebody else still has their own budget
    expect((await turn("auditor", { text: "hi there" })).status).toBe(200);
  });

  it("follows the brains_v3 flag like /v1/brains: 403 not_in_pilot outside the cohort", async () => {
    const made = await as("platform_admin", "/v1/admin/pilot", {
      email: "agentpilot.admin@example.invalid",
      body: {
        name: "Agent pilot",
        members: ["agentpilot.in@example.invalid"],
        flags: { brains_v3: true },
      },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const out = await as("ceo", "/v1/agent/turn", {
      email: "agentpilot.out@example.invalid",
      body: { text: "hi" },
    });
    expect(out.status).toBe(403);
    expect(await json(out)).toEqual({ error: "not_in_pilot", flag: "brains_v3" });
    const views = await as("ceo", "/v1/views", { email: "agentpilot.out@example.invalid" });
    expect(views.status).toBe(403);
    const inside = await as("ceo", "/v1/agent/turn", {
      email: "agentpilot.in@example.invalid",
      body: { text: "hi" },
    });
    expect(inside.status).toBe(200);
    await inside.text();
  });
});
