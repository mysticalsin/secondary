// The dev stand-in for the connector (OPS_SYNTHETIC=on, ENVIRONMENT=dev only): deterministic sources,
// Graph call timings, sync attempts and ACL ages from a seed, so Settings, Sources and Platform
// health show real shapes on a stack with no Graph. Everything it returns says `synthetic: true`.
// Edits (settings, pause, rotation) are kept through a small key-value store, so they survive requests.

import {
  aclStrip,
  DEFAULT_RETRY,
  latencyStats,
  nextDelay,
  retryPlan,
} from "../../../../packages/contracts/src/ops-v7.ts";
import type {
  AttemptOut,
  RunResult,
  Settings,
  SourceAttempts,
  SourceRow,
  SourceStats,
  SourcesBackend,
} from "./model.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const DEFAULT_SETTINGS: Settings = {
  chips: ["pdf", "docx", "pptx", "/Proposals"],
  deltaMinutes: 15,
  retry: DEFAULT_RETRY,
  timeoutSeconds: 15,
  aclMaxAgeSeconds: 900,
};

/** mulberry32 over a string seed: the same seed always gives the same numbers. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number): number => {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

export type KV = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};
type Saved = { settings?: Partial<Settings>; paused?: boolean; rotatedAt?: number; ranAt?: number };

export type SynthScope = { scopeId: string; label: string };

/** The synthetic sources: one per scope, at most three. */
export const synthSources = (
  scopes: SynthScope[],
): { id: string; name: string; scopeId: string }[] =>
  scopes.slice(0, 3).map((s, i) => ({
    id: `src_synth_${i + 1}`,
    name: `${s.label} library`.slice(0, 60),
    scopeId: s.scopeId,
  }));

/**
 * Sync attempts of the last 7 days for one source, oldest first, one run per delta interval from an
 * hour boundary up to `now`. The first source is in a Graph 429 streak right now (retrying), the second
 * had a timeout cluster a day ago, the third a permission streak two days ago.
 */
export function synthAttempts(
  tenantId: string,
  index: number,
  sourceId: string,
  deltaMinutes: number,
  now: number,
): AttemptOut[] {
  const r = rng(`${tenantId}:${sourceId}:attempts`);
  const anchor = Math.floor(now / HOUR) * HOUR;
  const step = deltaMinutes * 60_000;
  const out: AttemptOut[] = [];
  let streak = 0;
  for (let at = anchor - 7 * DAY; at <= now; at += step) {
    const ago = anchor - at;
    const live = index === 0 && now - at < 35 * 60_000;
    const inStreak =
      live ||
      (index === 1 && ago >= 20 * HOUR && ago < 21 * HOUR) ||
      (index === 2 && ago >= 52 * HOUR && ago < 52 * HOUR + 30 * 60_000);
    const noise = r();
    const fails = live || (inStreak ? noise < 0.7 : noise < 0.012);
    const ms = Math.round(Math.exp(Math.log(900) + 0.5 * gauss(r)));
    if (!fails) {
      streak++;
      out.push({ at, ms, outcome: "ok", reason: null, n: streak, retryAfter: null });
      streak = 0;
      continue;
    }
    streak++;
    const kind = index === 1 ? "timeout" : index === 2 ? "permission" : "429";
    out.push(
      kind === "timeout"
        ? { at, ms: 15_000, outcome: "timeout", reason: "timeout", n: streak, retryAfter: null }
        : kind === "permission"
          ? { at, ms, outcome: "error", reason: "permission_denied", n: streak, retryAfter: null }
          : { at, ms, outcome: "throttled", reason: "graph_429", n: streak, retryAfter: 40 },
    );
  }
  return out;
}

/** The last 320 Graph calls. A call slower than the timeout is a timeout, so a longer timeout turns them into good calls. */
export function synthCalls(
  tenantId: string,
  sourceId: string,
  timeoutSeconds: number,
): { ms: number; outcome: "ok" | "timeout" | "429" | "error" }[] {
  const r = rng(`${tenantId}:${sourceId}:calls`);
  const limit = timeoutSeconds * 1000;
  // 24 of 320 calls (7.5 percent) run long, 6 are throttled: fixed positions, so the shares hold still.
  return Array.from({ length: 320 }, (_, i) => {
    if (i % 50 === 7) return { ms: Math.round(700 + 500 * r()), outcome: "429" as const };
    const raw =
      i % 40 === 9 || i % 40 === 21 || i % 40 === 33
        ? Math.round(16_000 + 14_000 * r())
        : Math.max(40, Math.round(Math.exp(Math.log(292) + 0.75 * gauss(r))));
    return raw >= limit
      ? { ms: limit, outcome: "timeout" as const }
      : { ms: raw, outcome: "ok" as const };
  });
}

/** Ages of the cached read decisions: spread over two hours, a few refused. */
export function synthAcl(
  tenantId: string,
  sourceId: string,
  now: number,
): { allowed: boolean; checkedAt: number }[] {
  const r = rng(`${tenantId}:${sourceId}:acl`);
  return Array.from({ length: 180 }, (_, i) => ({
    allowed: i % 60 !== 59,
    checkedAt: now - Math.round(r() * 2 * HOUR),
  }));
}

export function statsFrom(
  tenantId: string,
  sourceId: string,
  s: Settings,
  attempts: AttemptOut[],
  now: number,
): SourceStats {
  const plan = retryPlan(s.retry);
  const last = attempts[attempts.length - 1];
  let next: SourceStats["retry"]["next"] = null;
  if (last && last.outcome !== "ok") {
    const wait = nextDelay(s.retry, last.n, last.retryAfter ?? undefined);
    if (wait !== null)
      next = {
        try: last.n + 1,
        inSeconds: Math.max(0, Math.round(wait - (now - last.at) / 1000)),
        last: last.reason === "graph_429" ? "429" : last.reason === "timeout" ? "timeout" : "error",
      };
  }
  const points = synthCalls(tenantId, sourceId, s.timeoutSeconds);
  return {
    synthetic: true,
    retry: {
      plan,
      tries: plan.length + 1,
      totalSeconds: plan[plan.length - 1]?.atSeconds ?? 0,
      honoursRetryAfter: true,
      next,
    },
    latency: { ...latencyStats(points, s.timeoutSeconds), points },
    acl: aclStrip(synthAcl(tenantId, sourceId, now), s.aclMaxAgeSeconds, now),
  };
}

export function syntheticBackend(o: {
  tenantId: string;
  scopes: SynthScope[];
  kv: KV;
  now: () => number;
}): SourcesBackend {
  const defs = synthSources(o.scopes);
  const key = (id: string) => `cfg:${id}`;
  const saved = async (id: string): Promise<Saved> => {
    const raw = await o.kv.get(key(id));
    return raw ? (JSON.parse(raw) as Saved) : {};
  };
  const settingsOf = (s: Saved): Settings => ({ ...DEFAULT_SETTINGS, ...s.settings });
  const attemptsOf = (i: number, id: string, s: Settings, now: number) =>
    synthAttempts(o.tenantId, i, id, s.deltaMinutes, now);

  const row = async (i: number): Promise<SourceRow> => {
    const d = defs[i] as (typeof defs)[number];
    const sv = await saved(d.id);
    const s = settingsOf(sv);
    const now = o.now();
    const at = attemptsOf(i, d.id, s, now);
    const ok = [...at].reverse().find((a) => a.outcome === "ok");
    const last = at[at.length - 1];
    return {
      id: d.id,
      name: d.name,
      provider: "sharepoint_drive",
      folder: "/Shared Documents",
      scopeId: d.scopeId,
      paused: sv.paused === true,
      settings: s,
      lastSyncAt: sv.ranAt ?? ok?.at ?? null,
      lastError: last && last.outcome !== "ok" ? (last.reason ?? "error") : null,
      files: 120 + i * 37,
      rotatedAt: sv.rotatedAt ?? null,
      synthetic: true,
    };
  };

  return {
    synthetic: true,
    list: async () => Promise.all(defs.map((_, i) => row(i))),
    get: async (id) => {
      const i = defs.findIndex((d) => d.id === id);
      return i < 0 ? null : row(i);
    },
    put: async (id, patch) => {
      const i = defs.findIndex((d) => d.id === id);
      if (i < 0) return null;
      const cur = await saved(id);
      const next: Saved = {
        ...cur,
        ...(patch.settings ? { settings: { ...cur.settings, ...patch.settings } } : {}),
        ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
        ...(patch.rotatedAt !== undefined ? { rotatedAt: patch.rotatedAt } : {}),
      };
      await o.kv.set(key(id), JSON.stringify(next));
      return row(i);
    },
    run: async (id): Promise<RunResult> => {
      const i = defs.findIndex((d) => d.id === id);
      if (i < 0) return "not_found";
      const cur = await saved(id);
      if (cur.paused) return "paused";
      await o.kv.set(key(id), JSON.stringify({ ...cur, ranAt: o.now() }));
      return "queued";
    },
    stats: async (id) => {
      const i = defs.findIndex((d) => d.id === id);
      if (i < 0) return null;
      const s = settingsOf(await saved(id));
      const now = o.now();
      return statsFrom(o.tenantId, id, s, attemptsOf(i, id, s, now), now);
    },
    attempts: async (since) =>
      Promise.all(
        defs.map(async (d, i): Promise<SourceAttempts> => {
          const s = settingsOf(await saved(d.id));
          return {
            id: d.id,
            name: d.name,
            scopeId: d.scopeId,
            attempts: attemptsOf(i, d.id, s, o.now()).filter((a) => a.at >= since),
          };
        }),
      ),
  };
}
