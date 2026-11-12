/**
 * Wiki page visibility. A save publishes a missing page and rewrites a published page.
 * Saving an archived page is refused. Unarchive is its own event.
 * An unknown stored word writes nothing.
 * The caller writes with a from-status predicate and keeps the revision when one row changes.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type PageStatus =
  | { tag: "absent" }
  | { tag: "published" }
  | { tag: "archived" }
  | { tag: "unknown" };

export type PageEvent =
  | { type: "save"; now: number }
  | { type: "archive"; now: number }
  | { type: "unarchive"; now: number };

export type PageEffect =
  | { type: "insert" }
  | { type: "update" }
  | { type: "archive" }
  | { type: "unarchive" };

export type PageStep = { ok: true; state: PageStatus; effects: PageEffect[] } | IllegalTransition;

/** One changed row applies. Zero or several is a lost race and must not write a revision. */
export function claimPage(matchedRows: number): { tag: "applied" } | { tag: "replay" } {
  return matchedRows === 1 ? { tag: "applied" } : { tag: "replay" };
}

/** Stored status. Anything else is unknown and writes nothing. A missing row is absent, not a status word. */
export function decodePageStatus(status: unknown): PageStatus {
  if (status === "published" || status === "archived") return { tag: status };
  return { tag: "unknown" };
}

const allow = (state: PageStatus, effects: PageEffect[]): PageStep => ({ ok: true, state, effects });

export function transitionPage(state: PageStatus, event: PageEvent): PageStep {
  if (!Number.isSafeInteger(event.now)) {
    return reject("page_visibility", state.tag, event.type, "clock_unreadable");
  }
  if (state.tag === "unknown") {
    return reject("page_visibility", state.tag, event.type, "state_unreadable");
  }
  if (event.type === "save") {
    if (state.tag === "absent") return allow({ tag: "published" }, [{ type: "insert" }]);
    if (state.tag === "published") return allow({ tag: "published" }, [{ type: "update" }]);
    return reject("page_visibility", state.tag, "save", "archived");
  }
  if (event.type === "archive") {
    if (state.tag === "published") return allow({ tag: "archived" }, [{ type: "archive" }]);
    return allow(state, []);
  }
  if (state.tag === "archived") return allow({ tag: "published" }, [{ type: "unarchive" }]);
  return reject(
    "page_visibility",
    state.tag,
    "unarchive",
    state.tag === "published" ? "not_archived" : "absent",
  );
}

export const commitPage = (state: PageStatus, event: PageEvent): PageStep =>
  commit(transitionPage(state, event));
