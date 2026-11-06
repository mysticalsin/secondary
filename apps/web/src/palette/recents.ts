// Recent items of the palette. They stay in this browser, under the person's own id, and hold a
// label and a path: nothing that was not already on screen for them. Storage can be missing or
// refuse (a private window); the palette works without it.

export interface Recent {
  id: string;
  label: string;
  hint?: string;
  to: string;
}

const MAX = 6;
const key = (who: string) => `secondary.palette.recents.${who}`;

export function readRecents(who: string): Recent[] {
  if (!who) return [];
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(key(who)) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (r): r is Recent =>
          !!r &&
          typeof r === "object" &&
          typeof (r as Recent).id === "string" &&
          typeof (r as Recent).label === "string" &&
          typeof (r as Recent).to === "string" &&
          (r as Recent).to.startsWith("/"),
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecent(who: string, r: Recent): Recent[] {
  const next = [r, ...readRecents(who).filter((x) => x.id !== r.id)].slice(0, MAX);
  try {
    if (who) window.localStorage.setItem(key(who), JSON.stringify(next));
  } catch {
    /* storage unavailable: recents last for this page load only */
  }
  return next;
}

export function clearRecents(who: string): void {
  try {
    window.localStorage.removeItem(key(who));
  } catch {
    /* nothing to clear */
  }
}
