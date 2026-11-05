// Pure rules for the governance console: role and grant validation, which edits are sensitive,
// and who may manage a scope. No I/O. Everything here fails closed.

import {
  ACTIONS,
  type Action,
  type Grant,
  type Org,
  type Role,
  type ScopeType,
} from "@secondary/policy";

export type Bad = { ok: false; code: string; message: string };
export type Good<T> = { ok: true; value: T };
export const bad = (code: string, message: string): Bad => ({ ok: false, code, message });

// ---- scopes ----

/** What a membership or NDA change targets. `restricted` scopes always need a second person. */
export interface ScopeDesc {
  type: "circle" | "department" | "account";
  id: string;
  /** Department of a circle, so department stewards cover their circles. */
  dept: string | null;
  label: string;
  restricted: boolean;
  nda: boolean;
  /** Set when the target is a subspace (Contacts). Membership is held on the account itself. */
  subspace: string | null;
}

export const scopeKey = (s: Pick<ScopeDesc, "type" | "id" | "subspace">): string =>
  s.subspace ? `${s.type}:${s.id}:${s.subspace}` : `${s.type}:${s.id}`;

/** The only subspace today. It is a node `<account>:con` and a member of the account sees it. */
const SUBSPACES: Record<string, string> = { contacts: "con" };

export function scopeDescOf(
  org: Org,
  type: string,
  id: string,
  subspace: string | null = null,
): ScopeDesc | Bad {
  if (type !== "circle" && type !== "department" && type !== "account")
    return bad("invalid_scope", "Memberships exist on circles, departments and accounts");
  const node = org.nodes.get(id);
  if (!node || node.kind !== type) return bad("unknown_scope", "That scope does not exist");
  if (subspace !== null) {
    const code = SUBSPACES[subspace];
    if (type !== "account" || !code || !org.nodes.get(`${id}:${code}`))
      return bad("unknown_scope", "That subspace does not exist");
  }
  return {
    type,
    id,
    dept: type === "circle" ? (node.dept ?? null) : type === "department" ? id : null,
    label: node.label,
    // Every account workspace is ACCOUNT_RESTRICTED, and so is any flagged circle or subspace.
    restricted: type === "account" || !!node.restricted || subspace !== null,
    nda: !!node.nda,
    subspace,
  };
}

export const isConfigure = (roles: readonly Role[]): boolean =>
  roles.some((r) => r.grants.some((g) => g.actions.includes("configure")));

const grantCovers = (g: Grant, s: ScopeDesc): boolean => {
  if (g.scope_type === s.type) return g.scope_id === "*" || g.scope_id === s.id;
  return g.scope_type === "department" && s.type === "circle" && s.dept !== null
    ? g.scope_id === "*" || g.scope_id === s.dept
    : false;
};

/**
 * Who may manage a scope: a configure holder (admin) anywhere, or a steward whose own role holds
 * `manage_members` on that scope. A Head of Bid steward has it on the Bid circle only.
 */
export function manageAuthority(roles: readonly Role[], s: ScopeDesc): "admin" | "steward" | null {
  if (isConfigure(roles)) return "admin";
  const steward = roles.some((r) =>
    r.grants.some((g) => g.actions.includes("manage_members") && grantCovers(g, s)),
  );
  return steward ? "steward" : null;
}

export const isSteward = (roles: readonly Role[]): boolean =>
  roles.some((r) => r.grants.some((g) => g.actions.includes("manage_members")));

// ---- roles ----

const GRANT_SCOPES: readonly ScopeType[] = ["global", "department", "circle", "account", "region"];
const SCOPE_KIND: Record<string, string> = {
  department: "department",
  circle: "circle",
  account: "account",
  region: "region",
};
const BOOL_CONDITIONS = [
  "linked_to_bid",
  "member",
  "metadata_only",
  "own_drafts",
  "self_approval",
  "assigned_queue",
  "not_contributor",
] as const;
const ELEVATION_ACTIONS: readonly Action[] = ["comment", "contribute", "edit", "review"];
const TOKEN = /^[a-z][a-z0-9_]{0,39}$/;
export const ROLE_ID = /^[a-z][a-z0-9_]{2,31}$/;
const MAX_GRANTS = 40;

function checkGrant(g: unknown, org: Org, i: number): Good<Grant> | Bad {
  const at = `grants[${i}]`;
  if (!g || typeof g !== "object" || Array.isArray(g))
    return bad("invalid_grant", `${at} is not an object`);
  const o = g as Record<string, unknown>;
  const type = o.scope_type;
  if (type === "personal")
    return bad("personal_scope", "No role may hold a grant on a Personal Brain");
  if (typeof type !== "string" || !(GRANT_SCOPES as readonly string[]).includes(type))
    return bad("invalid_grant", `${at}: unknown scope type`);
  const id = o.scope_id;
  if (typeof id !== "string" || !id) return bad("invalid_grant", `${at}: scope id is required`);
  if (type === "global") {
    if (id !== "core") return bad("invalid_grant", `${at}: the global scope id is "core"`);
  } else if (id !== "*" && org.nodes.get(id)?.kind !== SCOPE_KIND[type]) {
    return bad("unknown_scope", `${at}: ${id} is not a ${type} in this organisation`);
  }
  const actions = o.actions;
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > ACTIONS.length)
    return bad("invalid_grant", `${at}: actions must be a non-empty list`);
  for (const a of actions)
    if (typeof a !== "string" || !(ACTIONS as readonly string[]).includes(a))
      return bad("invalid_grant", `${at}: unknown action`);
  if (new Set(actions).size !== actions.length)
    return bad("invalid_grant", `${at}: duplicate action`);
  const c = o.conditions ?? {};
  if (!c || typeof c !== "object" || Array.isArray(c))
    return bad("invalid_grant", `${at}: conditions must be an object`);
  const conditions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (k === "nda") {
      if (v !== "named_grant") return bad("invalid_condition", `${at}: nda must be "named_grant"`);
    } else if ((BOOL_CONDITIONS as readonly string[]).includes(k)) {
      if (typeof v !== "boolean")
        return bad("invalid_condition", `${at}: ${k} must be true or false`);
    } else {
      return bad("invalid_condition", `${at}: unknown condition ${k.slice(0, 40)}`);
    }
    conditions[k] = v;
  }
  return {
    ok: true,
    value: {
      scope_type: type as ScopeType,
      scope_id: id,
      actions: actions as Action[],
      conditions,
    },
  };
}

const strList = (v: unknown, max: number, len: number, re?: RegExp): string[] | null => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  return v.every((x) => typeof x === "string" && x.trim() && x.length <= len && (!re || re.test(x)))
    ? (v as string[]).map((x) => x.trim())
    : null;
};

export interface RoleInput {
  id?: unknown;
  label?: unknown;
  summary?: unknown;
  grants?: unknown;
  exclusions?: unknown;
  never?: unknown;
  elevation?: unknown;
}

/** Builds the next version of a role from an edit (merged onto `base`) or a new role (no `base`). */
export function buildRole(input: RoleInput, org: Org, base: Role | null): Good<Role> | Bad {
  const id = base ? base.id : input.id;
  if (typeof id !== "string" || !ROLE_ID.test(id))
    return bad("invalid_role", "Role ids are 3 to 32 lowercase letters, digits or underscores");
  const label = input.label === undefined ? base?.label : input.label;
  if (typeof label !== "string" || !label.trim() || label.length > 60)
    return bad("invalid_role", "A role needs a label of up to 60 characters");
  const summary = input.summary === undefined ? (base?.summary ?? "") : input.summary;
  if (typeof summary !== "string" || summary.length > 300)
    return bad("invalid_role", "The summary is limited to 300 characters");

  const rawGrants = input.grants === undefined ? base?.grants : input.grants;
  if (!Array.isArray(rawGrants) || rawGrants.length > MAX_GRANTS)
    return bad("invalid_grant", `A role holds up to ${MAX_GRANTS} grants`);
  const grants: Grant[] = [];
  for (const [i, g] of rawGrants.entries()) {
    const r = checkGrant(g, org, i);
    if (!r.ok) return r;
    grants.push(r.value);
  }
  const seen = new Set<string>();
  for (const g of grants) {
    const k = `${g.scope_type}:${g.scope_id}:${JSON.stringify(g.conditions)}`;
    if (seen.has(k)) return bad("invalid_grant", "Two grants repeat the same scope and conditions");
    seen.add(k);
  }

  const exclusions = strList(input.exclusions ?? base?.exclusions, 10, 40, TOKEN);
  const never = strList(input.never ?? base?.never, 10, 160);
  if (!exclusions || !never) return bad("invalid_role", "Exclusions or never-lines are malformed");

  let elevation: Role["elevation"];
  const rawEl = input.elevation === undefined ? base?.elevation : input.elevation;
  if (rawEl !== undefined && rawEl !== null) {
    const e = rawEl as { actions?: unknown; hours?: unknown; approval?: unknown };
    if (
      !Array.isArray(e.actions) ||
      e.actions.length === 0 ||
      !e.actions.every((a) => (ELEVATION_ACTIONS as readonly unknown[]).includes(a))
    )
      return bad(
        "invalid_elevation",
        `Elevation may only unlock: ${ELEVATION_ACTIONS.join(", ")}. Configure, member management and release are never elevated`,
      );
    if (typeof e.hours !== "number" || !Number.isInteger(e.hours) || e.hours < 1 || e.hours > 24)
      return bad("invalid_elevation", "Elevation lasts 1 to 24 whole hours");
    if (e.approval !== undefined && typeof e.approval !== "boolean")
      return bad("invalid_elevation", "approval must be true or false");
    elevation = {
      actions: [...new Set(e.actions as Action[])],
      hours: e.hours,
      ...(e.approval ? { approval: true } : {}),
    };
  }

  const role: Role = {
    id,
    label: label.trim(),
    summary: summary.trim(),
    grants,
    exclusions,
    never,
    ...(elevation ? { elevation } : {}),
    ...(base?.breakGlass ? { breakGlass: true } : {}),
  };
  return { ok: true, value: role };
}

/** A grant that reaches restricted or account scopes, or administers the tenant. */
export function isSensitiveGrant(g: Grant, org: Org): boolean {
  if (g.scope_type === "account" || g.actions.includes("configure")) return true;
  if (g.scope_type === "circle" || g.scope_type === "department") {
    if (g.scope_id === "*") return g.actions.includes("view_content");
    const n = org.nodes.get(g.scope_id);
    if (n?.restricted) return true;
    if (g.scope_type === "department")
      return n !== undefined && n.childIds.some((c) => org.nodes.get(c)?.restricted);
  }
  return false;
}

/** An edit is sensitive when the role grants restricted or account scopes before or after it. */
export const isSensitiveEdit = (before: Role | null, after: Role, org: Org): boolean =>
  [before, after].some((r) => r?.grants.some((g) => isSensitiveGrant(g, org)));

export const rolesWithConfigure = (roles: readonly Role[]): string[] =>
  roles.filter((r) => r.grants.some((g) => g.actions.includes("configure"))).map((r) => r.id);
