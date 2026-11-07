/**
 * NEW RECONSTRUCTION. Not recovered source and not original history.
 *
 * Both the API and MCP workers import this module as types only. Neither intake
 * contained the file. The component names and props are the API validator schema
 * embedded in recovered `view-plan.validator.js`. The MCP validator names the
 * same eight components and is a different file, not a replacement for this one.
 */
export type ViewLens = "departments" | "accounts" | "topics" | "governances";
export type KpiMetric = "items" | "topics" | "open" | "gaps" | "stars";
export type TableColumn = "label" | "kind" | "items" | "open" | "gaps" | "freshness";
export type CalloutTemplate =
  | "no_access"
  | "empty"
  | "stale"
  | "gap"
  | "nda_locked"
  | "personal_private"
  | "candidate_pending";

export interface ViewFilter {
  status?: "approved" | "candidate" | "draft";
  evidence?: "supported" | "partial" | "unsupported";
  type?: string;
  tag?: string;
}

export type ViewPlanComponent =
  | {
      type: "KpiRow";
      props: { nodeId?: string; lens?: ViewLens; metrics?: KpiMetric[] };
    }
  | { type: "NodeCard"; props: { nodeId: string } }
  | {
      type: "ItemList";
      props: { nodeId: string; filter?: ViewFilter; limit?: number };
    }
  | { type: "AccountSummary"; props: { accountId: string } }
  | { type: "StageBoard"; props: { governanceId?: string } }
  | {
      type: "MapMini";
      props: { lens: ViewLens; focusId?: string; hops?: number };
    }
  | {
      type: "Callout";
      props: { template: CalloutTemplate; tone?: "info" | "warning" | "success"; nodeId?: string };
    }
  | {
      type: "Table";
      props: {
        nodeId?: string;
        lens?: ViewLens;
        filter?: ViewFilter;
        columns?: TableColumn[];
        sort?: { by: "label" | "items" | "open" | "gaps" | "freshness"; dir?: "asc" | "desc" };
        limit?: number;
      };
    };

export interface ViewPlan {
  version: 1;
  title: string;
  components: ViewPlanComponent[];
}
