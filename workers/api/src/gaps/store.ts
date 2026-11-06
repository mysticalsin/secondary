// Gap records, kept in the brain's own workspace as items of kind v8_gap (one per normalised
// question). A snapshot, a restore, an erasure and a reseed cover them like any other item. A record
// holds the asked text only because the asker could read this brain and no personal data was found.

import type { workspaceStub } from "../stubs.ts";
import { V8_ACTOR } from "../v8-keys.ts";
import {
  ASKERS_KEPT,
  DAY,
  DAYS_KEPT,
  dayOf,
  GAPS_PER_BRAIN,
  type GapSource,
  type GapStatus,
} from "./model.ts";

type Stub = ReturnType<typeof workspaceStub>;

export const GAP_KIND = "v8_gap";
const PREFIX = "gap:";

export interface Gap {
  id: string;
  text: string;
  key: string;
  count: number;
  /** Short hashes of who asked, so one person asking ten times is one asker. */
  askerHashes: string[];
  byRole: Record<string, number>;
  bySource: Record<GapSource, number>;
  days: Record<string, number>;
  firstAt: number;
  lastAt: number;
  status: GapStatus;
  assignedTo: string | null;
  assignedBy: string | null;
  due: string | null;
  proposalId: string | null;
  pageId: string | null;
  closedAt: number | null;
  dismissedReason: string | null;
  dismissedNote: string | null;
  mergedInto: string | null;
  mergedFrom: number;
  reopened: number;
}

/** The record id of a normalised question: the same words always land on the same record. */
export const gapIdOf = async (key: string): Promise<string> => `${PREFIX}${await sha(key)}`;

export async function sha(text: string, n = 16): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, n);
}

function parse(id: string, body: string | null): Gap | null {
  try {
    const v = JSON.parse(body ?? "") as Partial<Gap>;
    if (typeof v.text !== "string" || typeof v.key !== "string") return null;
    return {
      id,
      text: v.text,
      key: v.key,
      count: Number(v.count) || 0,
      askerHashes: Array.isArray(v.askerHashes) ? v.askerHashes.map(String) : [],
      byRole: v.byRole ?? {},
      bySource: { ask: 0, agent: 0, search: 0, ...(v.bySource ?? {}) },
      days: v.days ?? {},
      firstAt: Number(v.firstAt) || 0,
      lastAt: Number(v.lastAt) || 0,
      status: (v.status as GapStatus) ?? "open",
      assignedTo: v.assignedTo ?? null,
      assignedBy: v.assignedBy ?? null,
      due: v.due ?? null,
      proposalId: v.proposalId ?? null,
      pageId: v.pageId ?? null,
      closedAt: v.closedAt ?? null,
      dismissedReason: v.dismissedReason ?? null,
      dismissedNote: v.dismissedNote ?? null,
      mergedInto: v.mergedInto ?? null,
      mergedFrom: Number(v.mergedFrom) || 0,
      reopened: Number(v.reopened) || 0,
    };
  } catch {
    return null;
  }
}

export async function listGaps(stub: Stub): Promise<Gap[]> {
  const rows = await stub.listByKind(GAP_KIND, GAPS_PER_BRAIN + 50);
  return rows.flatMap((r) => {
    const g = parse(r.id, r.body);
    return g ? [g] : [];
  });
}

export async function getGap(stub: Stub, id: string): Promise<Gap | null> {
  const r = await stub.get(id);
  return r && r.kind === GAP_KIND ? parse(r.id, r.body) : null;
}

export async function putGap(stub: Stub, g: Gap, plane: string, now: number): Promise<void> {
  const { id, ...rest } = g;
  // Per-day counts older than the window carry no meaning.
  const cut = dayOf(now - DAYS_KEPT * DAY);
  rest.days = Object.fromEntries(Object.entries(rest.days).filter(([d]) => d >= cut));
  await stub.scratch(
    {
      id,
      label: "gap",
      kind: GAP_KIND,
      plane,
      origin: "personal",
      status: "open",
      authorId: V8_ACTOR,
      body: JSON.stringify(rest),
    },
    now,
  );
}

export function fresh(i: { id: string; text: string; key: string; now: number }): Gap {
  return {
    id: i.id,
    text: i.text,
    key: i.key,
    count: 0,
    askerHashes: [],
    byRole: {},
    bySource: { ask: 0, agent: 0, search: 0 },
    days: {},
    firstAt: i.now,
    lastAt: i.now,
    status: "open",
    assignedTo: null,
    assignedBy: null,
    due: null,
    proposalId: null,
    pageId: null,
    closedAt: null,
    dismissedReason: null,
    dismissedNote: null,
    mergedInto: null,
    mergedFrom: 0,
    reopened: 0,
  };
}

/** Count one ask into a record. */
export function bump(
  g: Gap,
  i: { asker: string; role: string; source: GapSource; now: number },
): Gap {
  const day = dayOf(i.now);
  const askers = g.askerHashes.includes(i.asker)
    ? g.askerHashes
    : [...g.askerHashes, i.asker].slice(-ASKERS_KEPT);
  return {
    ...g,
    count: g.count + 1,
    askerHashes: askers,
    byRole: { ...g.byRole, [i.role]: (g.byRole[i.role] ?? 0) + 1 },
    bySource: { ...g.bySource, [i.source]: g.bySource[i.source] + 1 },
    days: { ...g.days, [day]: (g.days[day] ?? 0) + 1 },
    lastAt: i.now,
  };
}
