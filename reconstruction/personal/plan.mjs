/**
 * NEW RECONSTRUCTION own-brain view. Not the recovered org planner.
 * The caller does not choose the owner. Text is stored context, not a model prompt.
 */

/**
 * @param {{
 *   principalId: string,
 *   tenantId: string,
 *   items?: { id: string, externalId?: string | null, version?: number | null, text?: string, contentSha256?: string | null }[] | null,
 *   total: number,
 *   complete: boolean
 * }} input
 * @returns {{
 *   planner: "deterministic_no_model",
 *   ai: "disabled",
 *   providerConfigured: false,
 *   write: false,
 *   scope: "secondary.read",
 *   title: string,
 *   principalId: string,
 *   tenantId: string,
 *   nodeId: string,
 *   orgAcl: false,
 *   empty: boolean,
 *   total: number,
 *   shown: number,
 *   complete: boolean,
 *   coverage: "full" | "partial",
 *   context: { id: string, externalId: string | null, version: number | null, text: string, contentSha256: string | null }[]
 * }}
 */
export function personalPlan({ principalId, tenantId, items, total, complete }) {
  const shown = Array.isArray(items) ? items.length : 0;
  const count = Number.isInteger(total) ? total : shown;
  const coverage = count === shown && complete === true ? "full" : "partial";
  return {
    planner: "deterministic_no_model",
    ai: "disabled",
    providerConfigured: false,
    write: false,
    scope: "secondary.read",
    title: "Your personal brain",
    principalId,
    tenantId,
    nodeId: `pb:${principalId}`,
    orgAcl: false,
    empty: count === 0,
    total: count,
    shown,
    complete: coverage === "full",
    coverage,
    context: (items ?? []).map((item) => ({
      id: item.id,
      externalId: item.externalId ?? null,
      version: item.version ?? null,
      text: item.text ?? "",
      contentSha256: item.contentSha256 ?? null,
    })),
  };
}
