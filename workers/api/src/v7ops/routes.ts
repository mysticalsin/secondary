// v7 operate routes (docs/API-CONTRACT.md "v7 Operate"): Brain activity, the caller's own agent calls,
// Sources and Platform health. Scoped before anything is read: a brain manager sees their brain, a
// person sees their own agent calls, an admin sees sources and the tenant, a steward sees their brains.
// Responses carry ids, counts, codes and timings, never page content.

import { isPersonalKind } from "@secondary/policy";
import { Hono } from "hono";
import {
  ACTIVITY_WINDOWS,
  type ActivityWindow,
  bucketsOf,
  calloutOf,
  EVENT_ID,
  failuresOf,
  HEALTH_WINDOWS,
  type HealthWindow,
  heatmapOf,
  OPS_STATUSES,
  outcomesOf,
  parseRetry,
  SLO_DEFAULT,
} from "../../../../packages/contracts/src/ops-v7.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { HOSTS, isHostId } from "../brains/model.ts";
import { admittedBrainParams, type Brain, brainOf, needBrain, needFlag } from "../brains/open.ts";
import { scopeOfNode } from "../scope.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, forbidden, notFound, readObject, sess } from "../ux/util.ts";
import { isAdmin, WIKI_NODE_KINDS } from "../uxv2/shared.ts";
import { sourcesBackend } from "./backend.ts";
import { type BrainRef, collect } from "./collect.ts";
import {
  CREDENTIAL_NAME,
  FILE_TYPES,
  ROTATE_KEY,
  type Settings,
  SOURCE_CFG_ID,
  type SourceRow,
  type SourcesBackend,
} from "./model.ts";
import { eventOut, type Filters, matches, type Rec } from "./records.ts";

const iso = (ms: number): string => new Date(ms).toISOString();
const MAX_EVENTS = 200;
const DAY = 86_400_000;
const CHIP = /^[A-Za-z0-9/._ -]{1,60}$/;
const MAX_ROWS = 24;
const OPS_SCOPE = "ops:sources";

const brainRef = (b: Brain): BrainRef => ({
  param: b.param,
  scope: b.scope,
  nodeId: b.nodeId,
  label: b.label,
});

/** Every shared brain of the tenant, in the organisation's order (structure only, no content). */
function tenantBrains(c: C): BrainRef[] {
  const org = requireOrg(sess(c));
  const out: BrainRef[] = [];
  const seen = new Set<string>();
  for (const n of org.nodes.values()) {
    if (!WIKI_NODE_KINDS.has(n.kind) || isPersonalKind(n.kind)) continue;
    const scope = scopeOfNode(n);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    out.push({ param: n.id, scope, nodeId: n.id, label: n.label });
  }
  return out;
}

/** The dev stand-in feeds the bid, delivery and sales brains first, so the demo stories land where people look. */
const SYNTH_FIRST = ["c_bid", "c_delivery", "c_sales"];
const backendOf = (c: C): SourcesBackend | null => {
  const all = tenantBrains(c);
  const rank = (b: BrainRef): number => {
    const i = SYNTH_FIRST.indexOf(b.scope);
    return i < 0 ? SYNTH_FIRST.length : i;
  };
  const ordered = [...all].sort((a, z) => rank(a) - rank(z));
  return sourcesBackend(
    c,
    ordered.map((b) => ({ scopeId: b.scope, label: b.label })),
  );
};

function pick<T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  dflt: T,
  code: string,
): T {
  const x = v ?? dflt;
  if (!(allowed as readonly string[]).includes(x)) throw bad(code);
  return x as T;
}

type Query = {
  window: ActivityWindow;
  filters: Filters;
  from: number | null;
  to: number | null;
};

function activityQuery(c: C): Query {
  const window = pick(
    c.req.query("window"),
    Object.keys(ACTIVITY_WINDOWS) as ActivityWindow[],
    "60m",
    "invalid_window",
  );
  const status = pick(
    c.req.query("status"),
    ["all", "needs_review", "blocked", "failed"] as const,
    "all",
    "invalid_status",
  );
  const q = (c.req.query("q") ?? "").trim();
  if (q.length > 80) throw bad("invalid_q");
  const t = (name: string): number | null => {
    const v = c.req.query(name);
    if (v === undefined || v === "") return null;
    const n = Date.parse(v);
    if (!Number.isFinite(n)) throw bad(`invalid_${name}`);
    return n;
  };
  return { window, filters: { status, q }, from: t("from"), to: t("to") };
}

/** The shared body of a brain's or a person's activity answer. */
function activityBody(
  records: Rec[],
  qy: Query,
  now: number,
  extra: { synthetic: boolean; partial: boolean },
) {
  const win = ACTIVITY_WINDOWS[qy.window];
  const start = now - win.ms;
  const inWin = records.filter((r) => r.at >= start && r.at <= now);
  const from = Math.max(start, qy.from ?? start);
  const to = Math.min(now, qy.to ?? now);
  const { buckets, perDot } = bucketsOf(inWin, qy.window, now);
  const matching = inWin.filter((r) => r.at >= from && r.at <= to && matches(r, qy.filters));
  const counts = Object.fromEntries(OPS_STATUSES.map((s) => [s, 0])) as Record<
    (typeof OPS_STATUSES)[number],
    number
  >;
  for (const r of inWin) counts[r.status]++;
  return {
    window: qy.window,
    from: iso(from),
    to: iso(to),
    generatedAt: iso(now),
    synthetic: extra.synthetic,
    partial: extra.partial,
    perDot,
    buckets,
    callout: calloutOf(inWin),
    totals: { all: inWin.length, ...counts, matching: matching.length },
    events: matching.slice(0, MAX_EVENTS).map(eventOut),
  };
}

const detailBody = (r: Rec, retry: { at: number } | null) => ({
  ...eventOut(r),
  steps: r.steps,
  metadata: r.metadata,
  retry: retry ? { requestedAt: iso(retry.at) } : null,
});

export function opsRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const flag = async (c: C, next: () => Promise<void>) =>
    (await needFlag(c, "brains_v3")) ?? next();
  r.use("/brains/:id/activity", flag);
  r.use("/brains/:id/activity/*", flag);

  // ---- Brain activity (managers of the brain) ----

  const brainRecords = async (c: C, b: Brain, windowMs: number) => {
    const s = sess(c);
    const backend = backendOf(c);
    const got = await collect(c, {
      brains: [brainRef(b)],
      sinceMs: s.ctx.now - windowMs,
      principalId: null,
      backend,
    });
    return { ...got, synthetic: backend?.synthetic === true };
  };

  r.get("/brains/:id/activity", async (c) => {
    const qy = activityQuery(c);
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const now = sess(c).ctx.now;
    const got = await brainRecords(c, b, ACTIVITY_WINDOWS[qy.window].ms);
    c.header("Cache-Control", "no-store");
    return c.json({
      brainId: b.param,
      ...activityBody(got.records, qy, now, got),
    });
  });

  const eventOf = async (c: C, b: Brain, id: string) => {
    if (!EVENT_ID.test(id)) throw notFound();
    const got = await brainRecords(c, b, ACTIVITY_WINDOWS["7d"].ms);
    const rec = got.records.find((x) => x.id === id);
    if (!rec) throw notFound();
    return rec;
  };

  r.get("/brains/:id/activity/:eventId", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const rec = await eventOf(c, b, c.req.param("eventId"));
    c.header("Cache-Control", "no-store");
    return c.json(detailBody(rec, await b.stub.opsRetryGet(rec.id)));
  });

  r.post("/brains/:id/activity/:eventId/retry", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const rec = await eventOf(c, b, c.req.param("eventId"));
    const kind = rec.retryKind;
    if (!kind)
      return c.json(
        { error: "not_retryable", reason: "Only failed syncs and ingests can be retried" },
        409,
      );
    const s = sess(c);
    c.header("Cache-Control", "no-store");
    const done = await b.stub.opsRetryGet(rec.id);
    if (done) return c.json({ ok: true, retryId: done.retryId, kind, already: true });
    const backend = kind === "connector" ? backendOf(c) : null;
    if (kind === "connector") {
      if (!backend || !rec.sourceId) return c.json({ error: "connector_unavailable" }, 503);
      const src = await backend.get(rec.sourceId);
      if (!src) throw notFound();
      if (src.paused) return c.json({ error: "paused" }, 409);
    }
    if (
      !(await audit(c, {
        action: "activity.retry",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
        reason: `event=${rec.id} kind=${kind}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const claim = await b.stub.opsRetryClaim(
      rec.id,
      `rty_${crypto.randomUUID()}`,
      s.ctx.now,
      s.principal.id,
    );
    if (claim.already) return c.json({ ok: true, retryId: claim.retryId, kind, already: true });
    if (kind === "connector" && backend && rec.sourceId) await backend.run(rec.sourceId);
    else if (kind === "ingest" && rec.sourceId)
      await b.stub.wikiEnqueue("ingest", { sourceId: rec.sourceId, force: true }, s.ctx.now);
    return c.json({ ok: true, retryId: claim.retryId, kind, already: false }, 202);
  });

  // ---- the caller's own agent calls (Settings, Agents) ----

  const agentRecords = async (c: C, windowMs: number) => {
    const s = sess(c);
    return collect(c, {
      brains: tenantBrains(c),
      sinceMs: s.ctx.now - windowMs,
      principalId: s.principal.id,
      agentsOnly: true,
      keepUnmapped: true,
      receiptsOnly: true,
      backend: null,
    });
  };
  const noRetry = (e: ReturnType<typeof eventOut>) => ({ ...e, retryable: false });

  r.get("/agents/activity", async (c) => {
    const qy = activityQuery(c);
    const host = c.req.query("host");
    if (host !== undefined && host !== "" && !isHostId(host)) throw bad("invalid_host");
    const label = host ? HOSTS.find((h) => h[0] === host)?.[1] : undefined;
    const s = sess(c);
    const got = await agentRecords(c, ACTIVITY_WINDOWS[qy.window].ms);
    const pool = label ? got.records.filter((x) => x.actor.label === label) : got.records;
    const body = activityBody(pool, qy, s.ctx.now, { synthetic: false, partial: got.partial });
    const start = s.ctx.now - ACTIVITY_WINDOWS[qy.window].ms;
    c.header("Cache-Control", "no-store");
    return c.json({
      ...body,
      events: body.events.map(noRetry),
      hosts: HOSTS.map(([id, name]) => ({
        id,
        label: name,
        count: got.records.filter((x) => x.actor.label === name && x.at >= start).length,
      })).filter((h) => h.count > 0),
    });
  });

  r.get("/agents/activity/:eventId", async (c) => {
    const id = c.req.param("eventId");
    if (!EVENT_ID.test(id)) throw notFound();
    const got = await agentRecords(c, ACTIVITY_WINDOWS["7d"].ms);
    const rec = got.records.find((x) => x.id === id);
    if (!rec) throw notFound();
    c.header("Cache-Control", "no-store");
    return c.json({ ...detailBody(rec, null), retryable: false });
  });

  // ---- Sources (admins) ----

  const needAdmin = (c: C): Response | null =>
    isAdmin(viewOf(sess(c))) ? null : forbidden(c, "Sources are for administrators");

  const brainOfScope = (c: C, scope: string): { id: string; label: string } => {
    const b = tenantBrains(c).find((x) => x.scope === scope);
    return b ? { id: b.param, label: b.label } : { id: scope, label: scope };
  };

  const configOf = (c: C, x: SourceRow, now: number) => {
    const pending = null as { requestedAt: string } | null;
    const available = [
      ...FILE_TYPES,
      ...x.settings.chips.filter((k) => !(FILE_TYPES as readonly string[]).includes(k)),
    ];
    return {
      id: x.id,
      name: x.name,
      provider: x.provider,
      location: { label: x.name, folder: x.folder },
      target: {
        brainId: brainOfScope(c, x.scopeId).id,
        label: brainOfScope(c, x.scopeId).label,
        collection: "Sources",
      },
      chips: { selected: x.settings.chips, available, total: available.length },
      credential: {
        name: CREDENTIAL_NAME,
        rotatedAt: x.rotatedAt === null ? null : iso(x.rotatedAt),
        pending,
      },
      schedule: { deltaMinutes: x.settings.deltaMinutes },
      retry: x.settings.retry,
      timeoutSeconds: x.settings.timeoutSeconds,
      aclMaxAgeSeconds: x.settings.aclMaxAgeSeconds,
      status: x.paused ? "paused" : "active",
      lastSyncAt: x.lastSyncAt === null ? null : iso(x.lastSyncAt),
      lastError: x.lastError,
      synthetic: x.synthetic,
      generatedAt: iso(now),
    };
  };

  /** A rotation waiting for its second person, from the marker kept beside the two-person step. */
  const pendingOf = async (c: C, id: string): Promise<{ requestedAt: string } | null> => {
    const s = sess(c);
    const raw = await workspaceStub(c.env, s.tenantId, OPS_SCOPE).opsKvGet(`rotate:${id}`);
    if (!raw) return null;
    const at = (JSON.parse(raw) as { at: number }).at;
    if (s.ctx.now - at >= DAY) return null;
    if ((await tenantStub(c.env, s.tenantId).pendingRequester(ROTATE_KEY(id), s.ctx.now)) === null)
      return null;
    return { requestedAt: iso(at) };
  };

  const sourceOr404 = async (c: C, backend: SourcesBackend, id: string): Promise<SourceRow> => {
    if (!SOURCE_CFG_ID.test(id)) throw notFound();
    const x = await backend.get(id);
    if (!x) throw notFound();
    return x;
  };

  const unavailable = (c: C) => c.json({ error: "connector_unavailable" }, 503);

  r.get("/sources", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    const backend = backendOf(c);
    const list = backend ? await backend.list() : null;
    if (!backend || !list) return unavailable(c);
    const now = sess(c).ctx.now;
    c.header("Cache-Control", "no-store");
    return c.json({
      synthetic: backend.synthetic,
      sources: list.map((x) => ({
        id: x.id,
        name: x.name,
        provider: x.provider,
        target: {
          brainId: brainOfScope(c, x.scopeId).id,
          label: brainOfScope(c, x.scopeId).label,
          collection: "Sources",
        },
        status: x.paused ? "paused" : "active",
        lastSyncAt: x.lastSyncAt === null ? null : iso(x.lastSyncAt),
        lastError: x.lastError,
        files: x.files,
        nextRunInSeconds: x.paused
          ? null
          : Math.max(
              0,
              Math.round(x.settings.deltaMinutes * 60 - (now - (x.lastSyncAt ?? 0)) / 1000),
            ),
        synthetic: x.synthetic,
      })),
    });
  });

  r.get("/sources/:id", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    const backend = backendOf(c);
    if (!backend) return unavailable(c);
    const x = await sourceOr404(c, backend, c.req.param("id"));
    const cfg = configOf(c, x, sess(c).ctx.now);
    cfg.credential.pending = await pendingOf(c, x.id);
    c.header("Cache-Control", "no-store");
    return c.json(cfg);
  });

  const PUT_KEYS = new Set([
    "chips",
    "schedule",
    "retry",
    "timeoutSeconds",
    "aclMaxAgeSeconds",
    "status",
  ]);
  r.put("/sources/:id", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    const backend = backendOf(c);
    if (!backend) return unavailable(c);
    const x = await sourceOr404(c, backend, c.req.param("id"));
    const b = await readObject(c);
    for (const k of Object.keys(b)) if (!PUT_KEYS.has(k)) throw bad("unknown_field");
    const patch: Partial<Settings> = {};
    let paused: boolean | undefined;
    if (b.chips !== undefined) {
      if (
        !Array.isArray(b.chips) ||
        b.chips.length > 40 ||
        !b.chips.every((k) => typeof k === "string" && CHIP.test(k))
      )
        throw bad("invalid_chips");
      patch.chips = [...new Set(b.chips as string[])];
    }
    if (b.schedule !== undefined) {
      const m = (b.schedule as { deltaMinutes?: unknown } | null)?.deltaMinutes;
      if (typeof m !== "number" || !Number.isInteger(m) || m < 5 || m > 1440)
        throw bad("invalid_schedule");
      patch.deltaMinutes = m;
    }
    if (b.retry !== undefined) {
      const p = parseRetry(b.retry);
      if (!p) throw bad("invalid_retry");
      patch.retry = p;
    }
    if (b.timeoutSeconds !== undefined) {
      const t = b.timeoutSeconds;
      if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > 120)
        throw bad("invalid_timeout");
      patch.timeoutSeconds = t;
    }
    if (b.aclMaxAgeSeconds !== undefined) {
      const t = b.aclMaxAgeSeconds;
      if (typeof t !== "number" || !Number.isInteger(t) || t < 60 || t > 86_400)
        throw bad("invalid_acl_max_age");
      patch.aclMaxAgeSeconds = t;
    }
    if (b.status !== undefined) {
      if (b.status !== "active" && b.status !== "paused") throw bad("invalid_status");
      paused = b.status === "paused";
    }
    const keys = Object.keys(b);
    if (!keys.length) throw bad("nothing_to_change");
    if (
      !(await audit(c, {
        action: "source.config",
        nodeId: null,
        scopeId: x.scopeId,
        revision: null,
        reason: `source=${x.id} keys=${keys.sort().join(",")}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const next = await backend.put(x.id, {
      ...(Object.keys(patch).length ? { settings: patch } : {}),
      ...(paused !== undefined ? { paused } : {}),
    });
    if (!next) return unavailable(c);
    const cfg = configOf(c, next, sess(c).ctx.now);
    cfg.credential.pending = await pendingOf(c, x.id);
    c.header("Cache-Control", "no-store");
    return c.json(cfg);
  });

  r.post("/sources/:id/run", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    const backend = backendOf(c);
    if (!backend) return unavailable(c);
    const x = await sourceOr404(c, backend, c.req.param("id"));
    if (x.paused) return c.json({ error: "paused" }, 409);
    if (
      !(await audit(c, {
        action: "source.run",
        nodeId: null,
        scopeId: x.scopeId,
        revision: null,
        reason: `source=${x.id}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const res = await backend.run(x.id);
    if (res === "paused") return c.json({ error: "paused" }, 409);
    if (res !== "queued") return unavailable(c);
    return c.json({ ok: true }, 202);
  });

  r.post("/sources/:id/credential/rotate", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    const backend = backendOf(c);
    if (!backend) return unavailable(c);
    const x = await sourceOr404(c, backend, c.req.param("id"));
    const s = sess(c);
    const store = workspaceStub(c.env, s.tenantId, OPS_SCOPE);
    const step = await tenantStub(c.env, s.tenantId).requestSecond(
      ROTATE_KEY(x.id),
      s.principal.id,
      s.ctx.now,
      s.principal.email,
    );
    c.header("Cache-Control", "no-store");
    if (step === "same")
      return c.json({ status: "pending", needs: "second_person", name: CREDENTIAL_NAME }, 202);
    if (step === "first") {
      if (
        !(await audit(c, {
          action: "source.rotate_request",
          nodeId: null,
          scopeId: x.scopeId,
          revision: null,
          reason: `source=${x.id} secret=${CREDENTIAL_NAME}`,
        }))
      )
        return c.json({ error: "audit_unavailable" }, 503);
      await store.opsKvSet(`rotate:${x.id}`, JSON.stringify({ at: s.ctx.now }));
      return c.json({ status: "pending", needs: "second_person", name: CREDENTIAL_NAME }, 202);
    }
    if (
      !(await audit(c, {
        action: "source.rotate",
        nodeId: null,
        scopeId: x.scopeId,
        revision: null,
        reason: `source=${x.id} secret=${CREDENTIAL_NAME}`,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const done = await backend.put(x.id, { rotatedAt: s.ctx.now });
    if (!done) return unavailable(c);
    await store.opsKvSet(`rotate:${x.id}`, JSON.stringify({ at: 0 }));
    return c.json({ status: "rotated", name: CREDENTIAL_NAME, rotatedAt: iso(s.ctx.now) });
  });

  r.get("/sources/:id/stats", async (c) => {
    const no = needAdmin(c);
    if (no) return no;
    pick(c.req.query("window"), ["24h", "7d"] as const, "24h", "invalid_window");
    const backend = backendOf(c);
    if (!backend) return unavailable(c);
    const x = await sourceOr404(c, backend, c.req.param("id"));
    const stats = await backend.stats(x.id);
    if (!stats) return unavailable(c);
    c.header("Cache-Control", "no-store");
    return c.json(stats);
  });

  // ---- Platform health (admins: the tenant; stewards: their brains) ----

  r.get("/health", async (c) => {
    const win = pick(
      c.req.query("window"),
      Object.keys(HEALTH_WINDOWS) as HealthWindow[],
      "24h",
      "invalid_window",
    );
    const s = sess(c);
    const admin = isAdmin(viewOf(s));
    let brains: BrainRef[];
    if (admin) brains = tenantBrains(c);
    else {
      const opened = await Promise.all(
        admittedBrainParams(c)
          .filter((p) => p.param !== "me")
          .map((p) => brainOf(c, p.param)),
      );
      brains = opened
        .filter((b): b is Brain => b !== null && !b.personal && b.can.manage)
        .map(brainRef);
      if (!brains.length) return forbidden(c, "Health is for administrators and brain stewards");
    }
    const backend = backendOf(c);
    const now = s.ctx.now;
    const got = await collect(c, {
      brains,
      sinceMs: now - HEALTH_WINDOWS[win].ms,
      principalId: null,
      backend,
    });
    const recs = got.records.filter((x) => x.at >= now - HEALTH_WINDOWS[win].ms && x.at <= now);
    const outcomes = outcomesOf(recs);
    const attempts = recs.length;
    const delivered = outcomes.firstTry + outcomes.recovered;

    const mine = new Set(brains.map((b) => b.scope));
    const sources = ((await backend?.list()) ?? []).filter((x) => mine.has(x.scopeId));
    const rows = [
      ...brains.map((b) => ({ id: b.param, kind: "brain" as const, label: b.label })),
      ...sources.map((x) => ({ id: x.id, kind: "source" as const, label: x.name })),
    ];
    const heat = heatmapOf(recs, rows, win, now);
    const live = heat.rows
      .filter((x) => x.total > 0)
      .sort((a, z) => z.failed - a.failed || z.total - a.total || a.label.localeCompare(z.label))
      .slice(0, MAX_ROWS);
    c.header("Cache-Control", "no-store");
    return c.json({
      window: win,
      generatedAt: iso(now),
      scope: admin ? "tenant" : "stewards",
      synthetic: backend?.synthetic === true,
      partial: got.partial,
      slo: SLO_DEFAULT,
      success: {
        attempts,
        delivered,
        failed: outcomes.failing,
        rate: attempts ? delivered / attempts : 1,
      },
      outcomes,
      failures: failuresOf(recs),
      heatmap: { columnMs: heat.columnMs, columns: heat.columns, rows: live },
      totals: { attempts, delivered, failed: outcomes.failing },
    });
  });

  return r;
}
