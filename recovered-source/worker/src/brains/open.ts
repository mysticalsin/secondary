// Opening a brain for the caller. Same rule as the wiki API: the brain must be in the caller's
// admitted view at content level, else 404 (absence and denial look the same). The caller's rights
// are the policy's, narrowed by a stored brain role when the person has one.

import {
  type AdmittedView,
  type BrainFacts,
  type BrainRole,
  type BrainType,
  brainTypeOf,
  canDoInView,
  effectivePublication,
  isPersonalKind,
  opensBrain,
  personalRootId,
  roleAllows,
  type ViewNode,
} from "@secondary/policy";
import { govClient } from "../admin/client.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { humanIdsOf } from "../human.ts";
import { personalScope, scopeOfNode } from "../scope.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import { reconcileBrainMember } from "./store.ts";
import type { FlagKey } from "../tenant-policy.ts";
import { type C, NODE_ID, notFound, sess } from "../ux/util.ts";
import { mayDecide } from "../wiki/review.ts";

const WIKI_NODE_KINDS = new Set(["account", "circle", "department", "core"]);

type RoleBrain = Parameters<typeof reconcileBrainMember>[1] & {
  brainRoleOf(ids: string[]): BrainRole | null | Promise<BrainRole | null>;
};

/** Reconcile any open claim, then return the role only an active membership grants. */
export async function storedBrainRole(c: C, stub: RoleBrain, ids: string[]): Promise<BrainRole | null> {
  await reconcileStoredMembers(c, stub, ids);
  return Promise.resolve(stub.brainRoleOf(ids));
}

/** Make each stored claim match its governance row before a membership read. */
export async function reconcileStoredMembers(c: C, stub: RoleBrain, ids: string[]): Promise<void> {
  const s = sess(c);
  const gov = govClient(c.env, s.tenantId);
  for (const id of ids.slice(0, 20)) await reconcileBrainMember(gov, stub, id, s.ctx.now);
}

export type Need = "read" | "contribute" | "edit" | "decide" | "manage";

export interface Brain {
  param: string;
  nodeId: string;
  scope: string;
  label: string;
  plane: string;
  personal: boolean;
  facts: BrainFacts;
  view: AdmittedView;
  vn: ViewNode | null;
  stub: ReturnType<typeof workspaceStub>;
  /** The stored brain role of the caller (null: the policy alone decides). */
  role: BrainRole | null;
  can: { contribute: boolean; edit: boolean; decide: boolean; manage: boolean };
}

/** The brain ids the caller's view reaches at content level (Personal first). */
export function admittedBrainParams(c: C): { param: string; vn: ViewNode | null }[] {
  const s = sess(c);
  const view = viewOf(s);
  const out: { param: string; vn: ViewNode | null }[] = [{ param: "me", vn: null }];
  for (const vn of view.nodes.values()) {
    if (!WIKI_NODE_KINDS.has(vn.kind) || !opensBrain(vn) || isPersonalKind(vn.kind)) continue;
    if (scopeOfNode(vn)) out.push({ param: vn.id, vn });
  }
  return out;
}

/**
 * What bounds a brain: its own flags, a contacts subspace, and any restricted or NDA ancestor (a node
 * under a restricted parent is restricted whatever its own flag says).
 */
function factsOf(type: BrainType, vn: ViewNode, org: ReturnType<typeof requireOrg>): BrainFacts {
  let restricted = !!vn.restricted || !!vn.contacts;
  let nda = !!vn.nda;
  for (
    let p = vn.parentId ? org.nodes.get(vn.parentId) : undefined;
    p;
    p = p.parentId ? org.nodes.get(p.parentId) : undefined
  ) {
    restricted ||= !!p.restricted;
    nda ||= !!p.nda;
  }
  return { type, restricted, nda };
}

export async function brainOf(c: C, param: string, humanIds?: string[]): Promise<Brain | null> {
  const s = sess(c);
  const view = viewOf(s);
  let b: Omit<Brain, "can" | "role">;
  if (param === "me" || param === personalRootId(s.principal.id)) {
    const scope = personalScope(s.principal.id);
    b = {
      param: "me",
      nodeId: personalRootId(s.principal.id),
      scope,
      label: "My Secondary",
      plane: "PERSONAL_HOSTED",
      personal: true,
      facts: { type: "personal" },
      view,
      vn: null,
      stub: workspaceStub(c.env, s.tenantId, scope),
    };
    return { ...b, role: null, can: { contribute: true, edit: true, decide: true, manage: true } };
  }
  if (!NODE_ID.test(param)) return null;
  const vn = view.nodes.get(param);
  if (!vn || !WIKI_NODE_KINDS.has(vn.kind) || !opensBrain(vn)) return null;
  const scope = scopeOfNode(vn);
  const type = brainTypeOf(vn.kind);
  if (!scope || !type) return null;
  b = {
    param,
    nodeId: vn.id,
    scope,
    label: vn.label,
    plane: vn.plane,
    personal: false,
    facts: factsOf(type, vn, requireOrg(s)),
    view,
    vn,
    stub: workspaceStub(c.env, s.tenantId, scope),
  };
  const ids = humanIds ?? (await humanIdsOf(c.env, s));
  const role = await storedBrainRole(c, b.stub, ids);
  const may = (a: "contribute" | "edit" | "manage_members") =>
    canDoInView(view, s.principal, vn.id, a).allowed && roleAllows(role, a);
  return {
    ...b,
    role,
    can: {
      contribute: may("contribute"),
      edit: may("edit"),
      decide: mayDecide(view, s.principal, vn.id).allowed && roleAllows(role, "review"),
      manage: may("manage_members"),
    },
  };
}

/** Open the brain or refuse: 404 when it is not in the view, 403 when the caller lacks the right. */
export async function needBrain(c: C, param: string, need: Need): Promise<Brain | Response> {
  const b = await brainOf(c, param);
  if (!b) throw notFound();
  if (need !== "read" && !b.can[need])
    return c.json(
      {
        error: "forbidden",
        reason: `You cannot ${need === "manage" ? "manage" : need} this brain`,
      },
      403,
    );
  await b.stub.wikiTouch(sess(c).tenantId, b.scope, sess(c).ctx.now);
  return b;
}

/** A pilot flag the API enforces. A key no cohort mentions is on for everyone. */
export async function needFlag(c: C, key: FlagKey): Promise<Response | null> {
  const s = sess(c);
  const flags = await tenantStub(c.env, s.tenantId).flagsFor(s.principal.email);
  return flags[key] ? null : c.json({ error: "not_in_pilot", flag: key }, 403);
}

/**
 * Does a page proposal from this caller publish at once? A shared brain asks `mayDecide` and the
 * stored brain role. The publication mode must be direct, and the policy bounds are checked again
 * here (account, restricted and Global brains force review). The caller must be allowed to edit.
 * In a Personal Brain only an explicit "direct".
 */
export async function directPublish(
  c: C,
  w: {
    personal: boolean;
    nodeId: string;
    view: AdmittedView;
    role: BrainRole | null;
    vn: ViewNode | null;
    stub: ReturnType<typeof workspaceStub>;
    can: { edit: boolean };
  },
): Promise<boolean> {
  if (!w.can.edit) return false;
  if (!w.personal) {
    if (!w.view || !w.nodeId) return false;
    if (!mayDecide(w.view, sess(c).principal, w.nodeId).allowed) return false;
    if (!roleAllows(w.role, "review")) return false;
  }
  // M-5: text written by an agent (an MCP call) always waits for a person, whatever the brain's mode.
  if (sess(c).internal) return false;
  const cfg = await w.stub.brainConfig();
  if (cfg.publication !== "direct") return false;
  const type = w.personal ? "personal" : w.vn ? brainTypeOf(w.vn.kind) : null;
  if (!type) return false;
  const facts: BrainFacts = { type, restricted: !!w.vn?.restricted, nda: !!w.vn?.nda };
  if (effectivePublication(facts, cfg.publication) !== "direct") return false;
  if (w.personal) return true;
  return roleAllows(await storedBrainRole(c, w.stub, await humanIdsOf(c.env, sess(c))), "edit");
}
