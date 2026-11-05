// The one call other modules make when a source is created or changed. Best effort: a wiki problem
// never fails the write that triggered it, and the job only reads this workspace.

import { workspaceStub } from "../stubs.ts";

export async function wikiNotify(
  env: Env,
  tenantId: string,
  scopeId: string,
  sourceIds: string[],
  now: number,
): Promise<void> {
  if (!sourceIds.length) return;
  try {
    await workspaceStub(env, tenantId, scopeId).wikiNotify(tenantId, scopeId, sourceIds, now);
  } catch (e) {
    console.warn(JSON.stringify({ at: "wiki_notify", error: String(e).slice(0, 160) }));
  }
}
