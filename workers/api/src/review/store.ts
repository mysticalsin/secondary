// Review desk state kept in the brain's own workspace: per-item snooze, assignment and "changes
// requested" (kind v8_review), and the brain's review SLA (kind v8_cfg). They are plain workspace
// items of their own kinds, so a snapshot, a restore, an erasure and a reseed already cover them and
// no listing of wiki proposals ever sees them. Keyed person ids and times only, never a principal id
// and never page text; the items are authored by a service actor (M-1).

import type { workspaceStub } from "../stubs.ts";
import { V8_ACTOR } from "../v8-keys.ts";
import { DEFAULT_SLA_DAYS, SLA_MAX_DAYS, SLA_MIN_DAYS } from "./model.ts";

type Stub = ReturnType<typeof workspaceStub>;

export const REVIEW_KIND = "v8_review";
export const CONFIG_KIND = "v8_cfg";
const SLA_ID = "v8cfg:sla";
const STATE_PREFIX = "rvx:";
const MAX_STATES = 1_000;

export interface ReviewState {
  /** Person key (keyed id, see v8-keys.ts) to the instant the item stays out of that person's way. */
  snooze: Record<string, number>;
  /** Person keys, never principal ids (M-1). */
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: number | null;
  /** Changes were requested on the proposal at this revision hash. */
  changes: { at: number; by: string; hash: string } | null;
  /** person key to the instant they were last mentioned in the discussion. */
  mentions: Record<string, number>;
  /** person key to the instant they last wrote in the discussion. */
  answered: Record<string, number>;
}

export const emptyState = (): ReviewState => ({
  snooze: {},
  assignedTo: null,
  assignedBy: null,
  assignedAt: null,
  changes: null,
  mentions: {},
  answered: {},
});

function parse(body: string | null): ReviewState {
  try {
    const v = JSON.parse(body ?? "{}") as Partial<ReviewState>;
    return {
      snooze: v.snooze && typeof v.snooze === "object" ? v.snooze : {},
      assignedTo: typeof v.assignedTo === "string" ? v.assignedTo : null,
      assignedBy: typeof v.assignedBy === "string" ? v.assignedBy : null,
      assignedAt: typeof v.assignedAt === "number" ? v.assignedAt : null,
      changes: v.changes && typeof v.changes === "object" ? v.changes : null,
      mentions: v.mentions && typeof v.mentions === "object" ? v.mentions : {},
      answered: v.answered && typeof v.answered === "object" ? v.answered : {},
    };
  } catch {
    return emptyState();
  }
}

/** Every stored state of the brain, by proposal id. */
export async function readStates(stub: Stub): Promise<Map<string, ReviewState>> {
  const rows = await stub.listByKind(REVIEW_KIND, MAX_STATES);
  return new Map(rows.map((r) => [r.id.slice(STATE_PREFIX.length), parse(r.body)]));
}

export async function readState(stub: Stub, proposalId: string): Promise<ReviewState> {
  const r = await stub.get(`${STATE_PREFIX}${proposalId}`);
  return r && r.kind === REVIEW_KIND ? parse(r.body) : emptyState();
}

export async function writeState(
  stub: Stub,
  proposalId: string,
  state: ReviewState,
  plane: string,
  now: number,
): Promise<void> {
  // Past snoozes carry no meaning: keep the record small.
  const live = Object.fromEntries(Object.entries(state.snooze).filter(([, until]) => until > now));
  await stub.scratch(
    {
      id: `${STATE_PREFIX}${proposalId}`,
      label: "review state",
      kind: REVIEW_KIND,
      plane,
      origin: "personal",
      status: "open",
      authorId: V8_ACTOR,
      body: JSON.stringify({ ...state, snooze: live }),
    },
    now,
  );
}

export async function readSla(stub: Stub): Promise<number> {
  const r = await stub.get(SLA_ID);
  if (!r || r.kind !== CONFIG_KIND) return DEFAULT_SLA_DAYS;
  try {
    const d = (JSON.parse(r.body ?? "{}") as { days?: unknown }).days;
    return typeof d === "number" && Number.isInteger(d) && d >= SLA_MIN_DAYS && d <= SLA_MAX_DAYS
      ? d
      : DEFAULT_SLA_DAYS;
  } catch {
    return DEFAULT_SLA_DAYS;
  }
}

export async function writeSla(
  stub: Stub,
  days: number,
  plane: string,
  now: number,
): Promise<void> {
  await stub.scratch(
    {
      id: SLA_ID,
      label: "review sla",
      kind: CONFIG_KIND,
      plane,
      origin: "personal",
      status: "open",
      authorId: V8_ACTOR,
      body: JSON.stringify({ days }),
    },
    now,
  );
}
