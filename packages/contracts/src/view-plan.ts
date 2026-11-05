// Types for the GenUI ViewPlan (schemas/view-plan.schema.json). Props are queries only.

export type ViewPlanLens = "departments" | "accounts" | "topics" | "governances";

export interface ViewPlanFilter {
  status?: "approved" | "candidate" | "draft";
  evidence?: "supported" | "partial" | "unsupported";
  type?: string;
  tag?: string;
}

export type ViewPlanComponent =
  | {
      type: "KpiRow";
      props: {
        nodeId?: string;
        lens?: ViewPlanLens;
        metrics?: ("items" | "topics" | "open" | "gaps" | "stars")[];
      };
    }
  | { type: "NodeCard"; props: { nodeId: string } }
  | { type: "ItemList"; props: { nodeId: string; filter?: ViewPlanFilter; limit?: number } }
  | { type: "AccountSummary"; props: { accountId: string } }
  | { type: "StageBoard"; props: { governanceId?: string } }
  | { type: "MapMini"; props: { lens: ViewPlanLens; focusId?: string; hops?: number } }
  | {
      type: "Callout";
      props: {
        template:
          | "no_access"
          | "empty"
          | "stale"
          | "gap"
          | "nda_locked"
          | "personal_private"
          | "candidate_pending";
        tone?: "info" | "warning" | "success";
        nodeId?: string;
      };
    }
  | {
      type: "Table";
      props: {
        nodeId?: string;
        lens?: ViewPlanLens;
        filter?: ViewPlanFilter;
        columns?: ("label" | "kind" | "items" | "open" | "gaps" | "freshness")[];
        sort?: { by: "label" | "items" | "open" | "gaps" | "freshness"; dir?: "asc" | "desc" };
        limit?: number;
      };
    };

export interface ViewPlan {
  version: 1;
  title: string;
  components: ViewPlanComponent[];
}

export const COMPONENT_TYPES = [
  "KpiRow",
  "NodeCard",
  "ItemList",
  "AccountSummary",
  "StageBoard",
  "MapMini",
  "Callout",
  "Table",
] as const satisfies readonly ViewPlanComponent["type"][];
