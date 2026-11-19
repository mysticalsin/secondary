// How wiki proposals look in the shared review queue (GET /v1/review). They are workspace items of
// kind wiki_ingest, wiki_lint or wiki_dream. The decision is taken in the wiki review (approve, edit
// or reject), which applies the diff, so the queue row only says who may decide.

import {
  type AdmittedView,
  canDoInView,
  type Grant,
  opensBrain,
  type Principal,
  personalRootId,
  ROLES,
  type RoleId,
  type ViewNode,
} from "@secondary/policy";
import { asciiLower } from "../../../../src/state/actor.ts";
import type { ItemRecord } from "../workspace.ts";
import type { Proposal } from "./types.ts";

export type Right = { allowed: boolean; reason: string };

const LEAD_ACTIONS = ["review", "edit", "manage_members"] as const;
const GLOBAL_KINDS = new Set([
  "core",
  "coretopic",
  "theme",
  "themedept",
  "themeitem",
  "governance",
  "cluster",
  "usecase",
]);

const sameId = (a: string, b: string): boolean => asciiLower(a.trim()) === asciiLower(b.trim());

function leadGrantCovers(grant: Grant, node: ViewNode): boolean {
  const any = grant.scope_id === "*";
  switch (grant.scope_type) {
    case "global":
      return GLOBAL_KINDS.has(node.kind);
    case "department":
      return (
        (node.kind === "department" || node.kind === "circle" || node.kind === "topic") &&
        (any || node.dept === grant.scope_id)
      );
    case "circle":
      return (node.kind === "circle" || node.kind === "topic") && (any || node.circle === grant.scope_id);
    case "account":
      return !!node.account && (any || node.account === grant.scope_id);
    case "region":
      return (node.kind === "region" || node.kind === "country") && (any || node.region === grant.scope_id);
    default:
      return false;
  }
}

function leadOf(view: AdmittedView, p: Principal, nodeId: string): Right | null {
  const node = view.nodes.get(nodeId);
  if (!node) return null;
  for (const id of p.roleIds) {
    const role = Object.hasOwn(ROLES, id) ? ROLES[id as RoleId] : undefined;
    if (!role) continue;
    for (const grant of role.grants) {
      if (grant.conditions.lead !== true || !leadGrantCovers(grant, node)) continue;
      for (const action of LEAD_ACTIONS) {
        if (!grant.actions.includes(action)) continue;
        if (canDoInView(view, p, nodeId, action).allowed)
          return { allowed: true, reason: "Lead of this brain" };
      }
    }
  }
  return null;
}

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
  const lead = leadOf(standing, p, nodeId);
  if (lead) return lead;
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
