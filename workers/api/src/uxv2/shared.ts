// Helpers shared by the UX v2 routes. Everything here works from the caller's admitted view; nothing
// reads a workspace the view does not reach.

import {
  type AdmittedView,
  canDoInView,
  isPersonalKind,
  opensBrain,
  personalRootId,
} from "@secondary/policy";
import { HTTPException } from "hono/http-exception";
import { viewOf } from "../auth.ts";
import { scopeOfNode } from "../scope.ts";
import { workspaceStub } from "../stubs.ts";
import { type C, NODE_ID, notFound, sess } from "../ux/util.ts";

export type { C };

/** Node kinds that carry a wiki (same set as the wiki API). */
export const WIKI_NODE_KINDS = new Set(["account", "circle", "department", "core"]);

/** Every workspace scope the caller's view reaches (personal scopes are the caller's own). */
export function admittedScopes(view: AdmittedView): string[] {
  const out = new Set<string>();
  for (const vn of view.nodes.values()) {
    const s = scopeOfNode(vn);
    if (s) out.add(s);
  }
  return [...out].sort();
}

/** A tenant admin is someone whose role carries `configure`. */
export const isAdmin = (view: AdmittedView): boolean =>
  view.roles.some((r) => r.grants.some((g) => g.actions.includes("configure")));

export interface Target {
  /** The id a client uses for this workspace: "me" or a policy node id. */
  param: string;
  nodeId: string;
  scope: string;
  label: string;
  personal: boolean;
}

/**
 * A routine or an ask names a workspace by `me` (the Personal Brain), the caller's own Personal Brain
 * root id, or a policy node id. Anything the caller's view does not reach at content level is absent.
 */
export function resolveTarget(c: C, param: string, need: "read" | "contribute"): Target | null {
  const s = sess(c);
  const view = viewOf(s);
  if (param === "me" || param === personalRootId(s.principal.id))
    return {
      param: "me",
      nodeId: personalRootId(s.principal.id),
      scope: `personal:${s.principal.id}`,
      label: "My Secondary",
      personal: true,
    };
  if (!NODE_ID.test(param)) return null;
  const vn = view.nodes.get(param);
  if (!vn || isPersonalKind(vn.kind) || !WIKI_NODE_KINDS.has(vn.kind) || !opensBrain(vn))
    return null;
  const scope = scopeOfNode(vn);
  if (!scope) return null;
  if (need === "contribute" && !canDoInView(view, s.principal, vn.id, "contribute").allowed)
    return null;
  return { param: vn.id, nodeId: vn.id, scope, label: vn.label, personal: false };
}

export const stubOf = (c: C, scope: string) => workspaceStub(c.env, sess(c).tenantId, scope);

export const hex = (n: number): string =>
  [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const safeJson = (s: string | null): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(s ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const iso = (ms: number): string => new Date(ms).toISOString();

/** 400 for a malformed request, 404 where absence and denial must look the same. */
export const badRequest = (code: string) => new HTTPException(400, { message: code });
export { notFound };
