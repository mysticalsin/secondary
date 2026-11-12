/**
 * A stored validation. Absent is no cell. Unreadable is not a validation:
 * it is not rewritten and it is not reported as a person.
 */

export type StoredUserValidated = { by: string; at: string; revision: number };

export type UserValidatedRead =
  | { tag: "absent" }
  | { tag: "ok"; value: StoredUserValidated }
  | { tag: "unreadable" };

export function readUserValidated(raw: unknown): UserValidatedRead {
  if (raw === null || raw === undefined) return { tag: "absent" };
  if (typeof raw !== "string") return { tag: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tag: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { tag: "unreadable" };
  const row = parsed as Record<string, unknown>;
  if (typeof row.by !== "string" || row.by === "") return { tag: "unreadable" };
  if (typeof row.at !== "string" || row.at === "") return { tag: "unreadable" };
  if (typeof row.revision !== "number" || !Number.isFinite(row.revision)) return { tag: "unreadable" };
  return { tag: "ok", value: { by: row.by, at: row.at, revision: row.revision } };
}
