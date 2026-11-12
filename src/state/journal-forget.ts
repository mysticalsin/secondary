/**
 * One journal row during erasure.
 * A switch row stays: its `a` is the switch name, not the person.
 * A row whose principal (`a`) is the person is deleted.
 * Anywhere else the id is an exact value, that value becomes the pseudonym
 * and the row stays, so a replay still restores the other person.
 * Prose that only contains the id is left as written.
 * A missing pseudonym clears the exact value, which still keeps the row.
 */

export type JournalRow = { kind: string; a: string; b: string; c: string };

export type JournalDecision =
  | { tag: "keep" }
  | { tag: "delete" }
  | { tag: "rewrite"; b: string; c: string };

function replaceExact(value: unknown, id: string, pseudonym: string): { value: unknown; changed: boolean } {
  if (typeof value === "string")
    return value === id ? { value: pseudonym, changed: true } : { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const replaced = replaceExact(item, id, pseudonym);
      if (replaced.changed) changed = true;
      return replaced.value;
    });
    return changed ? { value: next, changed } : { value, changed: false };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const replaced = replaceExact(item, id, pseudonym);
      next[key] = replaced.value;
      if (replaced.changed) changed = true;
    }
    return changed ? { value: next, changed } : { value, changed: false };
  }
  return { value, changed: false };
}

function rewriteField(raw: string, id: string, pseudonym: string): { text: string; changed: boolean } {
  if (raw === id) return { text: pseudonym, changed: true };
  if (raw === "") return { text: raw, changed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw, changed: false };
  }
  const replaced = replaceExact(parsed, id, pseudonym);
  if (!replaced.changed) return { text: raw, changed: false };
  return { text: JSON.stringify(replaced.value), changed: true };
}

export function forgetJournalEntry(row: JournalRow, id: string, pseudonym = ""): JournalDecision {
  if (id === "") return { tag: "keep" };
  if (row.kind === "switch") return { tag: "keep" };
  if (row.a === id) return { tag: "delete" };
  const b = rewriteField(row.b, id, pseudonym);
  const c = rewriteField(row.c, id, pseudonym);
  if (!b.changed && !c.changed) return { tag: "keep" };
  return { tag: "rewrite", b: b.text, c: c.text };
}
