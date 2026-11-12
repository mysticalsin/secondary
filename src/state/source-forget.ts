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

/** A published page has one search row of this text. Any other status has none. */
export function pageIndexMatches(
  status: unknown,
  expected: { title: string; summary: string; body: string },
  indexed: readonly { title: unknown; summary: unknown; body: unknown }[],
): boolean {
  if (status !== "published") return indexed.length === 0;
  if (indexed.length !== 1) return false;
  const row = indexed[0]!;
  return row.title === expected.title && row.summary === expected.summary && row.body === expected.body;
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
