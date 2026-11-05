// The contents of one brain as the familiar tree: collections, folders inside them, and loose pages.
// The wiki stores pages by type, so a collection is a type. The only folders are Sources > Session
// reports > <person>, which an agent's session report lands in (docs/API-CONTRACT.md v4).
import type { WikiIndex, WikiPageRow } from "../views/wiki/types";

export type ContentKind = "collection" | "folder" | "page";

export interface ContentNode {
  id: string;
  kind: ContentKind;
  label: string;
  /** Pages in it, nested ones included. */
  count: number;
  children: ContentNode[];
  page?: WikiPageRow;
}

export interface Contents {
  collections: ContentNode[];
  /** Pages that belong to no collection: an overview, or a page whose type the brain does not define. */
  loose: WikiPageRow[];
}

export const SESSION_TYPE = "session_report";
const HIDDEN_TYPES = new Set(["journal"]);
const LOOSE_TYPES = new Set(["overview"]);

/** "Session report Ada Lovelace 2026-11-04" gives "Ada Lovelace". Anything else has no person. */
export function personOf(title: string): string | null {
  const m = /^Session report (.+?) \d{4}-\d{2}-\d{2}$/.exec(title);
  return m ? (m[1] as string) : null;
}

const pageNode = (p: WikiPageRow): ContentNode => ({
  id: p.id,
  kind: "page",
  label: p.title,
  count: 1,
  children: [],
  page: p,
});

const byLabel = (a: ContentNode, b: ContentNode) => a.label.localeCompare(b.label);

function sessionCollection(pages: WikiPageRow[], labels: { sources: string; reports: string }) {
  const people = new Map<string, WikiPageRow[]>();
  for (const p of pages) {
    const who = personOf(p.title) ?? "-";
    people.set(who, [...(people.get(who) ?? []), p]);
  }
  const folders = [...people.entries()]
    .map<ContentNode>(([who, list]) => ({
      id: `folder:sessions:${who}`,
      kind: "folder",
      label: who,
      count: list.length,
      children: list.map(pageNode).sort((a, b) => b.label.localeCompare(a.label)),
    }))
    .sort(byLabel);
  const reports: ContentNode = {
    id: "folder:sessions",
    kind: "folder",
    label: labels.reports,
    count: pages.length,
    children: folders,
  };
  return {
    id: "collection:sources",
    kind: "collection" as const,
    label: labels.sources,
    count: pages.length,
    children: [reports],
  } satisfies ContentNode;
}

export function buildContents(
  idx: WikiIndex,
  labels: { sources: string; reports: string },
): Contents {
  const loose: WikiPageRow[] = [];
  const byType = new Map<string, WikiPageRow[]>();
  const known = new Set(Object.keys(idx.schema.types));
  for (const p of idx.pages) {
    if (HIDDEN_TYPES.has(p.type)) continue;
    if (LOOSE_TYPES.has(p.type) || (!known.has(p.type) && p.type !== SESSION_TYPE)) {
      loose.push(p);
      continue;
    }
    byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
  }
  const collections: ContentNode[] = [];
  const types = new Set([...byType.keys(), ...known]);
  for (const type of types) {
    if (HIDDEN_TYPES.has(type) || LOOSE_TYPES.has(type) || type === SESSION_TYPE) continue;
    const def = idx.schema.types[type];
    if (def?.generated && !byType.has(type)) continue;
    const pages = byType.get(type) ?? [];
    collections.push({
      id: `collection:${type}`,
      kind: "collection",
      label: def?.label ?? type,
      count: pages.length,
      children: pages.map(pageNode).sort(byLabel),
    });
  }
  collections.sort(byLabel);
  const sessions = byType.get(SESSION_TYPE);
  if (sessions?.length) collections.push(sessionCollection(sessions, labels));
  return { collections, loose };
}

/** Does a page match the contents filter? Matches title, summary and type label. */
export function pageMatches(p: WikiPageRow, term: string): boolean {
  const t = term.trim().toLowerCase();
  return !t || `${p.title} ${p.summary} ${p.type}`.toLowerCase().includes(t);
}

/** Keep the branches that hold a matching page, with the pages that match. */
export function filterTree(
  nodes: ContentNode[],
  keep: (p: WikiPageRow) => boolean,
  keepEmpty: boolean,
): ContentNode[] {
  const out: ContentNode[] = [];
  for (const n of nodes) {
    if (n.kind === "page") {
      if (n.page && keep(n.page)) out.push(n);
      continue;
    }
    const kids = filterTree(n.children, keep, false);
    const count = kids.reduce((s, k) => s + k.count, 0);
    if (kids.length || keepEmpty) out.push({ ...n, children: kids, count });
  }
  return out;
}
