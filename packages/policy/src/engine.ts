// The single decision point. admittedView is the only function that reads raw org data;
// everything else (canDo, map.ts) works from the admitted view.
// Fail closed: unknown tenant, role, node, account or scope means deny.

import { decidePersonal, isPersonalKind } from "./personal.ts";
import { ACTION_LABEL } from "./roles.ts";
import { fnv } from "./seed.ts";
import type {
  Access,
  Action,
  AdmittedView,
  Ctx,
  Decision,
  Description,
  Grant,
  LeafData,
  Level,
  NodeKind,
  Org,
  OrgNode,
  Principal,
  Role,
  ScopeRef,
  ViewLink,
  ViewNode,
} from "./types.ts";

const RANK: Record<Level, number> = { structure: 1, metadata: 2, content: 3 };
const LEVEL_OF_RANK: Level[] = ["structure", "structure", "metadata", "content"];

const GLOBAL_KINDS = new Set<NodeKind>([
  "core",
  "coretopic",
  "theme",
  "themedept",
  "themeitem",
  "governance",
  "cluster",
  "usecase",
]);
const DEPT_KINDS = new Set<NodeKind>(["department", "circle", "topic"]);
/** Containers stay visible when only a descendant is admitted (partial) or by name (locked). */
const CONTAINER_KINDS = new Set<NodeKind>(["department", "region", "country"]);
/** At structure level these show their own name but none of their children. */
const HIDES_CHILDREN_AT_STRUCTURE = new Set<NodeKind>([
  "core",
  "circle",
  "account",
  "theme",
  "governance",
]);

const HOUR_MS = 3_600_000;
const NOT_IN_VIEW = "Not in your view";
const allow = (reason = "Granted"): Decision => ({ allowed: true, reason });
const deny = (reason: string): Decision => ({ allowed: false, reason });

type Matchable = ScopeRef & { kind: NodeKind };

function scopeMatch(g: Grant, n: Matchable): boolean {
  const any = g.scope_id === "*";
  switch (g.scope_type) {
    case "global":
      return GLOBAL_KINDS.has(n.kind);
    case "department":
      return DEPT_KINDS.has(n.kind) && (any || n.dept === g.scope_id);
    case "circle":
      return (n.kind === "circle" || n.kind === "topic") && (any || n.circle === g.scope_id);
    case "account":
      return !!n.account && (any || n.account === g.scope_id);
    case "region":
      return (n.kind === "region" || n.kind === "country") && (any || n.region === g.scope_id);
    default:
      // 'personal' never matches: no grant can admit a Personal Brain.
      return false;
  }
}

function condOK(g: Grant, n: Matchable, p: Principal, nda: ReadonlySet<string>): boolean {
  const c = g.conditions;
  // NDA accounts need a named grant for that account, and a grant that accepts it.
  if (n.nda && !(n.account && nda.has(n.account) && c.nda === "named_grant")) return false;
  if (c.linked_to_bid && !n.bid) return false;
  // Contacts subspace: members of that account only.
  if (n.contacts) {
    const member = p.memberships.some(
      (m) => m.scope_type === "account" && m.scope_id === n.account,
    );
    if (!(c.member && g.scope_id === n.account && member)) return false;
  }
  return true;
}

function levelFromGrants(
  grants: readonly Grant[],
  n: Matchable,
  p: Principal,
  nda: ReadonlySet<string>,
): Level | null {
  let best = 0;
  for (const g of grants) {
    if (g.scope_type === "personal" || !scopeMatch(g, n) || !condOK(g, n, p, nda)) continue;
    const r = g.actions.includes("view_content")
      ? g.conditions.metadata_only
        ? RANK.metadata
        : RANK.content
      : g.actions.includes("view_structure")
        ? RANK.structure
        : 0;
    if (r > best) best = r;
  }
  return best ? (LEVEL_OF_RANK[best] as Level) : null;
}

const rolesOf = (p: Principal, org: Org): Role[] =>
  p.roleIds.flatMap((id) => {
    const r = org.roles.get(id);
    return r ? [r] : [];
  });

function scopeOf(n: OrgNode): ScopeRef {
  const s: ScopeRef = {};
  if (n.dept !== undefined) s.dept = n.dept;
  if (n.circle !== undefined) s.circle = n.circle;
  if (n.region !== undefined) s.region = n.region;
  if (n.account !== undefined) s.account = n.account;
  if (n.restricted) s.restricted = true;
  if (n.nda) s.nda = true;
  if (n.bid) s.bid = true;
  if (n.contacts) s.contacts = true;
  if (n.ownerId !== undefined) s.ownerId = n.ownerId;
  return s;
}

const shapeLeaf = (l: LeafData | null, level: Level): LeafData | null =>
  !l ? null : level === "content" ? l : { ...l, itemList: null, story: null, redacted: true };

type ViewCore = Omit<AdmittedView, "ctx">;
const CACHE = new WeakMap<Org, Map<string, ViewCore>>();
const CACHE_LIMIT = 512;

function buildCore(principal: Principal, org: Org, ndaGrants: readonly string[]): ViewCore {
  const sameTenant = org.tenantId === principal.tenantId;
  const roles = sameTenant ? rolesOf(principal, org) : [];
  const grants = roles.flatMap((r) => r.grants);
  const nda = new Set(ndaGrants);
  /** Any recognised role floors Company Global at structure. No role, no company view. */
  const entitled = roles.length > 0;
  const nodes = new Map<string, ViewNode>();

  const levelOf = (n: OrgNode): Level | null => {
    if (isPersonalKind(n.kind)) return sameTenant && n.ownerId === principal.id ? "content" : null;
    if (!entitled) return null;
    const l = levelFromGrants(grants, n, principal, nda);
    return l ?? (GLOBAL_KINDS.has(n.kind) ? "structure" : null);
  };

  const admit = (n: OrgNode): ViewNode | null => {
    if (!sameTenant) return null;
    const own = levelOf(n);
    const container = CONTAINER_KINDS.has(n.kind);
    if (own === null && !(container && entitled)) return null;

    const kids: ViewNode[] = [];
    if (!(own === "structure" && HIDES_CHILDREN_AT_STRUCTURE.has(n.kind))) {
      for (const cid of n.childIds) {
        const child = org.nodes.get(cid);
        const v = child ? admit(child) : null;
        if (v) kids.push(v);
      }
    }

    let level: Level;
    let access: Access;
    if (own !== null) {
      level = own;
      access = "full";
    } else if (kids.length) {
      level =
        n.kind === "department"
          ? (LEVEL_OF_RANK[Math.max(...kids.map((k) => RANK[k.level]))] as Level)
          : "structure";
      access = "partial";
    } else if (n.kind === "department") {
      level = "structure";
      access = "locked";
    } else {
      return null;
    }

    const v: ViewNode = {
      ...scopeOf(n),
      id: n.id,
      label: n.label,
      kind: n.kind,
      plane: n.plane,
      parentId: n.parentId,
      childIds: kids.map((k) => k.id),
      level,
      access,
      facts: level === "structure" ? {} : n.facts,
      leaf: shapeLeaf(n.leaf, level),
    };
    if (n.group) v.group = n.group;
    nodes.set(v.id, v);
    return v;
  };

  const roots: string[] = [];
  for (const rid of org.roots) {
    const r = org.nodes.get(rid);
    const v = r ? admit(r) : null;
    if (v) roots.push(v.id);
  }

  const links: ViewLink[] = org.links
    .filter((l) => nodes.has(l.from) && nodes.has(l.to) && nodes.has(l.via))
    .map((l) => ({ from: l.from, to: l.to, kind: l.kind, label: l.label }));

  const ids = new Set(nodes.keys());
  const canon = [...ids]
    .sort()
    .map((id) => {
      const v = nodes.get(id) as ViewNode;
      return `${id}|${v.level}|${v.access}`;
    })
    .join("\n");
  const scopeHash =
    fnv(canon).toString(16).padStart(8, "0") + fnv(canon, 0x9747b28c).toString(16).padStart(8, "0");

  return {
    tenantId: principal.tenantId,
    principalId: principal.id,
    scopeHash,
    roles,
    nodes,
    ids,
    roots,
    links,
  };
}

function coreView(principal: Principal, org: Org, ndaGrants: readonly string[]): ViewCore {
  const key = JSON.stringify([
    principal.id,
    principal.tenantId,
    principal.roleIds,
    principal.memberships,
    [...ndaGrants].sort(),
  ]);
  let byKey = CACHE.get(org);
  if (!byKey) {
    byKey = new Map();
    CACHE.set(org, byKey);
  }
  let core = byKey.get(key);
  if (!core) {
    if (byKey.size >= CACHE_LIMIT) byKey.clear();
    core = buildCore(principal, org, ndaGrants);
    byKey.set(key, core);
  }
  return core;
}

/**
 * Everything the principal may see, shaped by level. The returned view is shared between
 * calls with the same principal, roles, memberships and NDA grants: treat it as read-only.
 */
export function admittedView(principal: Principal, org: Org, ctx: Ctx): AdmittedView {
  return { ...coreView(principal, org, ctx.ndaGrants ?? []), ctx };
}

function elevatedFor(roles: readonly Role[], action: Action, node: ViewNode, ctx: Ctx): boolean {
  const until = ctx.elevatedUntil;
  if (until === undefined || !node.dept || node.level !== "content") return false;
  const left = until - ctx.now;
  return roles.some(
    (r) =>
      !!r.elevation &&
      r.elevation.actions.includes(action) &&
      left > 0 &&
      left <= r.elevation.hours * HOUR_MS,
  );
}

/** canDo against an already built view. The view must belong to this principal. */
export function canDoInView(
  view: AdmittedView,
  principal: Principal,
  nodeId: string,
  action: Action,
  ctx: Ctx = view.ctx,
): Decision {
  if (principal.id !== view.principalId || principal.tenantId !== view.tenantId)
    return deny(NOT_IN_VIEW);
  const node = view.nodes.get(nodeId);
  if (!node) return deny(NOT_IN_VIEW);
  if (isPersonalKind(node.kind)) return decidePersonal(principal, node, action);
  if (action === "request_access") {
    return node.access === "locked"
      ? allow("Sends a request to the steward")
      : deny("You already have access");
  }
  if (node.access === "locked") return deny("Locked: name only. Request access first");

  const nda = new Set(ctx.ndaGrants ?? []);
  const gs = view.roles
    .flatMap((r) => r.grants)
    .filter(
      (g) =>
        g.scope_type !== "personal" &&
        scopeMatch(g, node) &&
        condOK(g, node, principal, nda) &&
        g.actions.includes(action),
    );
  const elev = elevatedFor(view.roles, action, node, ctx);
  const who =
    (node.circle ? view.nodes.get(node.circle)?.label : undefined) ??
    (node.account ? view.nodes.get(node.account)?.label : undefined) ??
    (node.kind === "department" || node.kind === "circle" ? node.label : "Company Global");
  const author = node.leaf?.authorId ?? null;

  if (!gs.length && !elev) {
    if (node.level === "structure" && action !== "configure") {
      return deny("Structure only: platform admins configure and do not read content");
    }
    const m: Partial<Record<Action, string>> = {
      edit: `View only: editing needs the steward of ${who}`,
      comment: `Commenting needs a grant on ${who}`,
      contribute: `Contributing needs a grant on ${who}`,
      review: `Review needs a reviewer assigned to ${who}`,
      approve_release: "Release needs a Knowledge reviewer who did not author the item",
      manage_members: `Membership changes need the steward of ${who}`,
      configure: "Configuration needs the Platform admin",
    };
    let r = m[action] ?? "Not granted";
    if (view.roles.some((x) => x.elevation?.actions.includes(action))) {
      r += ", or time-boxed elevation with a stated reason";
    }
    return deny(r);
  }
  if (action === "approve_release" && author === principal.id) {
    return deny("Self-approval blocked: a second reviewer must approve this contribution");
  }
  if (action === "review" && author === principal.id)
    return deny("You cannot review your own contribution");
  if (
    action === "edit" &&
    gs.length &&
    gs.every((g) => g.conditions.own_drafts) &&
    author !== principal.id
  ) {
    // M3: "own" means authored by the caller. A draft status does not make it theirs.
    return deny("Contributors edit their own drafts only");
  }
  return allow(elev && !gs.length ? "Granted by elevation (audited)" : `Granted on ${who}`);
}

export function canDo(
  principal: Principal,
  org: Org,
  nodeId: string,
  action: Action,
  ctx: Ctx,
): Decision {
  return canDoInView(admittedView(principal, org, ctx), principal, nodeId, action, ctx);
}

export function describe(principal: Principal, org: Org): Description {
  const roles = rolesOf(principal, org);
  const see = new Set<string>();
  const dos = new Set<string>();
  const label = (id: string) => org.nodes.get(id)?.label ?? id;
  const name = (g: Grant): string => {
    const id = g.scope_id;
    switch (g.scope_type) {
      case "global":
        return "Company Global";
      case "department":
        return id === "*" ? "all departments" : label(id);
      case "circle":
        return `${label(id)} (circle)`;
      case "region":
        return id === "*" ? "all regions and countries" : label(id);
      case "account":
        return id === "*"
          ? g.conditions.linked_to_bid
            ? "accounts linked to bids"
            : "all accounts, NDA only with a named grant"
          : `Account: ${label(id)}`;
      default:
        return id;
    }
  };
  for (const role of roles) {
    for (const g of role.grants) {
      const lv = g.actions.includes("view_content")
        ? g.conditions.metadata_only
          ? "Metadata only"
          : "Full"
        : "Structure only";
      see.add(`${lv}: ${name(g)}`);
      const acts = g.actions.filter((a) => ACTION_LABEL[a]);
      if (acts.length)
        dos.add(
          `${acts.map((a) => (ACTION_LABEL[a] as string).toLowerCase()).join(", ")} in ${name(g)}`,
        );
      if (g.conditions.member) see.add("Contacts: members only");
    }
    if (role.elevation) {
      dos.add(
        `${role.elevation.actions.join(", ")} in departments, time-boxed to ${role.elevation.hours} hours with a stated reason (audited)`,
      );
    }
  }
  if (org.nodes.get(`pb:${principal.id}`)) see.add("Your own Personal Brain: only you");
  if (!dos.size) dos.add("Nothing");
  const never = new Set<string>(["Other people's Personal Brains"]);
  for (const role of roles) {
    if (role.exclusions.includes("nda_without_grant"))
      never.add("NDA accounts without a named grant");
    for (const n of role.never) never.add(n);
  }
  return { see: [...see], do: [...dos], never: [...never] };
}
