/**
 * Remove one address from a cohort member list.
 * Comparison is trimmed and case-insensitive. A non-string element stays.
 * Unreadable text that names the address cannot be edited safely, so the
 * caller clears the list. Unreadable text that does not name it is left.
 */

import { asciiLower, normalEmail } from "./actor.ts";

export type PilotMemberDecision =
  | { tag: "keep" }
  | { tag: "write"; members: unknown[] }
  | { tag: "unreadable" };

export function forgetPilotMember(raw: unknown, email: string): PilotMemberDecision {
  const needle = normalEmail(email);
  if (needle === null) return { tag: "keep" };
  if (typeof raw !== "string") return { tag: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return asciiLower(raw).includes(needle) ? { tag: "unreadable" } : { tag: "keep" };
  }
  if (!Array.isArray(parsed))
    return asciiLower(raw).includes(needle) ? { tag: "unreadable" } : { tag: "keep" };
  let changed = false;
  const members: unknown[] = [];
  for (const member of parsed) {
    if (typeof member === "string" && normalEmail(member) === needle) {
      changed = true;
      continue;
    }
    members.push(member);
  }
  return changed ? { tag: "write", members } : { tag: "keep" };
}
