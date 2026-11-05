// Per-tenant token budget per UTC day. The counter lives in a Workspace Durable Object under a scope
// that no admitted view can reach (`ai:usage`), as one row per day. Updates use the row revision as a
// compare-and-set, so concurrent requests cannot both spend the last tokens.

import { workspaceStub } from "../stubs.ts";

export interface BudgetStore {
  /** Atomically adds `tokens` (may be negative to give back) and returns the day total, or null when
   * `cap` would be exceeded by a positive add. */
  add(tokens: number, cap: number): Promise<number | null>;
}

const SCOPE = "ai:usage";
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** `bucket` names a separate counter (the wiki has its own slice of the day's budget). */
export function doBudget(env: Env, tenantId: string, now: number, bucket = "usage"): BudgetStore {
  const id = `${bucket}:${day(now)}`;
  const ws = workspaceStub(env, tenantId, SCOPE);
  return {
    async add(tokens, cap) {
      for (let attempt = 0; attempt < 6; attempt++) {
        let row = await ws.get(id);
        if (!row) {
          const made = await ws.create(
            {
              id,
              label: id,
              kind: "aiusage",
              plane: "GLOBAL_NONPERSONAL",
              origin: "personal",
              status: "draft",
              authorId: "system",
              body: "0",
            },
            now,
          );
          row = "ok" in made ? await ws.get(id) : made;
          if (!row) continue;
        }
        const used = Number(row.body ?? "0") || 0;
        if (tokens > 0 && used + tokens > cap) return null;
        const next = Math.max(0, used + tokens);
        const r = await ws.edit(id, row.revision, { body: String(next) }, now, "system");
        if ("ok" in r && r.ok) return next;
        // A conflict means another request wrote first: read again and retry.
      }
      return null;
    },
  };
}

/** Reserve up front, settle after the call. Returns null when the day's budget is spent. */
export async function reserve(
  store: BudgetStore,
  estimate: number,
  cap: number,
): Promise<{ settle: (actual: number) => Promise<void> } | null> {
  const total = await store.add(estimate, cap);
  if (total === null) return null;
  return {
    settle: async (actual) => {
      const diff = Math.round(actual) - estimate;
      if (diff !== 0) await store.add(diff, Number.MAX_SAFE_INTEGER);
    },
  };
}
