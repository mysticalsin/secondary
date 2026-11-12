/**
 * One journal row during erasure.
 * A switch row stays: its `a` is the switch name, not the person.
 * A row keyed by the person is deleted. An NDA detail that names them is
 * rewritten. Any other row whose text quotes them is deleted. Unreadable
 * NDA detail that quotes them is cleared rather than replayed.
 */

export type JournalRow = { kind: string; a: string; b: string; c: string };

export type JournalDecision = { tag: "keep" } | { tag: "delete" } | { tag: "rewrite"; c: string };

const names = (text: string, id: string): boolean => text === id || text.includes(`"${id}"`);

function redactDetail(raw: string, id: string): JournalDecision {
  if (raw === "") return { tag: "keep" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return names(raw, id) ? { tag: "rewrite", c: "" } : { tag: "keep" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return names(raw, id) ? { tag: "rewrite", c: "" } : { tag: "keep" };
  const detail = { ...(parsed as Record<string, unknown>) };
  let changed = false;
  for (const key of ["grantedBy", "approvedBy"]) {
    if (detail[key] === id) {
      detail[key] = "";
      changed = true;
    }
  }
  if (changed) return { tag: "rewrite", c: JSON.stringify(detail) };
  return names(raw, id) ? { tag: "delete" } : { tag: "keep" };
}

export function forgetJournalEntry(row: JournalRow, id: string): JournalDecision {
  if (id === "") return { tag: "keep" };
  if (row.kind === "switch") return { tag: "keep" };
  if (row.a === id) return { tag: "delete" };
  if (row.kind === "nda") return redactDetail(row.c, id);
  if (names(row.b, id) || names(row.c, id)) return { tag: "delete" };
  return { tag: "keep" };
}
