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
import { asciiLower } from "../../../../src/state/actor.ts";
import type { ItemRecord } from "../workspace.ts";
import type { Proposal } from "./types.ts";

export type Right = { allowed: boolean; reason: string };

/** Roles that lead a brain. A standing edit or review grant on any other role is not a decision. */
const LEAD_ROLES = new Set(["acme_lead"]);

const sameId = (a: string, b: string): boolean => asciiLower(a.trim()) === asciiLower(b.trim());

/**
 * A lead may decide inside a brain they lead. Anyone else needs a standing approve_release grant.
 * Elevation does not count. The author, including a different letter case or an alias id, cannot decide.
 */
export function mayDecide(
  view: AdmittedView,
  p: Principal,
  nodeId: string,
  authorId?: string | null,
  aliasIds: readonly string[] = [],
): Right {
  if (nodeId === personalRootId(p.id)) return { allowed: true, reason: "Your Personal Brain" };
  if (
    authorId != null &&
    (sameId(authorId, p.id) || aliasIds.some((id) => sameId(id, p.id)))
  )
    return { allowed: false, reason: "You cannot approve your own proposal" };
  const standing: AdmittedView = { ...view, ctx: { ...view.ctx, elevatedUntil: undefined } };
  const release = canDoInView(standing, p, nodeId, "approve_release");
  if (release.allowed) return release;
  if (p.roleIds.some((id) => LEAD_ROLES.has(id))) {
    for (const action of ["review", "edit", "manage_members"] as const) {
      const decision = canDoInView(standing, p, nodeId, action);
      if (decision.allowed) return { allowed: true, reason: "Lead of this brain" };
    }
  }
  return canDoInView(view, p, nodeId, "approve_release");
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
