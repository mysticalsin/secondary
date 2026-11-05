// Evidence retrieval for a brief. Only nodes in the caller's admitted view at content level can be
// evidence. Candidates are ranked (search, then meeting, stars, open items, freshness), capped to
// the excerpt limit, read from the workspace that stores them, and filtered for personal segments
// (R-110) before anything reaches a prompt. Evidence ids (E1, E2, ...) are opaque to the model.

import type { AdmittedView, ViewNode } from "@secondary/policy";
import { isPersonalKind } from "@secondary/policy";
import { scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import { estimateTokens, LIMITS } from "./config.ts";
import { type ExcludedSegment, excludePersonalSegments } from "./segments.ts";

export type Evidence = {
  /** Opaque id the model cites. */
  id: string;
  nodeId: string;
  title: string;
  plane: string;
  /** Text that goes into the prompt, already filtered. */
  text: string;
};

export type EvidenceSet = {
  items: Evidence[];
  excluded: (ExcludedSegment & { evidenceId: string })[];
};

const MAX_EXCERPT_CHARS = 3_000;

/**
 * The customer contract of the account that owns a node must say "allowed" (M-05). A region or country
 * target walks into every account below it, so the check is per node, not per target. Nodes that
 * belong to no account (global, department, circle) are not covered by a customer contract.
 */
export function ownerAllowsAi(view: AdmittedView, n: ViewNode): boolean {
  const owner = n.kind === "account" ? n.id : n.account;
  if (!owner) return true;
  return view.nodes.get(owner)?.facts["AI use with client"] === "allowed";
}

/** Content-level leaves only. Unreleased drafts and candidates are not evidence unless the caller named them. */
const usable = (view: AdmittedView, n: ViewNode, named?: string): boolean =>
  n.level === "content" &&
  n.leaf !== null &&
  !n.contacts &&
  !isPersonalKind(n.kind) &&
  ownerAllowsAi(view, n) &&
  (n.id === named || (n.leaf.status !== "draft" && n.leaf.status !== "candidate"));

/** Content leaves below `rootId` (or `rootId` itself) in the admitted view. */
export function candidatesUnder(view: AdmittedView, rootId: string, named?: string): ViewNode[] {
  const out: ViewNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = view.nodes.get(id);
    if (!n || isPersonalKind(n.kind)) return;
    if (usable(view, n, named)) out.push(n);
    for (const k of n.childIds) walk(k);
  };
  walk(rootId);
  return out;
}

const rankKey = (n: ViewNode, first: string | undefined): number[] => [
  n.id === first ? 0 : 1,
  n.leaf?.star ? 0 : 1,
  n.leaf?.open ? 0 : 1,
  n.leaf?.days ?? 9_999,
];

function byRank(a: ViewNode, b: ViewNode, first: string | undefined): number {
  const ka = rankKey(a, first);
  const kb = rankKey(b, first);
  for (let i = 0; i < ka.length; i++) {
    const d = (ka[i] as number) - (kb[i] as number);
    if (d) return d;
  }
  return a.id.localeCompare(b.id);
}

/** Search tokens in the same shape as GET /v1/search. */
export function matchOf(question: string): string | null {
  const q = question.normalize("NFKC").toLowerCase();
  const tokens = (q.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length <= 40).slice(0, 8);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(" ") : null;
}

export async function gatherEvidence(
  env: Env,
  tenantId: string,
  view: AdmittedView,
  o: { rootId: string; firstId?: string; question?: string },
): Promise<EvidenceSet> {
  const pool = candidatesUnder(view, o.rootId, o.firstId);
  const rootScope = (() => {
    const r = view.nodes.get(o.rootId);
    return r ? scopeOfNode(r) : null;
  })();
  // Search only the root's own workspace, and only count hits that are in the candidate pool.
  const hitRank = new Map<string, number>();
  const match = o.question ? matchOf(o.question) : null;
  if (match && rootScope) {
    const hits = await workspaceStub(env, tenantId, rootScope).search(match, 50);
    for (const [i, h] of hits.entries()) hitRank.set(h.id, i);
  }
  const ordered = [...pool].sort((a, b) => {
    const ha = hitRank.get(a.id);
    const hb = hitRank.get(b.id);
    if (ha !== undefined || hb !== undefined) {
      if (ha === undefined) return 1;
      if (hb === undefined) return -1;
      return ha - hb;
    }
    return byRank(a, b, o.firstId);
  });
  // The named meeting always leads when the caller can see it.
  const lead = o.firstId ? ordered.findIndex((n) => n.id === o.firstId) : -1;
  if (lead > 0) ordered.unshift(...ordered.splice(lead, 1));

  const items: Evidence[] = [];
  const excluded: EvidenceSet["excluded"] = [];
  let tokens = 0;
  for (const n of ordered) {
    if (items.length >= LIMITS.maxExcerpts) break;
    const id = `E${items.length + 1}`;
    const raw = await excerptOf(env, tenantId, n);
    const filtered = excludePersonalSegments(raw);
    const text = filtered.kept.slice(0, MAX_EXCERPT_CHARS);
    const cost = estimateTokens(text);
    if (!text || tokens + cost > LIMITS.maxEvidenceTokens) continue;
    tokens += cost;
    items.push({ id, nodeId: n.id, title: n.label, plane: n.plane, text });
    for (const e of filtered.excluded) excluded.push({ ...e, evidenceId: id });
  }
  return { items, excluded };
}

/** What a node says: its own admitted fields, plus the body when the workspace holds one. */
async function excerptOf(env: Env, tenantId: string, n: ViewNode): Promise<string> {
  const l = n.leaf;
  const lines = [`Title: ${n.label}`];
  if (l) {
    lines.push(`Type: ${l.type}`, `Status: ${l.status}`, `Evidence level: ${l.evidence}`);
    if (l.note) lines.push(`Note: ${l.note}`);
    for (const row of l.itemList ?? []) lines.push(`Item: ${row.title}`);
  }
  const scope = scopeOfNode(n);
  if (scope) {
    const row = await workspaceStub(env, tenantId, scope).get(n.id);
    if (row?.body) lines.push(row.body);
  }
  return lines.join("\n");
}
