// The line-language parser inside workerd (the real Worker runtime, nodejs_compat on): it loads,
// compiles the prompt, parses a streamed answer and refuses hostile programs, with no network call.
import { describe, expect, it, vi } from "vitest";
import {
  agentSystemPrompt,
  newViewStream,
  viewOfProgram,
} from "../../../packages/contracts/src/agent-ui/index.ts";

const PROGRAM = [
  "root = Stack([c1, nav])",
  'c1 = InsightCard("Flow", [f1])',
  'f1 = Funnel("c_bid", "30d")',
  "nav = Buttons([b1])",
  'b1 = Button("Acme", "focus", {brain: "a_acme"})',
].join("\n");

describe("OpenUI Lang parser in the Worker runtime", () => {
  it("compiles the prompt and parses a streamed program", () => {
    expect(agentSystemPrompt()).toContain("Funnel(");
    const s = newViewStream();
    const lines = PROGRAM.split("\n");
    let last = s.set("");
    for (let n = 1; n <= lines.length; n++)
      last = s.set(lines.slice(0, n).join("\n"), n === lines.length);
    expect(last.root?.children.length).toBe(2);
    expect(last.dropped).toBe(0);
  });

  it("executes nothing and sends nothing", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const hostile of [
      'root = Stack([q])\nq = Query("wipe", {})',
      'root = Stack([k])\nk = KpiTile(@Count(x), "c_bid", "pages")',
      'root = Stack([b])\nb = Button("Delete", "delete_page", {})',
    ]) {
      const v = viewOfProgram(hostile);
      expect(JSON.stringify(v.root)).not.toMatch(/wipe|delete/i);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
