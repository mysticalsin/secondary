/**
 * Source ids a proposal body cites. A shape this store does not write is malformed.
 * This module does not throw, and it does not read a clock or a database.
 */

export type CitedSources = { ids: Set<string>; malformed: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk titleSources, reingest, sources[].id, and facts[].sourceIds.
 * titleSources and reingest are arrays of source ids. A source is an object
 * with an id. A string in sources is not that shape, so it is malformed and
 * is not itself an id. Invalid JSON and any other type are malformed too.
 */
export function citedSourceIds(body: string): CitedSources {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ids: new Set(), malformed: true };
  }
  if (!record(parsed)) return { ids: new Set(), malformed: true };

  const ids = new Set<string>();
  let malformed = false;
  const takeString = (value: unknown): void => {
    if (typeof value !== "string") {
      malformed = true;
      return;
    }
    if (value !== "") ids.add(value);
  };
  const takeStringArray = (value: unknown): void => {
    if (!Array.isArray(value)) {
      malformed = true;
      return;
    }
    for (const item of value) takeString(item);
  };

  if ("titleSources" in parsed) takeStringArray(parsed.titleSources);
  if ("reingest" in parsed) takeStringArray(parsed.reingest);
  if ("sources" in parsed) {
    const sources = parsed.sources;
    if (!Array.isArray(sources)) malformed = true;
    else {
      for (const item of sources) {
        if (!record(item) || typeof item.id !== "string") {
          malformed = true;
          continue;
        }
        if (item.id !== "") ids.add(item.id);
      }
    }
  }
  if ("facts" in parsed) {
    const facts = parsed.facts;
    if (!Array.isArray(facts)) malformed = true;
    else {
      for (const fact of facts) {
        if (!record(fact)) {
          malformed = true;
          continue;
        }
        if (!("sourceIds" in fact)) continue;
        const sourceIds = fact.sourceIds;
        if (!Array.isArray(sourceIds)) {
          malformed = true;
          continue;
        }
        for (const id of sourceIds) takeString(id);
      }
    }
  }
  return { ids, malformed };
}
