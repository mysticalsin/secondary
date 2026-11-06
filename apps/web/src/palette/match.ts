// Matching for the palette. Pure. Words are matched as parts of a label or its keywords, accents and
// case ignored, every word must be found, and a label that starts with the first word comes first.

export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface Matchable {
  label: string;
  keywords?: string;
}

export function score(q: string, c: Matchable): number {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = fold(c.label);
  const hay = `${label} ${fold(c.keywords ?? "")}`;
  if (!words.every((w) => hay.includes(w))) return 0;
  const first = words[0] as string;
  return label.startsWith(first) ? 3 : label.includes(first) ? 2 : 1;
}

export function rank<T extends Matchable>(q: string, items: T[]): T[] {
  return items
    .map((c, i) => ({ c, s: score(q, c), i }))
    .filter((x) => x.s > 0)
    .sort((a, z) => z.s - a.s || a.i - z.i)
    .map((x) => x.c);
}
