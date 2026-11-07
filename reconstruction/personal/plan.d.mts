export function personalPlan(input: {
  principalId: string;
  tenantId: string;
  items: { id: string; externalId?: string | null; version?: number | null; text?: string; contentSha256?: string | null }[];
  total: number;
  complete: boolean;
}): {
  planner: string;
  ai: string;
  principalId: string;
  tenantId: string;
  empty: boolean;
  total: number;
  shown: number;
  complete: boolean;
  coverage: string;
  context: unknown[];
};
