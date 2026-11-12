// Per-tenant token budget per UTC day. The counter lives in a Workspace Durable Object under a scope
// that no admitted view can reach (`ai:usage`), as one row per day. Updates use the row revision as a
// compare-and-set, so concurrent requests cannot both spend the last tokens.

import { commitBudgetCas, type BudgetCasEvent, type BudgetCasState } from "../../../../src/state/budget-cas.ts";
import { logIfRefundFailed, openHold } from "../../../../src/state/budget-hold.ts";
import { decodeUsageBody } from "../../../../src/state/usage-body.ts";
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
      let state: BudgetCasState = { tag: "trying", attempt: 0 };
      while (state.tag === "trying") {
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
          if (!row) {
            const missed = commitBudgetCas(state, { type: "retry" });
            if (!missed.ok || missed.state.tag !== "trying") return null;
            state = missed.state;
            continue;
          }
        }
        const read = decodeUsageBody(row.body, id);
        let event: BudgetCasEvent;
        if (!read.ok) {
          // Key only. The cell text is not a counter and is not logged.
          console.warn(JSON.stringify({ at: read.at, key: read.key }));
          event = { type: "over_cap" };
        } else if (tokens > 0 && read.used + tokens > cap) event = { type: "over_cap" };
        else {
          const next = Math.max(0, read.used + tokens);
          const wrote = await ws.edit(id, row.revision, { body: String(next) }, now, "system");
          // A conflict means another request wrote first: read again and retry.
          event = "ok" in wrote && wrote.ok ? { type: "wrote", total: next } : { type: "retry" };
        }
        const step = commitBudgetCas(state, event);
        if (!step.ok || step.state.tag === "refused") return null;
        if (step.state.tag === "committed") return step.state.total;
        state = step.state;
      }
      return null;
    },
  };
}

/**
 * The tenant's budget with a per-person cap on top (M-06). A spend counts against both; when either
 * is full nothing is taken. Settling (the cap is MAX_SAFE_INTEGER) never refuses.
 */
export function withUserCap(tenant: BudgetStore, user: BudgetStore, userCap: number): BudgetStore {
  return {
    async add(tokens, cap) {
      const u = await user.add(tokens, cap === Number.MAX_SAFE_INTEGER ? cap : userCap);
      if (u === null) return null;
      const t = await tenant.add(tokens, cap);
      if (t === null) logIfRefundFailed(await user.add(-tokens, Number.MAX_SAFE_INTEGER));
      return t;
    },
  };
}

/** Reserve up front, settle after the call. Returns null when the day's budget is spent. */
export async function reserve(
  store: BudgetStore,
  estimate: number,
  cap: number,
): Promise<{ settle: (actual: number) => Promise<void> } | null> {
  return openHold(store, estimate, cap);
}
