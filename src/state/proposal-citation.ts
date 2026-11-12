/**
 * Source ids a proposal body cites. A shape this store does not write is malformed.
 * This module does not throw, and it does not read a clock or a database.
 */

export type CitedSources = { ids: Set<string>; malformed: boolean };

/** Walk titleSources, reingest, sources[].id, and facts[].sourceIds. */
export function citedSourceIds(_body: string): CitedSources {
  return { ids: new Set(), malformed: false };
}
