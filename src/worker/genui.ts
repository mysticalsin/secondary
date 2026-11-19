// GenUI planner (B1): deterministic and rule-based. It returns a ViewPlan made of catalog
// components whose props are queries only. It reads the caller's admitted view to choose
// components for a node it can see, and never copies content into the plan. The plan title is
// fixed text, so a prompt cannot inject anything into it. An LLM planner can replace this later
// behind the same schema.

import type { AdmittedView } from "@secondary/policy";
// Type-only deep import: the package root pulls in the ajv runtime compiler, which workerd forbids.
import type { ViewPlan, ViewPlanComponent } from "../../packages/contracts/src/view-plan.ts";
import validatePlan from "./generated/view-plan.validator.js";

export const MAX_PROMPT = 500;

export function validateViewPlan(plan: unknown): boolean {
  return (validatePlan as (d: unknown) => boolean)(plan) === true;
}

const has = (p: string, re: RegExp) => re.test(p.toLowerCase());

function forNode(view: AdmittedView, nodeId: string): ViewPlan | null {
  const n = view.nodes.get(nodeId);
  if (!n) return null;
  const card: ViewPlanComponent = { type: "NodeCard", props: { nodeId } };
  if (n.kind === "personal" || n.kind === "personalitem")
    return {
      version: 1,
      title: "My Secondary",
      components: [
        card,
        { type: "Callout", props: { template: "personal_private", tone: "info", nodeId } },
      ],
    };
  if (n.access === "locked")
    return {
      version: 1,
      title: "Access needed",
      components: [
        card,
        { type: "Callout", props: { template: "no_access", tone: "warning", nodeId } },
      ],
    };
  if (n.kind === "account")
    return {
      version: 1,
      title: "Account overview",
      components: [
        { type: "AccountSummary", props: { accountId: nodeId } },
        { type: "KpiRow", props: { nodeId, metrics: ["items", "topics", "open", "gaps"] } },
        { type: "ItemList", props: { nodeId, limit: 10 } },
      ],
    };
  if (n.kind === "governance")
    return {
      version: 1,
      title: "Governance maturity",
      components: [
        { type: "StageBoard", props: { governanceId: nodeId } },
        { type: "KpiRow", props: { nodeId, metrics: ["items", "topics"] } },
      ],
    };
  const components: ViewPlanComponent[] = [card, { type: "KpiRow", props: { nodeId } }];
  if (n.level === "content") components.push({ type: "ItemList", props: { nodeId, limit: 10 } });
  return { version: 1, title: "Node overview", components };
}

function forPrompt(prompt: string): ViewPlan {
  if (has(prompt, /\b(accounts?|customers?|clients?|sectors?)\b/))
    return {
      version: 1,
      title: "Accounts",
      components: [
        { type: "MapMini", props: { lens: "accounts" } },
        {
          type: "Table",
          props: {
            lens: "accounts",
            columns: ["label", "kind", "items", "open", "freshness"],
            sort: { by: "items", dir: "desc" },
            limit: 25,
          },
        },
      ],
    };
  if (has(prompt, /\b(governances?|use cases?|maturity|stages?|pilots?)\b/))
    return {
      version: 1,
      title: "Governance maturity",
      components: [
        { type: "StageBoard", props: {} },
        { type: "MapMini", props: { lens: "governances" } },
      ],
    };
  if (has(prompt, /\b(gaps?|stale|outdated|fresh\w*)\b/))
    return {
      version: 1,
      title: "Knowledge gaps",
      components: [
        { type: "KpiRow", props: { lens: "departments", metrics: ["gaps", "open", "items"] } },
        {
          type: "Table",
          props: {
            lens: "departments",
            columns: ["label", "gaps", "freshness"],
            sort: { by: "gaps", dir: "desc" },
            limit: 20,
          },
        },
      ],
    };
  if (has(prompt, /\b(review|candidates?|pending|approv\w*|release)\b/))
    return {
      version: 1,
      title: "Waiting for review",
      components: [
        { type: "Callout", props: { template: "candidate_pending", tone: "info" } },
        {
          type: "Table",
          props: {
            lens: "topics",
            filter: { status: "candidate" },
            columns: ["label", "kind", "items"],
            limit: 25,
          },
        },
      ],
    };
  return {
    version: 1,
    title: "Company overview",
    components: [
      { type: "KpiRow", props: { lens: "departments" } },
      { type: "MapMini", props: { lens: "departments" } },
    ],
  };
}

/** null when `nodeId` is not in the caller's view (the route answers 404, same as a missing node). */
export function planView(
  view: AdmittedView,
  input: { prompt?: string; nodeId?: string },
): ViewPlan | null {
  const plan = input.nodeId ? forNode(view, input.nodeId) : forPrompt(input.prompt ?? "");
  if (plan && !validateViewPlan(plan)) throw new Error("planner produced an invalid ViewPlan");
  return plan;
}
