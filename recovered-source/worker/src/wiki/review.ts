// How wiki proposals look in the shared review queue (GET /v1/review). They are workspace items of
// kind wiki_ingest, wiki_lint or wiki_dream. The decision is taken in the wiki review (approve, edit
// or reject), which applies the diff, so the queue row only says who may decide.

import {
  type AdmittedView,
  canDoInView,
  opensBrain,
  type Principal,
  personalRootId,
} from "@secondary/policy";
import type { ItemRecord } from "../workspace.ts";
import type { Proposal } from "./types.ts";

export type Right = { allowed: boolean; reason: string };

/** Review, release or edit rights on the workspace node are what let someone decide a wiki proposal. */
export function mayDecide(view: AdmittedView, p: Principal, nodeId: string): Right {
  if (nodeId === personalRootId(p.id)) return { allowed: true, reason: "Your Personal Brain" };
  for (const a of ["review", "approve_release", "edit"] as const) {
    const d = canDoInView(view, p, nodeId, a);
    if (d.allowed) return d;
  }
  return canDoInView(view, p, nodeId, "review");
}

/** The sources a proposal's own text rests on (what the queue row would show). */
export function proposalSources(r: ItemRecord): string[] {
  try {
    const prop = JSON.parse(r.body ?? "") as Proposal;
    return [
      ...new Set([
        ...(prop.titleSources ?? []),
        ...prop.sources.map((x) => x.id),
        ...prop.facts.flatMap((f) => f.sourceIds),
      ]),
    ];
  } catch {
    return [];
  }
}

/**
 * `readable` says whether this viewer may read every source the proposal's text rests on. When not,
 * the row says "restricted source" instead of titles, fact text and details (H-02).
 */
export function wikiQueueRow(view: AdmittedView, p: Principal, r: ItemRecord, readable: boolean) {
  const node = r.targetNode ?? "";
  const personal = node === personalRootId(p.id);
  const target = view.nodes.get(node);
  if (!personal && !(target && opensBrain(target))) return null;
  if (r.authorId === p.id && !personal) return null;
  const right = mayDecide(view, p, node);
  if (!right.allowed) return null;
  let diff: { type: "add"; text: string }[] = [];
  try {
    const prop = JSON.parse(r.body ?? "") as Proposal;
    diff = readable
      ? [
          ...prop.pages.map((d) => `Page: ${d.title}`),
          ...prop.facts.map((f) => `Fact: ${f.subject} / ${f.predicate} = ${f.object}`),
          ...(prop.detail ? [prop.detail] : []),
        ].map((text) => ({ type: "add" as const, text }))
      : [{ type: "add" as const, text: "restricted source" }];
  } catch {
    diff = [];
  }
  return {
    id: r.id,
    nodeId: r.id,
    title: readable ? r.label : "restricted source",
    scopeLabel: personal ? "My Secondary" : (target?.label ?? node),
    plane: r.plane,
    author: r.authorId ?? "",
    revision: String(r.revision),
    previousRevision: null,
    submittedAt: new Date(r.createdAt).toISOString(),
    diff,
    flags: [],
    twoPerson: { required: r.required > 1, approvals: r.approvals, needed: r.required },
    approve: right,
    requestChanges: { allowed: false, reason: "Wiki proposals are approved, edited or rejected" },
    origin: r.origin,
    release: "scope" as const,
    kind: r.kind,
  };
}
