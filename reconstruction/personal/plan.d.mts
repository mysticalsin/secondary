export function personalPlan(input: {
  principalId: string;
  tenantId: string;
  items: { id: string; externalId?: string | null; version?: number | null; text?: string; contentSha256?: string | null }[];
  total: number;
  complete: boolean;
}): {
  planner: "deterministic_no_model";
  ai: "disabled";
  providerConfigured: false;
  write: false;
  scope: "secondary.read";
  title: string;
  principalId: string;
  tenantId: string;
  nodeId: string;
  orgAcl: false;
  empty: boolean;
  total: number;
  shown: number;
  complete: boolean;
  coverage: "full" | "partial";
  context: { id: string; externalId: string | null; version: number | null; text: string; contentSha256: string | null }[];
};
