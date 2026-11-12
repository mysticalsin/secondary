type NonEmpty<T> = [T, ...T[]];
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
      props: { nodeId?: string; lens?: ViewLens; metrics?: NonEmpty<KpiMetric> };
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
        filter?: ViewFilter;
        columns?: NonEmpty<TableColumn>;
        sort?: { by: "label" | "items" | "open" | "gaps" | "freshness"; dir?: "asc" | "desc" };
        limit?: number;
      } & ({ nodeId: string; lens?: ViewLens } | { nodeId?: string; lens: ViewLens });
    };

export interface ViewPlan {
  version: 1;
  title: string;
  components: ViewPlanComponent[];
}
