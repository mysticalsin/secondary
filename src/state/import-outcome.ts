/**
 * Import publish outcome. A personal auto-accept stays a draft.
 * Publishing is an explicit action. An unknown stored word writes nothing.
 * The caller writes with a from-status predicate and keeps the row when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type ImportStatus = { tag: "draft" } | { tag: "published" } | { tag: "unknown" };

export type ImportEvent = { type: "auto_accept" } | { type: "publish" };

export type ImportEffect = { type: "publish" };

export type ImportStep = { ok: true; state: ImportStatus; effects: ImportEffect[] } | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not publish. */
export function claimImport(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored item status. candidate is a draft. approved is published. Anything else writes nothing. */
export function decodeImportStatus(status: unknown): ImportStatus {
  if (status === "candidate") return { tag: "draft" };
  if (status === "approved") return { tag: "published" };
  return { tag: "unknown" };
}

/** One function for the dry run and the real import. Defaults to draft. Publishing is explicit. */
export function publishMode(explicit: boolean): "draft" | "published" {
  return explicit ? "published" : "draft";
}

const allow = (state: ImportStatus, effects: ImportEffect[]): ImportStep => ({
  ok: true,
  state,
  effects,
});

export function transitionImport(state: ImportStatus, event: ImportEvent): ImportStep {
  if (state.tag === "unknown") {
    return reject("import_outcome", state.tag, event.type, "state_unreadable");
  }
  if (event.type === "auto_accept") return allow(state, []);
  if (state.tag === "draft") return allow({ tag: "published" }, [{ type: "publish" }]);
  return reject("import_outcome", state.tag, "publish", "not_draft");
}

export const commitImport = (state: ImportStatus, event: ImportEvent): ImportStep =>
  commit(transitionImport(state, event));
