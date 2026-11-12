/**
 * Remove one address from a cohort member list.
 * Comparison is trimmed and case-insensitive. A non-string element stays.
 * Unreadable text that names the address cannot be edited safely, so the
 * caller clears the list. Unreadable text that does not name it is left.
 */

export type PilotMemberDecision =
  | { tag: "keep" }
  | { tag: "write"; members: unknown[] }
  | { tag: "unreadable" };

export function forgetPilotMember(raw: unknown, email: string): PilotMemberDecision {
  const needle = email.trim().toLowerCase();
  if (needle === "") return { tag: "keep" };
  if (typeof raw !== "string") return { tag: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.toLowerCase().includes(needle) ? { tag: "unreadable" } : { tag: "keep" };
  }
  if (!Array.isArray(parsed))
    return raw.toLowerCase().includes(needle) ? { tag: "unreadable" } : { tag: "keep" };
  let changed = false;
  const members: unknown[] = [];
  for (const member of parsed) {
    if (typeof member === "string" && member.trim().toLowerCase() === needle) {
      changed = true;
      continue;
    }
    members.push(member);
  }
  return changed ? { tag: "write", members } : { tag: "keep" };
}
