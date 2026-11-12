/**
 * One wiki job. Queued and failed jobs for an erased source are removed.
 * A running job is cancelled. Done, cancelled, and any other word stay.
 * This module does not read a clock or a database.
 */

export type WikiJobStatus =
  | { tag: "pending" }
  | { tag: "running" }
  | { tag: "done" }
  | { tag: "failed" }
  | { tag: "cancelled" }
  | { tag: "unknown" };

export type WikiJobForget = { tag: "delete" } | { tag: "cancel" } | { tag: "keep" };

/** A stored word. `queued` is the older name for pending. Anything else is unknown and is kept. */
export function decodeWikiJobStatus(value: unknown): WikiJobStatus {
  if (value === "queued") return { tag: "pending" };
  if (value === "pending" || value === "running" || value === "done" || value === "failed" || value === "cancelled")
    return { tag: value };
  return { tag: "unknown" };
}

/** What forgetting a source does to one job. Unknown is kept, so a word we cannot read is not deleted. */
export function forgetWikiJob(state: WikiJobStatus): WikiJobForget {
  if (state.tag === "pending" || state.tag === "failed") return { tag: "delete" };
  if (state.tag === "running") return { tag: "cancel" };
  return { tag: "keep" };
}
