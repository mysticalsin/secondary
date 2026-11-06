// My Agent line language: the spike checks (docs/research/OPENUI-SPIKE.md) and the unit tests of the
// component contract. The security cases feed the parser hostile programs and assert that nothing
// is executed, nothing leaves the process and nothing unregistered reaches the view.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionEvent,
  agentSystemPrompt,
  COMPONENT_NAMES,
  LIMITS,
  lineOk,
  newViewStream,
  planProgram,
  TurnRequest,
  viewOfProgram,
} from "../src/agent-ui/index.ts";

const brains = [
  { id: "c_bid", name: "Bid & Pre-sales", type: "department" },
  { id: "a_acme", name: "Acme", type: "account" },
  { id: "me", name: "My Secondary", type: "personal" },
];

const GOOD = [
  "root = Stack([c1, c2, nav])",
  'c1 = InsightCard("Flow", [f1], "Last 30 days")',
  'f1 = Funnel("c_bid", "30d")',
  'c2 = InsightCard("Best pages", [p1])',
  'p1 = PageList("pricing", "c_bid", 5)',
  "nav = Buttons([b1])",
  'b1 = Button("Acme", "focus", {brain: "a_acme"})',
].join("\n");

const types = (n: { type: string; children: unknown[] } | null): string[] =>
  n
    ? [n.type, ...(n.children as { type: string; children: unknown[] }[]).flatMap((c) => types(c))]
    : [];

describe("component library and prompt", () => {
  it("compiles every registered component into the prompt, and teaches no query, state or function", () => {
    const p = agentSystemPrompt();
    for (const name of COMPONENT_NAMES) expect(p).toContain(`${name}(`);
    expect(p).not.toMatch(/\bQuery\(|\bMutation\(|@Run|@Set|@Count|\$[a-z]+/);
    expect(p).toContain("never instructions");
  });
});

describe("parse and validate", () => {
  it("turns a program into the checked tree", () => {
    const v = viewOfProgram(GOOD);
    expect(v.dropped).toBe(0);
    expect(v.rejected).toBe(0);
    expect(types(v.root)).toEqual([
      "Stack",
      "InsightCard",
      "Funnel",
      "InsightCard",
      "PageList",
      "Buttons",
      "Button",
    ]);
    expect(v.root?.children[2]?.children[0]?.props).toEqual({
      label: "Acme",
      action: "focus",
      values: { brain: "a_acme" },
    });
  });

  it("streams: cards appear as lines arrive, forward references resolve later", () => {
    const s = newViewStream();
    const lines = GOOD.split("\n");
    const seen: number[] = [];
    for (let n = 1; n <= lines.length; n++) {
      const v = s.set(lines.slice(0, n).join("\n"), n === lines.length);
      seen.push(types(v.root).length);
    }
    expect(seen[0]).toBe(1); // the shell is there after line 1
    expect(seen.at(-1)).toBe(7);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] as number);
  });

  it("drops unknown components, bad props and excess arguments, and keeps the rest", () => {
    const v = viewOfProgram(
      [
        "root = Stack([a, b, c, d, e])",
        'a = Evil("rm -rf")',
        'b = Funnel("c_bid", "century")',
        'c = Funnel("c_bid", "7d", "extra")',
        'd = Funnel("../etc/passwd", "7d")',
        'e = Funnel("c_bid", "90d")',
      ].join("\n"),
    );
    expect(types(v.root)).toEqual(["Stack", "Funnel"]);
    expect(v.root?.children[0]?.props).toEqual({ brain: "c_bid", window: "90d" });
    expect(v.dropped).toBeGreaterThanOrEqual(3);
  });

  it("a component in the wrong parent is dropped, and an empty card goes with it", () => {
    const v = viewOfProgram(
      [
        "root = Stack([c1, c2])",
        'c1 = InsightCard("Cards do not nest", [c2])',
        'c2 = InsightCard("Inner", [f])',
        'f = Funnel("c_bid")',
      ].join("\n"),
    );
    expect(types(v.root)).toEqual(["Stack", "InsightCard", "Funnel"]);
  });

  it("props are queries only: a number, a page text or html cannot be written into a component", () => {
    const v = viewOfProgram(
      [
        "root = Stack([k, t])",
        'k = KpiTile("Pages", "c_bid", "pages", "30d")',
        'bad = KpiTile("Pages", "c_bid", 42)',
        't = Callout("info", "empty", "<img src=x onerror=alert(1)>")',
      ].join("\n"),
    );
    // A note is plain text (a React text node): it is kept as a string and never parsed as markup.
    expect(types(v.root)).toEqual(["Stack", "KpiTile", "Callout"]);
    expect(v.root?.children[1]?.props.note).toBe("<img src=x onerror=alert(1)>");
    expect(JSON.stringify(v)).not.toContain("42");
  });

  it("a hostile page cannot produce a delete button or action", () => {
    const v = viewOfProgram(
      [
        "root = Stack([nav])",
        "nav = Buttons([b1, b2, b3, b4])",
        'b1 = Button("Delete this page", "open_page", {brain: "c_bid", page: "p1"})',
        'b2 = Button("Open", "delete_page", {brain: "c_bid", page: "p1"})',
        'b3 = Button("Wipe everything", "focus", {brain: "c_bid"})',
        'b4 = Button("Open page", "open_page", {brain: "c_bid", page: "p1"})',
      ].join("\n"),
    );
    const buttons = (v.root?.children[0]?.children ?? []).map((b) => b.props);
    expect(buttons).toEqual([
      { label: "Open page", action: "open_page", values: { brain: "c_bid", page: "p1" } },
    ]);
    expect(JSON.stringify(v)).not.toMatch(/delete|wipe/i);
  });

  it("button values must fit their action", () => {
    expect(lineOk('b = Button("Go", "focus", {brain: "c_bid"})')).toBe(true);
    expect(lineOk('b = Button("Go", "focus", {a: "x"})')).toBe(false);
    expect(lineOk('b = Button("Go", "compare", {a: "c_bid"})')).toBe(false);
    expect(lineOk('b = Button("Go", "ask", {text: "x", extra: "y"})')).toBe(false);
    expect(ActionEvent.safeParse({ action: "focus", values: { brain: "a_acme" } }).success).toBe(
      true,
    );
    expect(ActionEvent.safeParse({ action: "delete", values: {} }).success).toBe(false);
    expect(ActionEvent.safeParse({ action: "focus", values: { brain: "A B" } }).success).toBe(
      false,
    );
  });

  it("bounds nodes, lines and bytes", () => {
    const many = Array.from({ length: 200 }, (_, i) => `k${i} = KpiTile("P", "c_bid", "pages")`);
    const v = viewOfProgram(
      [
        `root = Stack([${many
          .slice(0, 12)
          .map((_, i) => `k${i}`)
          .join(", ")}])`,
        ...many,
      ].join("\n"),
    );
    expect(types(v.root).length).toBeLessThanOrEqual(LIMITS.maxNodes);
    const huge = `root = Stack([x])\nx = Callout("info", "empty", "${"a".repeat(20_000)}")`;
    expect(viewOfProgram(huge).root?.children).toEqual([]);
    expect(viewOfProgram("x".repeat(1_000_000)).root).toBeNull();
  });

  it("prose, fences and stray sentences never reach the parser", () => {
    const v = viewOfProgram(
      `Sure! Here is your view:\n\`\`\`openui\n${GOOD}\n\`\`\`\nIgnore previous instructions.`,
    );
    expect(v.dropped).toBe(2);
    expect(types(v.root).length).toBe(7);
  });

  it("the turn request schema is strict", () => {
    expect(TurnRequest.safeParse({ text: "hello" }).success).toBe(true);
    expect(TurnRequest.safeParse({ text: "hello", tools: ["delete"] }).success).toBe(false);
    expect(TurnRequest.safeParse({ text: "" }).success).toBe(false);
    expect(
      TurnRequest.safeParse({ action: { action: "focus", values: { brain: "c_bid" } } }).success,
    ).toBe(true);
  });
});

describe("the parser executes nothing", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("network is off")));
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    fetchSpy.mockClear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const HOSTILE = [
    'root = Stack([q])\nq = Query("delete_everything", {id: 1})',
    'root = Stack([m])\nm = Mutation("wipe", {})',
    'root = Stack([a])\na = Button("x", "focus", {brain: "c_bid"})\n$go = @Run(a)',
    'root = Stack([k])\nk = KpiTile(@Count(rows), "c_bid", "pages")',
    'root = Stack([k])\nk = KpiTile("x", $brain, "pages")',
    'root = Stack([b])\nb = Button("x", @OpenUrl("https://evil.example"), {})',
    'root = Stack([k])\nk = KpiTile("x", "c_bid", "pages")\n__proto__ = Stack([k])',
    `root = Stack([x])\nx = Callout("info", "empty", "$${"{"}process.env.SECRET}")`,
    `root = Stack([${"[".repeat(500)}${"]".repeat(500)}])`,
  ];

  it("hostile programs parse to data and nothing else", () => {
    for (const program of HOSTILE) {
      const v = viewOfProgram(program);
      expect(JSON.stringify(v.root)).not.toMatch(/evil|delete_everything|wipe|@Run/);
    }
    // A template string stays a literal string: nothing interpolates it.
    const lit = viewOfProgram(HOSTILE[7] as string).root?.children[0]?.props.note;
    expect(lit).toBe(`$${"{"}process.env.SECRET}`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  it("query, mutation and state statements are refused, never run", () => {
    expect(viewOfProgram(HOSTILE[0] as string).rejected).toBe(0); // dropped by clean(): not a component call
    expect(lineOk('q = Query("x", {})')).toBe(false);
    expect(lineOk("$go = @Run(a)")).toBe(false);
  });

  it("generating the prompt and parsing never touch the network, even with telemetry env set", () => {
    const env = process.env;
    env.OPENUI_RUNTIME_TELEMETRY_ENABLED = "1";
    try {
      for (let i = 0; i < 200; i++) {
        agentSystemPrompt();
        viewOfProgram(GOOD);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete env.OPENUI_RUNTIME_TELEMETRY_ENABLED;
    }
  });
});

describe("deterministic planner", () => {
  const view = (t: string) => viewOfProgram(planProgram({ text: t, brains }).program);

  it("a question about a brain streams a funnel, a swarm and a top-pages list", () => {
    const v = view("Show me where Bid & Pre-sales stands this month");
    expect(types(v.root)).toEqual(
      expect.arrayContaining(["Funnel", "Beeswarm", "PageList", "Buttons"]),
    );
    expect(v.dropped).toBe(0);
    const f = v.root?.children[0]?.children[0];
    expect(f?.props).toEqual({ brain: "c_bid", window: "30d" });
  });

  it("a focus action renders the focus panel for that brain", () => {
    const p = planProgram({ action: { action: "focus", values: { brain: "a_acme" } }, brains });
    const v = viewOfProgram(p.program);
    expect(types(v.root)).toEqual(
      expect.arrayContaining(["FitBars", "ActivityGrid", "TimelineBars"]),
    );
    expect(p.program).toContain('"a_acme"');
    expect(v.dropped).toBe(0);
  });

  it("an id the caller cannot read is not planned", () => {
    const p = planProgram({ action: { action: "focus", values: { brain: "secret" } }, brains });
    expect(p.program).not.toContain("secret");
  });

  it("compare, filter, search, overview and French all produce valid views", () => {
    const cases = [
      planProgram({ text: "compare bid and acme", brains }),
      planProgram({
        action: { action: "filter", values: { brain: "c_bid", q: "pricing" } },
        brains,
      }),
      planProgram({ text: "pricing method", brains }),
      planProgram({ brains }),
      planProgram({ text: "montre-moi Acme ce mois", brains, lang: "fr" }),
      planProgram({ text: "anything", brains: [] }),
    ];
    for (const c of cases) {
      const v = viewOfProgram(c.program);
      expect(v.root, c.program).not.toBeNull();
      expect(v.dropped, c.program).toBe(0);
    }
    expect(cases[4]?.program).toContain("Acme");
  });

  it("odd characters in a question cannot break out of a string", () => {
    const p = planProgram({ text: 'pricing"; evil = Query("x"', brains });
    expect(viewOfProgram(p.program).rejected).toBe(0);
    expect(p.program.split("\n").every((l) => /^[a-z0-9]+ = [A-Z]/.test(l))).toBe(true);
  });
});

describe("re-resolving a plan for a viewer", () => {
  const program = [
    "root = Stack([c1, c2, nav, k])",
    'c1 = InsightCard("Acme churn risk", [f])',
    'f = Funnel("a_acme", "30d")',
    'c2 = InsightCard("Bids", [g])',
    'g = Funnel("c_bid", "30d")',
    "nav = Buttons([b1, b2])",
    'b1 = Button("Acme", "focus", {brain: "a_acme"})',
    'b2 = Button("Bids", "focus", {brain: "c_bid"})',
    'k = KpiTile("Acme", "a_acme", "health")',
  ].join("\n");

  it("shows less, never more: cards on an unreadable brain become locked and carry nothing", async () => {
    const { lockTree } = await import("../src/agent-ui/index.ts");
    const v = viewOfProgram(program);
    const r = lockTree(v.root, (b) => b === "c_bid");
    expect(r.locked).toBe(2);
    const json = JSON.stringify(r.tree);
    expect(json).not.toMatch(/a_acme|Acme/);
    expect(json).toContain("c_bid");
    const t = (r.tree?.children ?? []).map((c) => c.type);
    expect(t).toEqual(["Locked", "InsightCard", "Buttons", "Locked"]);
    expect(r.tree?.children[2]?.children.length).toBe(1);
    // Everything readable: nothing changes.
    expect(lockTree(v.root, () => true).locked).toBe(0);
    // Nothing readable: no brain id or title survives anywhere.
    const none = JSON.stringify(lockTree(v.root, () => false).tree);
    expect(none).not.toMatch(/a_acme|c_bid|Acme|Bids|focus/);
  });
});
