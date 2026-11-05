// Brain rules (docs/DESIGN-BRAINS-V3.md, API-CONTRACT "v3 brains"). Pure: a brain is a workspace seen
// from one angle, and these functions say what its type allows. The engine is unchanged; callers use
// these to bound publication mode, Everyone at Mantu and member roles, and to narrow a caller's rights.

import type { Action, NodeKind } from "./types.ts";

export type BrainType = "personal" | "team" | "account" | "global";
export type BrainRole = "reader" | "contributor" | "editor" | "steward" | "owner";
export type Publication = "review" | "direct";
export type Everyone = "none" | "reader" | "contributor";

export const BRAIN_ROLES: readonly BrainRole[] = [
  "reader",
  "contributor",
  "editor",
  "steward",
  "owner",
];

const READER: Action[] = ["view_structure", "view_content"];
const CONTRIBUTOR: Action[] = [...READER, "comment", "contribute"];
const EDITOR: Action[] = [...CONTRIBUTOR, "edit"];
const STEWARD: Action[] = [...EDITOR, "review", "approve_release"];
const OWNER: Action[] = [...STEWARD, "manage_members"];

const ACTIONS_OF: Record<BrainRole, readonly Action[]> = {
  reader: READER,
  contributor: CONTRIBUTOR,
  editor: EDITOR,
  steward: STEWARD,
  owner: OWNER,
};

export const BRAIN_ROLE_LABEL: Record<BrainRole, { label: string; summary: string }> = {
  reader: { label: "Reader", summary: "Reads the brain." },
  contributor: { label: "Contributor", summary: "Reads, comments and proposes pages for review." },
  editor: { label: "Editor", summary: "Contributes and edits pages, hides versions." },
  steward: { label: "Steward", summary: "Editor, and decides what is published." },
  owner: { label: "Owner", summary: "Steward, and manages members and settings." },
};

export const isBrainRole = (v: unknown): v is BrainRole =>
  typeof v === "string" && (BRAIN_ROLES as readonly string[]).includes(v);

/** The policy actions a brain role stands for. */
export const brainRoleActions = (role: BrainRole): readonly Action[] => ACTIONS_OF[role];

/** The lowest role that covers an action (an action no role covers needs the owner). */
export function minRoleFor(action: Action): BrainRole {
  for (const r of BRAIN_ROLES) if (ACTIONS_OF[r].includes(action)) return r;
  return "owner";
}

/**
 * A stored role only narrows. True when a person with this stored role (or none) may take `action`
 * as far as the brain is concerned. No stored role means the policy alone decides.
 */
export const roleAllows = (role: BrainRole | null, action: Action): boolean =>
  role === null || ACTIONS_OF[role].includes(action);

/** What kind of brain a policy node is. Null for a node that carries no brain. */
export function brainTypeOf(kind: NodeKind): BrainType | null {
  if (kind === "personal") return "personal";
  if (kind === "core") return "global";
  if (kind === "account") return "account";
  if (kind === "circle" || kind === "department") return "team";
  return null;
}

export interface BrainFacts {
  type: BrainType;
  /** The node's `restricted` flag. Accounts count as restricted whatever the flag says. */
  restricted?: boolean;
  nda?: boolean;
}

/** Account, NDA and restricted nodes are always restricted brains. */
export const isRestrictedBrain = (b: BrainFacts): boolean =>
  b.type === "account" || !!b.restricted || !!b.nda;

export interface Bound<T extends string> {
  allowed: readonly T[];
  default: T;
  /** Set when the type leaves no choice: the reason, in words for a person. */
  reason: string | null;
}

/** Publication mode. Account, restricted and Global brains force review. */
export function publicationBound(b: BrainFacts): Bound<Publication> {
  if (b.type === "personal")
    return { allowed: ["review", "direct"], default: "review", reason: null };
  if (b.type === "global")
    return { allowed: ["review"], default: "review", reason: "Company Global always needs review" };
  if (isRestrictedBrain(b))
    return {
      allowed: ["review"],
      default: "review",
      reason: "Account and restricted brains always need review",
    };
  return { allowed: ["review", "direct"], default: "review", reason: null };
}

/** Everyone at Mantu. Never on a Personal, account, NDA or restricted brain. */
export function everyoneBound(b: BrainFacts): Bound<Everyone> {
  if (b.type === "personal")
    return { allowed: ["none"], default: "none", reason: "A Personal Brain is never shared" };
  if (b.type === "global")
    return {
      allowed: ["reader"],
      default: "reader",
      reason: "Company Global is open to everyone to read",
    };
  if (isRestrictedBrain(b))
    return {
      allowed: ["none"],
      default: "none",
      reason: "Everyone at Mantu is never allowed on account, NDA or restricted brains",
    };
  return { allowed: ["none", "reader", "contributor"], default: "none", reason: null };
}

/** The publication mode that applies now: the stored choice, held inside the bounds. */
export function effectivePublication(b: BrainFacts, stored: Publication | null): Publication {
  const bound = publicationBound(b);
  return stored && bound.allowed.includes(stored) ? stored : bound.default;
}

export function effectiveEveryone(b: BrainFacts, stored: Everyone | null): Everyone {
  const bound = everyoneBound(b);
  return stored && bound.allowed.includes(stored) ? stored : bound.default;
}

/** Members and roles. A Personal Brain is never shared. */
export const isShareable = (b: BrainFacts): boolean => b.type !== "personal";
