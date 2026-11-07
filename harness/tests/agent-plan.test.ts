/**
 * Isolated tests of the recovered deterministic agent planner, turn schema, and lock step.
 * Brain lists are literals in this file. Nothing is fetched and no model is called.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { lockTree } from "../../recovered-source/shared/packages/contracts/src/agent-ui/lock.ts";
import { planProgram } from "../../recovered-source/shared/packages/contracts/src/agent-ui/planner.ts";
import { TurnRequest } from "../../recovered-source/shared/packages/contracts/src/agent-ui/schemas.ts";
import type { AgentNode } from "../../recovered-source/shared/packages/contracts/src/agent-ui/view.ts";

const brains = [
  { id: "core", name: "Company Brain", type: "global" },
  { id: "c_bid", name: "Bid and Pre-sales", type: "team" },
] as const;

function node(id: string, type: string, props: Record<string, unknown>, children: AgentNode[] = []): AgentNode {
  return { id, type: type as AgentNode["type"], props, children };
}

test("the planner names only brains the caller passed in", () => {
  const plan = planProgram({ text: "Company Brain freshness", brains: [...brains] });
  assert.match(plan.program, /"core"/);
  assert.equal(plan.program.includes("not_in_list"), false);
  assert.equal(plan.title, "Company Brain");

  const fallback = planProgram({
    brains: [...brains],
    action: { action: "focus", values: { brain: "not_in_list" } },
  });
  assert.equal(fallback.program.includes("not_in_list"), false);
  assert.match(fallback.program, /"core"/);
  assert.match(fallback.program, /"c_bid"/);
});

test("a turn request rejects extra fields and unknown actions", () => {
  assert.equal(TurnRequest.safeParse({ text: "show accounts" }).success, true);
  assert.equal(TurnRequest.safeParse({ text: "show accounts", body: "hidden" }).success, false);
  assert.equal(
    TurnRequest.safeParse({ action: { action: "delete", values: {} } }).success,
    false,
  );
});

test("lockTree replaces an unreadable card and keeps no brain id or title from it", () => {
  const tree = node("root", "Stack", {}, [
    node("open", "InsightCard", { title: "Company Brain", brain: "core" }),
    node("closed", "InsightCard", { title: "Private title", brain: "secret_brain" }, [
      node("child", "PageList", { brain: "secret_brain" }),
    ]),
  ]);
  const result = lockTree(tree, (id) => id === "core");
  assert.equal(result.locked, 1);
  const encoded = JSON.stringify(result.tree);
  assert.equal(encoded.includes("secret_brain"), false);
  assert.equal(encoded.includes("Private title"), false);
  assert.match(encoded, /"core"/);
  const closed = result.tree?.children.find((child) => child.id === "closed");
  assert.equal(closed?.type, "Locked");
  assert.deepEqual(closed?.props, { reason: "no_access" });
  assert.deepEqual(closed?.children, []);
});
