// The token ledger. Every AI path and every capability writes here: the answer stream, routines,
// briefs, the planner and wiki drafting. One row per UTC day and capability, kept twice:
//   - in the person's own workspace (`ul:<day>:<capability>`), which they can read as "me", and
//   - in a hidden tenant scope (`ux2:usage`) that no admitted view reaches, which only admins read.
// A row is a counter, updated with the row revision as a compare-and-set (same as the AI budget).
// Rows hold numbers only, never text, so the ledger carries no content.

import type { BudgetStore } from "../ai/budget.ts";
import { personalScope } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";

export const USAGE_KIND = "u2_usage";
export const TENANT_USAGE_SCOPE = "ux2:usage";
const CAPABILITY = /^[a-z][a-z_]{1,23}$/;

export interface UsageEntry {
  capability: string;
  /** Model tokens spent (input plus output). 0 for a deterministic answer. */
  tokens?: number;
  /** Capability invocations to count (an ask counts as an answer, not a run). */
  runs?: number;
  answers?: number;
  /** Index-first retrieval: tokens actually read, against the estimate of reading everything. */
  indexTokensRead?: number;
  fullContextEstimate?: number;
}

export interface UsageRow {
  tokens: number;
  runs: number;
  answers: number;
  indexTokensRead: number;
  fullContextEstimate: number;
}

const ZERO: UsageRow = {
  tokens: 0,
  runs: 0,
  answers: 0,
  indexTokensRead: 0,
  fullContextEstimate: 0,
};

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

function parseRow(body: string | null): UsageRow {
  try {
    const v = JSON.parse(body ?? "{}") as Record<string, unknown>;
    return {
      tokens: num(v.tokens),
      runs: num(v.runs),
      answers: num(v.answers),
      indexTokensRead: num(v.indexTokensRead),
      fullContextEstimate: num(v.fullContextEstimate),
    };
  } catch {
    return { ...ZERO };
  }
}

async function bump(
  stub: ReturnType<typeof workspaceStub>,
  id: string,
  e: UsageEntry,
  now: number,
  actor: string,
): Promise<void> {
  const add: UsageRow = {
    tokens: num(e.tokens),
    runs: num(e.runs),
    answers: num(e.answers),
    indexTokensRead: num(e.indexTokensRead),
    fullContextEstimate: num(e.fullContextEstimate),
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await stub.get(id);
    if (!row) {
      const made = await stub.create(
        {
          id,
          label: id,
          kind: USAGE_KIND,
          plane: "GLOBAL_NONPERSONAL",
          origin: "personal",
          status: "draft",
          authorId: actor,
          body: JSON.stringify(add),
        },
        now,
      );
      if (!("ok" in made)) return;
      continue;
    }
    const cur = parseRow(row.body);
    const next: UsageRow = {
      tokens: cur.tokens + add.tokens,
      runs: cur.runs + add.runs,
      answers: cur.answers + add.answers,
      indexTokensRead: cur.indexTokensRead + add.indexTokensRead,
      fullContextEstimate: cur.fullContextEstimate + add.fullContextEstimate,
    };
    const r = await stub.edit(id, row.revision, { body: JSON.stringify(next) }, now, actor);
    if ("ok" in r && r.ok) return;
  }
}

/**
 * Records one capability call. `principalId` is null for work no person started (the wiki's own
 * ingest job): it then counts for the tenant only. A ledger failure never fails the work it measures.
 */
export async function recordUsage(
  env: Env,
  tenantId: string,
  principalId: string | null,
  now: number,
  e: UsageEntry,
): Promise<void> {
  if (!CAPABILITY.test(e.capability)) return;
  const id = `ul:${day(now)}:${e.capability}`;
  try {
    const writes = [bump(workspaceStub(env, tenantId, TENANT_USAGE_SCOPE), id, e, now, "system")];
    if (principalId)
      writes.push(
        bump(workspaceStub(env, tenantId, personalScope(principalId)), id, e, now, principalId),
      );
    await Promise.all(writes);
  } catch (err) {
    console.warn(JSON.stringify({ at: "ux2_ledger", error: String(err).slice(0, 160) }));
  }
}

/**
 * Wraps a budget so the net tokens spent can be read after a call (reserve, then settle to the real
 * figure). This is how paths that do not report usage themselves (the planner) reach the ledger.
 */
export function metered(inner: BudgetStore): { store: BudgetStore; spent: () => number } {
  let total = 0;
  return {
    store: {
      async add(tokens, cap) {
        const r = await inner.add(tokens, cap);
        if (r !== null) total += tokens;
        return r;
      },
    },
    spent: () => Math.max(0, total),
  };
}

export interface UsageSummary {
  tokens: number;
  runs: number;
  answers: number;
  savedPct: number;
  byCapability: { capability: string; tokens: number; runs: number }[];
}

/** savedPct = 1 - indexTokensRead / fullContextEstimate, as a fraction between 0 and 1. */
export const savedFraction = (index: number, full: number): number =>
  full > 0 ? Math.min(1, Math.max(0, Math.round((1 - index / full) * 1000) / 1000)) : 0;

/** The rows of the last `days` UTC days (today included) of one ledger scope, summed. */
export async function readUsage(
  env: Env,
  tenantId: string,
  scope: string,
  now: number,
  days: number,
): Promise<UsageSummary> {
  const rows = await workspaceStub(env, tenantId, scope).listByKind(USAGE_KIND, 1_000);
  const first = day(now - (days - 1) * 86_400_000);
  const by = new Map<string, { tokens: number; runs: number }>();
  const total = { ...ZERO };
  for (const r of rows) {
    const m = /^ul:(\d{4}-\d{2}-\d{2}):([a-z_]+)$/.exec(r.id);
    if (!m || (m[1] as string) < first) continue;
    const row = parseRow(r.body);
    total.tokens += row.tokens;
    total.runs += row.runs;
    total.answers += row.answers;
    total.indexTokensRead += row.indexTokensRead;
    total.fullContextEstimate += row.fullContextEstimate;
    const cap = by.get(m[2] as string) ?? { tokens: 0, runs: 0 };
    cap.tokens += row.tokens;
    cap.runs += row.runs;
    by.set(m[2] as string, cap);
  }
  return {
    tokens: total.tokens,
    runs: total.runs,
    answers: total.answers,
    savedPct: savedFraction(total.indexTokensRead, total.fullContextEstimate),
    byCapability: [...by.entries()]
      .map(([capability, v]) => ({ capability, ...v }))
      .sort((a, b) => b.tokens - a.tokens || a.capability.localeCompare(b.capability)),
  };
}
