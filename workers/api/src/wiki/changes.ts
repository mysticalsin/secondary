// "Seen every change" (API-CONTRACT v4). A change is a maximal run of consecutive add/del lines in one
// page's diff, numbered 0.. in page order. Approving a wiki proposal needs proof that each one was seen.

import type { DiffLine } from "./text.ts";

/** Per page, per line: the change a line belongs to (null for an unchanged line), and the total. */
export function numberChanges(pages: readonly (readonly DiffLine[])[]): {
  index: (number | null)[][];
  count: number;
} {
  let count = 0;
  const index = pages.map((diff) => {
    let inRun = false;
    return diff.map((d) => {
      if (d.type === "same") {
        inRun = false;
        return null;
      }
      if (!inRun) {
        inRun = true;
        count++;
      }
      return count - 1;
    });
  });
  return { index, count };
}

export interface SeenChanges {
  revisionHash: string;
  indexes: number[];
}

const MAX_INDEXES = 5_000;

/** The `seenChanges` of a request body: undefined when absent, null when malformed. */
export function parseSeen(v: unknown): SeenChanges | null | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.revisionHash !== "string" || o.revisionHash.length > 128) return null;
  if (!Array.isArray(o.indexes) || o.indexes.length > MAX_INDEXES) return null;
  if (!o.indexes.every((i) => Number.isInteger(i) && (i as number) >= 0)) return null;
  return { revisionHash: o.revisionHash, indexes: o.indexes as number[] };
}

/**
 * Null when the approval may go ahead: the proposal changes nothing on a page, or the acknowledgement
 * names the current revision and covers every change. Otherwise the reason (stale or not covered).
 */
export function seenProblem(
  current: { revisionHash: string; pages: readonly { diff: readonly DiffLine[] }[] },
  seen: SeenChanges | null | undefined,
): { reason: string; changeCount: number } | null {
  const { count } = numberChanges(current.pages.map((p) => p.diff));
  if (count === 0) return null;
  if (!seen)
    return { reason: "See every change before you approve: send seenChanges", changeCount: count };
  if (seen.revisionHash !== current.revisionHash)
    return {
      reason: "The proposal changed since you read it. Read every change again",
      changeCount: count,
    };
  const have = new Set(seen.indexes);
  for (let i = 0; i < count; i++)
    if (!have.has(i))
      return { reason: `Change ${i + 1} of ${count} was not seen`, changeCount: count };
  return null;
}
