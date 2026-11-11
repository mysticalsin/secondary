/**
 * Stand-in for `workspaceStub` while a test calls the real `doBudget`.
 * The test installs one workspace before the call. Nothing else is stubbed.
 */

export type BudgetRow = { id: string; body: unknown; revision: number };

export type BudgetWorkspace = {
  get(id: string): Promise<BudgetRow | null>;
  create(item: { id: string; body: string }): Promise<{ ok: true } | { ok: false }>;
  edit(
    id: string,
    revision: number,
    patch: { body: string },
  ): Promise<{ ok: true } | { ok: false }>;
};

const slot = globalThis as { __budgetWorkspace?: BudgetWorkspace };

export function installBudgetWorkspace(ws: BudgetWorkspace): void {
  slot.__budgetWorkspace = ws;
}

export function workspaceStub(): BudgetWorkspace {
  const ws = slot.__budgetWorkspace;
  if (!ws) throw new Error("budget workspace was not installed");
  return ws;
}
