// How wiki proposals look in the shared review queue (GET /v1/review). They are workspace items of
// kind wiki_ingest, wiki_lint or wiki_dream. The decision is taken in the wiki review (approve, edit
// or reject), which applies the diff, so the queue row only says who may decide.

import { type AdmittedView, canDoInView, type Principal, personalRootId } from "@secondary/policy";
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

export function wikiQueueRow(view: AdmittedView, p: Principal, r: ItemRecord) {
  const node = r.targetNode ?? "";
  const personal = node === personalRootId(p.id);
  const target = view.nodes.get(node);
  if (!personal && target?.level !== "content") return null;
  if (r.authorId === p.id && !personal) return null;
  const right = mayDecide(view, p, node);
  if (!right.allowed) return null;
  let diff: { type: "add"; text: string }[] = [];
  try {
    const prop = JSON.parse(r.body ?? "") as Proposal;
    diff = [
      ...prop.pages.map((d) => `Page: ${d.title}`),
      ...prop.facts.map((f) => `Fact: ${f.subject} / ${f.predicate} = ${f.object}`),
      ...(prop.detail ? [prop.detail] : []),
    ].map((text) => ({ type: "add" as const, text }));
  } catch {
    diff = [];
  }
  return {
    id: r.id,
    nodeId: r.id,
    title: r.label,
    scopeLabel: personal ? "My Secondary" : (target?.label ?? node),
    plane: r.plane,
    author: r.authorId ?? "",
    revision: String(r.revision),
    previousRevision: null,
    submittedAt: new Date(r.createdAt).toISOString(),
    diff,
    flags: [],
    twoPerson: { required: false, approvals: 0, needed: 1 },
    approve: right,
    requestChanges: { allowed: false, reason: "Wiki proposals are approved, edited or rejected" },
    origin: r.origin,
    release: "scope" as const,
    kind: r.kind,
  };
}
