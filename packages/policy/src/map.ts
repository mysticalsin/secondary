// Projections of an admitted view for the API and the web app. Nothing here reads raw org
// data: every id, count and label comes from the AdmittedView, so a node the principal may
// not see can never appear.

import { canDoInView } from "./engine.ts";
import { GROUP_LABEL, STAGES } from "./org.ts";
import { ACTION_LABEL } from "./roles.ts";
import type {
  Action,
  AdmittedView,
  Hub,
  ItemRow,
  Lens,
  MapLink,
  MapNode,
  MapView,
  NodeAction,
  NodeDetail,
  Principal,
  ViewNode,
} from "./types.ts";

interface Agg {
  items: number;
  leaves: number;
  open: number;
  gaps: number;
  stars: number;
  minDays: number | null;
}

const ROOT_KIND: Record<Lens, Hub["kind"]> = {
  departments: "department",
  accounts: "region",
  topics: "theme",
  governances: "governance",
};

function aggregate(view: AdmittedView, id: string, memo: Map<string, Agg>): Agg {
  const hit = memo.get(id);
  if (hit) return hit;
  const vn = view.nodes.get(id) as ViewNode;
  const a: Agg = { items: 0, leaves: 0, open: 0, gaps: 0, stars: 0, minDays: null };
  const l = vn.leaf;
  if (l) {
    a.items = l.items;
    a.leaves = 1;
    a.open = l.open ? 1 : 0;
    a.gaps = l.gap ? 1 : 0;
    a.stars = l.star ? 1 : 0;
    a.minDays = l.days;
  }
  for (const c of vn.childIds) {
    const k = aggregate(view, c, memo);
    a.items += k.items;
    a.leaves += k.leaves;
    a.open += k.open;
    a.gaps += k.gaps;
    a.stars += k.stars;
    if (k.minDays !== null)
      a.minDays = a.minDays === null ? k.minDays : Math.min(a.minDays, k.minDays);
  }
  memo.set(id, a);
  return a;
}

/** On the accounts lens an account shows its engagements; the workspace holds the rest. */
function childIdsFor(
  view: AdmittedView,
  vn: ViewNode,
  engagementsOnly: boolean,
): readonly string[] {
  if (engagementsOnly && vn.kind === "account")
    return view.nodes.get(`${vn.id}:eng`)?.childIds ?? [];
  return vn.childIds;
}

function toNode(
  view: AdmittedView,
  vn: ViewNode,
  memo: Map<string, Agg>,
  depth: number,
  engagementsOnly: boolean,
): MapNode {
  const a = aggregate(view, vn.id, memo);
  // Locked nodes and structure-only views carry no counts at all.
  const hidden = vn.access === "locked" || vn.level === "structure";
  const node: MapNode = {
    id: vn.id,
    label: vn.label,
    kind: vn.kind,
    plane: vn.plane,
    access: vn.access,
    counts: hidden
      ? null
      : { items: a.items, topics: a.leaves, open: a.open, gaps: a.gaps, stars: a.stars },
    freshnessDays: hidden ? null : a.minDays,
    signals: hidden
      ? { open: false, star: false, gap: false }
      : { open: a.open > 0, star: a.stars > 0, gap: a.gaps > 0 },
  };
  if (vn.access !== "locked" && depth > 0) {
    const kids = childIdsFor(view, vn, engagementsOnly).flatMap((id) => {
      const k = view.nodes.get(id);
      return k ? [toNode(view, k, memo, depth - 1, engagementsOnly)] : [];
    });
    if (kids.length) node.children = kids;
  }
  return node;
}

export function toMapView(view: AdmittedView, lens: Lens): MapView {
  const memo = new Map<string, Agg>();
  const core = view.nodes.get("core");
  const hubs: Hub[] = [];
  for (const id of view.roots) {
    const vn = view.nodes.get(id) as ViewNode;
    if (vn.kind !== ROOT_KIND[lens]) continue;
    const n = toNode(view, vn, memo, Number.POSITIVE_INFINITY, true);
    const hub: Hub = {
      id: n.id,
      label: n.label,
      kind: ROOT_KIND[lens],
      access: n.access,
      counts: n.counts,
      children: n.children ?? [],
    };
    if (vn.group) hub.group = GROUP_LABEL[vn.group];
    hubs.push(hub);
  }

  const links: MapLink[] = [];
  if (lens === "accounts") {
    links.push(...view.links);
    const bySector = new Map<string, string[]>();
    for (const vn of view.nodes.values()) {
      const sector = vn.kind === "account" ? vn.facts.Sector : undefined;
      if (sector) bySector.set(sector, [...(bySector.get(sector) ?? []), vn.id]);
    }
    for (const ids of bySector.values()) {
      ids.sort();
      for (let i = 1; i < ids.length; i++) {
        links.push({ from: ids[i - 1] as string, to: ids[i] as string, kind: "in-sector" });
      }
    }
  }

  return {
    lens,
    viewerScopeHash: view.scopeHash,
    core: {
      id: "core",
      label: core?.label ?? "Company Global",
      topicCount: core ? core.childIds.length : 0,
    },
    hubs,
    links,
  };
}

const ACTION_GROUPS: readonly (readonly [NodeAction["group"], readonly Action[]])[] = [
  ["Collaborate", ["comment", "contribute", "edit"]],
  ["Govern", ["review", "approve_release", "manage_members"]],
  ["Admin", ["configure"]],
];

const MAX_ITEM_SOURCES = 6;
const ROWS_PER_SOURCE = 4;

function collectLeaves(view: AdmittedView, id: string, out: ViewNode[]): ViewNode[] {
  const vn = view.nodes.get(id) as ViewNode;
  if (vn.leaf) out.push(vn);
  for (const c of vn.childIds) collectLeaves(view, c, out);
  return out;
}

function badgesOf(vn: ViewNode): string[] {
  const b: string[] = [];
  if (vn.access === "locked") b.push("Locked");
  if (vn.access === "partial") b.push("Partial access");
  if (vn.level === "structure" && vn.access !== "locked") b.push("Structure only");
  if (vn.level === "metadata") b.push("Metadata only");
  if (vn.leaf?.redacted) b.push("Redacted");
  if (vn.nda) b.push("NDA");
  if (vn.kind === "circle" && vn.restricted) b.push("Restricted circle");
  if (vn.contacts) b.push("Contacts: members only");
  if (vn.bid) b.push("Bid-linked");
  if (vn.plane === "PERSONAL_HOSTED") b.push("Only you");
  const l = vn.leaf;
  if (l) {
    if (l.status === "candidate") b.push("Candidate");
    if (l.status === "draft") b.push("Draft");
    if (l.gap) b.push("Gap");
    if (l.star) b.push("Star");
    if (l.open) b.push("Open");
    if (l.reviewedBy2) b.push("Reviewed by two");
  }
  return b;
}

/** Detail for one node, or null when the node is not in the principal's view. */
export function toNodeDetail(
  view: AdmittedView,
  nodeId: string,
  principal: Principal,
): NodeDetail | null {
  if (principal.id !== view.principalId || principal.tenantId !== view.tenantId) return null;
  const vn = view.nodes.get(nodeId);
  if (!vn) return null;
  const memo = new Map<string, Agg>();
  const node = toNode(view, vn, memo, 1, false);

  const items: ItemRow[] = collectLeaves(view, vn.id, [])
    .filter((n) => n.leaf?.itemList)
    .sort((x, y) => (y.leaf?.items ?? 0) - (x.leaf?.items ?? 0) || x.id.localeCompare(y.id))
    .slice(0, MAX_ITEM_SOURCES)
    .flatMap((n) => (n.leaf?.itemList ?? []).slice(0, ROWS_PER_SOURCE));

  const backlinks: NodeDetail["backlinks"] = [];
  const parent = vn.parentId ? view.nodes.get(vn.parentId) : undefined;
  if (parent) backlinks.push({ id: parent.id, label: parent.label, type: "parent" });
  for (const l of view.links) {
    const other = l.from === vn.id ? l.to : l.to === vn.id ? l.from : null;
    const o = other ? view.nodes.get(other) : undefined;
    if (o) backlinks.push({ id: o.id, label: o.label, type: l.kind });
  }

  const actions: NodeAction[] = [];
  if (vn.access === "locked") {
    const d = canDoInView(view, principal, vn.id, "request_access");
    actions.push({ action: "request_access", label: "Request access", group: "Collaborate", ...d });
  }
  for (const [group, list] of ACTION_GROUPS) {
    for (const action of list) {
      const d = canDoInView(view, principal, vn.id, action);
      actions.push({ action, label: ACTION_LABEL[action] as string, group, ...d });
    }
  }

  return {
    node: { ...node, facts: { ...vn.facts }, badges: badgesOf(vn) },
    items,
    backlinks,
    actions,
  };
}

export interface GovernanceStages {
  id: string;
  label: string;
  group: string | null;
  total: number;
  stages: { stage: string; count: number }[];
}

/** The governances in the view with use cases per maturity stage (zero when structure only). */
export function governanceStages(view: AdmittedView): GovernanceStages[] {
  return view.roots.flatMap((id) => {
    const g = view.nodes.get(id) as ViewNode;
    if (g.kind !== "governance") return [];
    const stages = STAGES.map((stage) => ({
      stage,
      count:
        view.nodes.get(`${g.id}:c:${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)?.childIds
          .length ?? 0,
    }));
    return [
      {
        id: g.id,
        label: g.label,
        group: g.group ? GROUP_LABEL[g.group] : null,
        total: stages.reduce((s, x) => s + x.count, 0),
        stages,
      },
    ];
  });
}
