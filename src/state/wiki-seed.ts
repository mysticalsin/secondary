/**
 * Dev wiki-seed claim. One record: the completed version and an optional lease.
 * An unexpired claim blocks every other claim, including a higher version.
 * Completing cannot move the stored version backwards or clear a different claim.
 */

import { commit, type IllegalTransition, reject } from "./illegal.ts";

export type SeedClaim = { version: number; at: number };

export type SeedRecord = {
  v: 1;
  completed: number;
  claim: SeedClaim | null;
  unreadable: boolean;
};

export type SeedEvent =
  | { type: "claim"; version: number; now: number; leaseMs: number }
  | { type: "complete"; version: number }
  | { type: "reset" };

export type SeedEffect = { type: "write" } | { type: "skip" };

export type SeedStep = { ok: true; state: SeedRecord; effects: SeedEffect[] } | IllegalTransition;

export type WikiSeedResult =
  | { status: "off" | "current" | "busy" | "unseeded" }
  | { status: "seeded"; version: number; workspaces: number; records: number; pages: number };

const fresh = (): SeedRecord => ({ v: 1, completed: 0, claim: null, unreadable: false });

const write = (state: SeedRecord): SeedStep => ({ ok: true, state, effects: [{ type: "write" }] });

const integer = (n: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;

const finite = (n: number): boolean => typeof n === "number" && Number.isFinite(n);

/** Completed version is still behind the requested one. */
export const seedVersionPending = (completed: number, version: number): boolean => completed < version;

/** A claim still blocks a new one. The lease is exclusive at the exact deadline. */
export const seedLeaseOpen = (claim: SeedClaim, now: number, leaseMs: number): boolean =>
  now - claim.at < leaseMs;

export function transitionWikiSeed(state: SeedRecord, event: SeedEvent): SeedStep {
  if (event.type === "reset") return write(fresh());
  if (state.unreadable) {
    return reject("wiki_seed", "unreadable", event.type, "the stored seed record cannot be read");
  }
  if (event.type === "claim") {
    if (!integer(event.version) || !finite(event.now) || !finite(event.leaseMs) || event.leaseMs <= 0) {
      return reject("wiki_seed", "idle", "claim", "version, time, or lease is not usable");
    }
    if (!seedVersionPending(state.completed, event.version)) {
      return reject("wiki_seed", "idle", "claim", "this version is already complete");
    }
    if (state.claim && seedLeaseOpen(state.claim, event.now, event.leaseMs)) {
      return reject("wiki_seed", "claimed", "claim", "an unexpired claim is already held");
    }
    return write({
      v: 1,
      completed: state.completed,
      claim: { version: event.version, at: event.now },
      unreadable: false,
    });
  }
  if (!integer(event.version)) {
    return reject("wiki_seed", "idle", "complete", "version is not a whole number");
  }
  if (state.completed > event.version) {
    return reject("wiki_seed", "idle", "complete", "refusing to move the completed version backwards");
  }
  if (state.claim && state.claim.version !== event.version) {
    return reject("wiki_seed", "claimed", "complete", "the claim is for a different version");
  }
  return write({ v: 1, completed: event.version, claim: null, unreadable: false });
}

export const commitWikiSeed = (state: SeedRecord, event: SeedEvent): SeedStep =>
  commit(transitionWikiSeed(state, event));

const parseClaim = (raw: string): SeedClaim | "bad" => {
  try {
    const value = JSON.parse(raw) as { version?: unknown; at?: unknown };
    if (!value || typeof value !== "object") return "bad";
    if (!integer(value.version as number) || !finite(value.at as number)) return "bad";
    return { version: value.version as number, at: value.at as number };
  } catch {
    return "bad";
  }
};

/** Load the two config cells. A missing version is 0. Garbage is unreadable, not a fresh tenant. */
export function loadSeed(versionCell: string | null, claimCell: string | null): SeedRecord {
  let completed = 0;
  let unreadable = false;
  if (versionCell !== null && versionCell !== "") {
    if (!/^\d+$/.test(versionCell)) unreadable = true;
    else completed = Number(versionCell);
  }
  let claim: SeedClaim | null = null;
  if (claimCell !== null && claimCell !== "") {
    const parsed = parseClaim(claimCell);
    if (parsed === "bad") unreadable = true;
    else claim = parsed;
  }
  return { v: 1, completed, claim, unreadable };
}

/** Cells to write. Null deletes the key. Completed 0 omits the version, matching a tenant that has never finished. */
export function storeSeed(state: SeedRecord): { version: string | null; claim: string | null } {
  if (state.unreadable) return { version: null, claim: null };
  return {
    version: state.completed === 0 ? null : String(state.completed),
    claim: state.claim ? JSON.stringify({ version: state.claim.version, at: state.claim.at }) : null,
  };
}

export type StoredSeed = { v: 1; state: SeedRecord };

const SAFE_SEED: SeedRecord = { v: 1, completed: 0, claim: null, unreadable: true };

export const encodeSeed = (state: SeedRecord): StoredSeed => ({ v: 1, state });

export function decodeSeed(raw: unknown): SeedRecord {
  if (!raw || typeof raw !== "object") return SAFE_SEED;
  const rec = raw as { v?: unknown; state?: unknown };
  if (rec.v !== 1 || !rec.state || typeof rec.state !== "object") return SAFE_SEED;
  const state = rec.state as SeedRecord;
  if (state.v !== 1 || typeof state.unreadable !== "boolean") return SAFE_SEED;
  if (state.unreadable) return { v: 1, completed: 0, claim: null, unreadable: true };
  if (!integer(state.completed)) return SAFE_SEED;
  if (state.claim !== null) {
    if (!state.claim || !integer(state.claim.version) || !finite(state.claim.at)) return SAFE_SEED;
  }
  return {
    v: 1,
    completed: state.completed,
    claim: state.claim,
    unreadable: false,
  };
}

/** The status `ensureWikiSeed` returns. Same branches as the previous ifs. */
export function seedRunStatus(input: {
  enabled: boolean;
  hasConfig?: boolean;
  claimed?: boolean;
  completed?: number;
  version?: number;
  failed?: boolean;
  workspaces?: number;
  records?: number;
  pages?: number;
}): WikiSeedResult {
  if (!input.enabled) return { status: "off" };
  if (!input.hasConfig) return { status: "unseeded" };
  if (!input.claimed) {
    return {
      status: (input.completed ?? 0) >= (input.version ?? 0) ? "current" : "busy",
    };
  }
  if (input.failed) return { status: "busy" };
  return {
    status: "seeded",
    version: input.version ?? 0,
    workspaces: input.workspaces ?? 0,
    records: input.records ?? 0,
    pages: input.pages ?? 0,
  };
}
