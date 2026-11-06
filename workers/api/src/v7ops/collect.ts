// Gathers the operational records for a set of brains the caller may see: audit receipts, the wiki log of
// each brain and, when a source feeds a brain, its connector sync attempts. Only what the caller's rights
// allow is asked for, so a brain outside the set contributes nothing.

import { retryPlan } from "../../../../packages/contracts/src/ops-v7.ts";
import { fetchReceiptsSince } from "../audit.ts";
import { HOSTS } from "../brains/model.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import { type C, sess } from "../ux/util.ts";
import type { SourcesBackend } from "./model.ts";
import { connectorRecs, logRec, type Rec, receiptRec } from "./records.ts";

export type BrainRef = { param: string; scope: string; nodeId: string; label: string };

const DAY = 86_400_000;
const LOG_LIMIT = 300;

export async function collect(
  c: C,
  o: {
    brains: BrainRef[];
    sinceMs: number;
    /** Receipts of one person (their own agent calls) or the whole tenant (null). */
    principalId: string | null;
    /** Keep only receipts that came through an MCP client. */
    agentsOnly?: boolean;
    /** Keep receipts that belong to none of `brains` (the person's own agent view). */
    keepUnmapped?: boolean;
    backend: SourcesBackend | null;
    /** Skip the per-brain logs and connector sources (the person's own agent view). */
    receiptsOnly?: boolean;
  },
): Promise<{ records: Rec[]; partial: boolean }> {
  const s = sess(c);
  const now = s.ctx.now;
  const byScope = new Map(o.brains.map((b) => [b.scope, b]));
  const byNode = new Map(o.brains.map((b) => [b.nodeId, b]));
  const out: Rec[] = [];
  let partial = false;

  // Receipts, paged back through the audit worker to the start of the window (capped: `partial` then).
  const days = Math.max(1, Math.ceil((now - o.sinceMs) / DAY));
  const got = await fetchReceiptsSince(c.env, s.tenantId, o.principalId, days, o.sinceMs);
  if (!got || got.truncated) partial = true;
  const receipts = got?.receipts ?? null;
  const hosts = new Map<string, string>();
  if (o.principalId !== null) {
    for (const g of await tenantStub(c.env, s.tenantId).agentList(o.principalId))
      hosts.set(g.clientId, HOSTS.find((h) => h[0] === g.host)?.[1] ?? "Agent");
  }
  const hostLabel = (clientId: string | null): string =>
    (clientId !== null ? hosts.get(clientId) : undefined) ?? "Agent";
  for (const r of receipts ?? []) {
    const at = Date.parse(r.at);
    if (at < o.sinceMs || at > now) continue;
    if (o.agentsOnly && r.source !== "mcp" && r.clientId === null) continue;
    const brain =
      (r.scopeId !== null ? byScope.get(r.scopeId) : undefined) ??
      (r.nodeId !== null ? byNode.get(r.nodeId) : undefined) ??
      r.scopeIds.map((id) => byNode.get(id)).find((b) => b !== undefined);
    if (!brain && !o.keepUnmapped) continue;
    out.push(await receiptRec(r, brain?.param ?? null, hostLabel));
  }
  if (o.receiptsOnly) return { records: sort(out), partial };

  // The wiki log of each brain: ingest runs, classifier verdicts, failed jobs.
  await Promise.all(
    o.brains.map(async (b) => {
      const rows = await workspaceStub(c.env, s.tenantId, b.scope).opsLog(o.sinceMs, LOG_LIMIT);
      for (const row of rows) {
        const rec = await logRec(row, b.param);
        if (rec) out.push(rec);
      }
    }),
  );

  // Connector sync attempts of the sources that feed one of these brains.
  if (o.backend) {
    const sources = (await o.backend.list()) ?? [];
    const tries = new Map(sources.map((x) => [x.id, retryPlan(x.settings.retry).length + 1]));
    for (const src of await o.backend.attempts(o.sinceMs)) {
      const brain = byScope.get(src.scopeId);
      if (!brain) continue;
      out.push(
        ...(await connectorRecs(src, src.attempts, brain.param, tries.get(src.id) ?? 1)).filter(
          (r) => r.at >= o.sinceMs,
        ),
      );
    }
  }
  return { records: sort(out), partial };
}

const sort = (r: Rec[]): Rec[] => r.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
