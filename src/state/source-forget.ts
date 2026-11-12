export type FactForget =
  | { tag: "keep" }
  | { tag: "delete" }
  | { tag: "update"; sourceIds: string[]; hashes: Record<string, string> };

/** Drop a gone source from one fact. Unreadable text is not a list: a quoted id is deleted, anything else is left. */
export function forgetFactSources(
  sourceIdsRaw: unknown,
  hashesRaw: unknown,
  gone: ReadonlySet<string>,
): FactForget {
  const text = typeof sourceIdsRaw === "string" ? sourceIdsRaw : "";
  const ids = stringArray(text);
  if (ids === null) {
    for (const id of gone) if (text.includes(`"${id}"`)) return { tag: "delete" };
    return { tag: "keep" };
  }
  if (!ids.some((id) => gone.has(id))) return { tag: "keep" };
  const rest = ids.filter((id) => !gone.has(id));
  if (rest.length === 0) return { tag: "delete" };
  const hashes = stringRecord(typeof hashesRaw === "string" ? hashesRaw : "");
  for (const id of gone) delete hashes[id];
  return { tag: "update", sourceIds: rest, hashes };
}

function stringArray(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    return null;
  }
  return null;
}

function stringRecord(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
      return out;
    }
  } catch {
    return {};
  }
  return {};
}
