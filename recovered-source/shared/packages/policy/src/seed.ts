import type { Evidence, LeafData, Plane, Story } from "./types.ts";

/** FNV-1a, 32 bit. Deterministic and dependency free. */
export function fnv(s: string, basis = 2166136261): number {
  let h = basis;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Hasher = (s: string) => number;

/** A hasher salted with the seed, so the same seed always yields the same organisation. */
export const seeded =
  (seed: number): Hasher =>
  (s) =>
    fnv(`${seed}:${s}`);

export const pick = <T>(a: readonly T[], h: number): T => a[h % a.length] as T;

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const TYPES = ["Method", "Decision", "Deliverable", "Playbook", "Policy", "Template"];
export const OWNER_ROLES = [
  "Steward",
  "Practice lead",
  "Delivery manager",
  "Analyst",
  "Function head",
  "Reviewer",
];
export const TAGS = [
  "pricing",
  "method",
  "ai",
  "compliance",
  "onboarding",
  "quality",
  "lessons",
  "security",
];
export const SOURCES = [
  "Wiki page",
  "Decision log",
  "Document store",
  "Meeting capture",
  "Policy repository",
  "Ticket export",
];
const SUFFIX = [
  "guidance page",
  "decision record",
  "working template",
  "lessons summary",
  "review notes",
  "checklist",
];

export interface SynthOptions {
  plane: Plane;
  group: string;
  type?: string;
  status?: string;
  fresh?: boolean;
  star?: boolean;
  open?: boolean;
  sector?: string | null;
  perm?: boolean;
  authorId?: string | null;
}

/** Synthetic leaf content. Titles, counts and dates are generated, never real. */
export function synthLeaf(h: Hasher, id: string, label: string, o: SynthOptions): LeafData {
  const x = h(id);
  const d = (x >>> 5) % 125;
  const days = o.fresh ? d % 55 : d;
  const gap = !o.fresh && days > 90;
  const items = gap ? 1 + (x % 3) : 4 + (x % 37);
  const status = o.status ?? (x % 10 < 7 ? "approved" : x % 10 < 9 ? "candidate" : "draft");
  const evidence: Evidence = gap ? "unsupported" : (x >>> 4) % 10 < 7 ? "supported" : "partial";
  const star = !gap && (o.star !== undefined ? o.star : (x >>> 13) % 8 === 0);
  const srcI = h(`${id}s`) % SOURCES.length;
  const source = SOURCES[srcI] as string;
  const lineage = `${source} > ${o.group}`;
  const reviewedBy2 = o.plane === "GLOBAL_NONPERSONAL" && status === "approved";
  const revision = 1 + ((x >>> 14) % 9);
  const story: Story | null = star
    ? {
        internal: true,
        lesson: x % 2 === 0,
        extPermission: !!o.perm,
        external: !!o.perm && x % 3 === 0,
      }
    : null;
  const itemList = [0, 1, 2, 3].map((i) => {
    const g = h(id + i);
    const src = pick(SOURCES, g >>> 6);
    return {
      title: `${label}: ${pick(SUFFIX, g >>> 3)}`,
      source: src,
      ownerRole: pick(OWNER_ROLES, g >>> 9),
      revision: 1 + ((g >>> 12) % 9),
      evidence: (gap
        ? "unsupported"
        : g % 10 < 6
          ? "supported"
          : g % 10 < 9
            ? "partial"
            : "unsupported") as Evidence,
      plane: o.plane,
      reviewedBy2: reviewedBy2 && i < 2,
    };
  });
  return {
    type: o.type ?? pick(TYPES, x >>> 3),
    status,
    evidence,
    ownerRole: pick(OWNER_ROLES, x >>> 9),
    ownerGroup: o.group,
    days,
    gap,
    items,
    open: !gap && (o.open !== undefined ? o.open : (x >>> 9) % 6 === 0),
    star,
    tags: [pick(TAGS, x >>> 2), pick(TAGS, x >>> 6)].filter((t, i, a) => a.indexOf(t) === i),
    revision,
    reviewedBy2,
    sector: o.sector ?? null,
    authorId: o.authorId ?? null,
    lineage,
    story,
    itemList,
    redacted: false,
  };
}
