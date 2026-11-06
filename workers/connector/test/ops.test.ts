// v7 operate: the connector records every Graph call and every sync attempt, honours the per-source
// settings, and serves the numbers (retry plan, latency, ACL strip) to the api. Numbers only.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { latencyStats } from "../../../packages/contracts/src/ops-v7.ts";
import { checkAccess } from "../src/acl.ts";
import { GraphClient } from "../src/graph.ts";
import { itemKey, userKey } from "../src/ids.ts";
import worker, { createApp } from "../src/index.ts";
import { signInternalRequest } from "../src/internal-auth.ts";
import { parseSource } from "../src/registry.ts";
import { reasonOf, syncSource, timedGraph } from "../src/sync.ts";
import { stepRetries } from "../src/workflow.ts";
import {
  DELTA,
  DRIVE,
  fakeWorkspace,
  file,
  freshTenant,
  graphMock,
  link,
  page,
  sourceDef,
  storeOf,
} from "./helpers.ts";

const KEY = "test-connector-hmac-key-0123456789abcdef";
const O = "https://connector.internal";
const NOW = 1_700_000_000_000;

async function signedGet(path: string, e: Record<string, unknown> = {}) {
  const headers = await signInternalRequest({
    secret: KEY,
    method: "GET",
    url: `${O}${path}`,
    principal: {
      v: 1,
      iss: "secondary-mcp",
      aud: "secondary-api",
      sub: "u_admin",
      email: "admin@example.invalid",
      client_id: "secondary-api",
      scope: [],
      tool: "ops.stats",
    },
  });
  return createApp().fetch(new Request(`${O}${path}`, { headers }), { ...env, ...e } as Env);
}

/** A clock that moves 40 ms on every read, so call timings are not all zero. */
const ticking = () => {
  let t = NOW;
  return () => {
    t += 40;
    return t;
  };
};

async function setup(over = {}) {
  const tenant = freshTenant();
  const store = storeOf(tenant);
  const src = sourceDef(over);
  await store.putSource(src);
  const g = graphMock();
  const ws = fakeWorkspace();
  const now = ticking();
  return {
    tenant,
    store,
    src,
    g,
    ws,
    run: () => syncSource({ store, graph: g.graph, api: ws.sink, now }, tenant, src.id),
  };
}

describe("recording", () => {
  it("records each Graph call and one attempt per run", async () => {
    const { g, store, src, run } = await setup();
    g.on(DELTA, page([file("A", "n.md", "e1")], { next: link("root/delta?$skiptoken=P") }));
    g.on(link("root/delta?$skiptoken=P"), page([], { delta: link("root/delta?token=T") }));
    g.on("https://download.example.invalid/A", () => new Response("hi"));
    expect((await run()).status).toBe("done");
    const calls = await store.listCalls(src.id, 320);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.outcome === "ok" && c.ms > 0)).toBe(true);
    const attempts = await store.listAttempts(src.id, 0);
    expect(attempts).toEqual([
      expect.objectContaining({ outcome: "ok", reason: null, n: 1, retryAfter: null }),
    ]);
  });

  it("a 429 is an attempt with its Retry-After, then a good run resets the try counter", async () => {
    const { g, store, src, run } = await setup();
    g.on(DELTA, new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    expect((await run()).status).toBe("throttled");
    expect((await run()).status).toBe("throttled");
    g.on(DELTA, page([], { delta: link("root/delta?token=T") }));
    expect((await run()).status).toBe("done");
    const a = await store.listAttempts(src.id, 0);
    expect(a.map((x) => [x.outcome, x.n, x.reason, x.retryAfter])).toEqual([
      ["throttled", 1, "graph_429", 120],
      ["throttled", 2, "graph_429", 120],
      ["ok", 1, null, null],
    ]);
    const calls = await store.listCalls(src.id, 320);
    expect(calls.filter((c) => c.outcome === "429").length).toBeGreaterThanOrEqual(2);
  });

  it("a call that outlives the source timeout is recorded as a timeout and fails the run", async () => {
    const { g, store, src, tenant } = await setup({
      settings: {
        chips: [],
        deltaMinutes: 15,
        retry: { kind: "none" },
        timeoutSeconds: 1,
        aclMaxAgeSeconds: 900,
      },
    });
    g.on(
      DELTA,
      () => new Promise<Response>((r) => setTimeout(() => r(Response.json(page([], {}))), 1_500)),
    );
    const out = await syncSource(
      { store, graph: g.graph, api: fakeWorkspace().sink, now: ticking() },
      tenant,
      src.id,
    );
    expect(out).toMatchObject({ status: "error", error: "graph_timeout" });
    expect((await store.listCalls(src.id, 10)).map((c) => c.outcome)).toEqual(["timeout"]);
    const [a] = await store.listAttempts(src.id, 0);
    expect(a).toMatchObject({ outcome: "timeout", reason: "timeout" });
  });

  it("keeps the last 320 calls and prunes attempts older than 7 days", async () => {
    const { store, src } = await setup();
    for (let i = 0; i < 330; i++) await store.recordCall(src.id, { at: i, ms: i, outcome: "ok" });
    const calls = await store.listCalls(src.id, 1_000);
    expect(calls).toHaveLength(320);
    expect(calls[0]?.ms).toBe(10);
    expect(calls[319]?.ms).toBe(329);
    await store.recordAttempt(src.id, {
      at: NOW - 8 * 86_400_000,
      ms: 1,
      outcome: "ok",
      reason: null,
      retryAfter: null,
    });
    await store.recordAttempt(src.id, {
      at: NOW,
      ms: 1,
      outcome: "ok",
      reason: null,
      retryAfter: null,
    });
    expect(await store.listAttempts(src.id, 0)).toHaveLength(1);
  });

  it("a paused source does not run and keeps its items", async () => {
    const { store, src, run, g, ws } = await setup();
    g.on(DELTA, page([file("A", "n.md", "e1")], { delta: link("root/delta?token=T") }));
    g.on("https://download.example.invalid/A", () => new Response("hi"));
    await run();
    const before = ws.items.size;
    await store.putSource({ ...src, paused: true });
    expect(await run()).toEqual({ status: "skipped", reason: "paused" });
    expect(ws.items.size).toBe(before);
    expect(await store.listAttempts(src.id, 0)).toHaveLength(1);
  });
});

describe("pure helpers", () => {
  it("maps error codes to reasons an operator reads", () => {
    expect(reasonOf("graph_throttled")).toBe("graph_429");
    expect(reasonOf("graph_timeout")).toBe("timeout");
    expect(reasonOf("graph_http_403")).toBe("permission_denied");
    expect(reasonOf("graph_page_without_link")).toBe("parse_error");
  });

  it("turns a retry policy into Workflow step retries", () => {
    expect(stepRetries({ kind: "none" }).limit).toBe(0);
    expect(
      stepRetries({ kind: "exponential", baseSeconds: 5, maxSeconds: 86_400, tries: 8 }),
    ).toEqual({
      limit: 7,
      delay: "5 seconds",
      backoff: "exponential",
    });
    expect(stepRetries({ kind: "linear", everySeconds: 600, tries: 4 })).toEqual({
      limit: 3,
      delay: "600 seconds",
      backoff: "linear",
    });
    expect(stepRetries({ kind: "fixed", times: [10, 60] })).toEqual({
      limit: 2,
      delay: "10 seconds",
      backoff: "constant",
    });
  });

  it("validates source settings and refuses anything out of range", () => {
    const base = {
      provider: "sharepoint_drive",
      driveId: "b!drive1",
      scope: {
        kind: "circle",
        scopeId: "c_bid",
        gateNodeId: "c_bid",
        classification: "internal_confidential",
        ownerRef: "owner_bid_circle",
      },
    };
    const ok = parseSource(
      "srcbid01",
      { ...base, name: "Bid library", settings: { timeoutSeconds: 30 } },
      NOW,
    );
    expect(ok.ok && ok.def.settings?.timeoutSeconds).toBe(30);
    for (const [settings, code] of [
      [{ timeoutSeconds: 0 }, "invalid_timeout"],
      [{ timeoutSeconds: 500 }, "invalid_timeout"],
      [{ deltaMinutes: 1 }, "invalid_schedule"],
      [{ aclMaxAgeSeconds: 5 }, "invalid_acl_max_age"],
      [
        { retry: { kind: "exponential", baseSeconds: 5, maxSeconds: 1, tries: 3 } },
        "invalid_retry",
      ],
      [{ chips: ["a".repeat(80)] }, "invalid_chips"],
    ] as const) {
      const r = parseSource("srcbid01", { ...base, settings }, NOW);
      expect(r).toEqual({ ok: false, error: code });
    }
  });

  it("a timed-out share above 5 percent asks to raise the timeout", () => {
    const pts = [
      ...Array.from({ length: 90 }, () => ({ ms: 300, outcome: "ok" as const })),
      ...Array.from({ length: 10 }, () => ({ ms: 15_000, outcome: "timeout" as const })),
    ];
    const s = latencyStats(pts, 15);
    expect(s).toMatchObject({ n: 100, timedOut: 10, p50Ms: 300, p95Ms: 15_000 });
    expect(s.hint.raiseTimeout).toBe(true);
    expect(s.hint.suggestedSeconds).toBe(20);
    expect(latencyStats(pts.slice(0, 90), 15).hint.raiseTimeout).toBe(false);
  });
});

describe("the ACL max age setting", () => {
  it("a source's own max age decides when a cached answer is too old", async () => {
    const { store, src, tenant } = await setup({
      settings: {
        chips: [],
        deltaMinutes: 15,
        retry: { kind: "none" },
        timeoutSeconds: 15,
        aclMaxAgeSeconds: 60,
      },
    });
    const itemId = await itemKey(src.id, DRIVE, "A");
    await store.putRecord({
      itemId,
      sourceId: src.id,
      kind: "file",
      driveItemId: "A",
      parentId: null,
      name: "a.md",
      mime: null,
      size: 1,
      eTag: "e",
      cTag: null,
      webUrl: null,
      contentSha256: "x",
      hasText: false,
      extractorVersion: "1",
      fetchedAt: NOW,
      aclCheckedAt: NOW,
      aclState: "current",
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      gen: 1,
    });
    const k = await userKey(KEY, "reader@example.invalid");
    await store.putAcl(itemId, k, { allowed: true, checkedAt: NOW - 120_000 });
    const deps = {
      store,
      graph: null,
      now: () => NOW,
      maxAgeSeconds: 900,
      enabled: true,
      userKeySecret: KEY,
    };
    // 120 s old: fresh for the 900 s worker default, stale for this source's 60 s. No Graph: not confirmed.
    expect(
      (await checkAccess(deps, { email: "reader@example.invalid" }, [itemId]))[itemId]?.allowed,
    ).toBe(false);
    await store.putSource({ ...src, settings: { ...src.settings!, aclMaxAgeSeconds: 600 } });
    expect(
      (await checkAccess(deps, { email: "reader@example.invalid" }, [itemId]))[itemId]?.allowed,
    ).toBe(true);
    void tenant;
  });
});

describe("internal stats and summary", () => {
  it("serves the retry plan with the next try, latency points and the ACL strip", async () => {
    const tenant = freshTenant();
    const store = storeOf(tenant);
    const src = sourceDef({
      settings: {
        chips: [],
        deltaMinutes: 15,
        retry: { kind: "exponential", baseSeconds: 5, maxSeconds: 86_400, tries: 8 },
        timeoutSeconds: 15,
        aclMaxAgeSeconds: 900,
      },
    });
    await store.putSource(src);
    const now = Date.now();
    for (const ms of [120, 280, 300, 310, 15_000])
      await store.recordCall(src.id, { at: now, ms, outcome: ms === 15_000 ? "timeout" : "ok" });
    await store.recordAttempt(src.id, {
      at: now - 10_000,
      ms: 900,
      outcome: "throttled",
      reason: "graph_429",
      retryAfter: 40,
    });
    const r = await signedGet(`/internal/sources/${src.id}/stats?tenantId=${tenant}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, any>;
    expect(j.synthetic).toBe(false);
    expect(j.retry.plan.map((p: { afterSeconds: number }) => p.afterSeconds)).toEqual([
      5, 30, 180, 1080, 6480, 38880, 86400,
    ]);
    expect(j.retry.tries).toBe(8);
    // Retry-After 40 s beats the planned 5 s; 10 s have passed.
    expect(j.retry.next).toEqual({ try: 2, inSeconds: 30, last: "429" });
    expect(j.latency).toMatchObject({
      n: 5,
      timedOut: 1,
      timeoutSeconds: 15,
      p50Ms: 300,
      p95Ms: 15_000,
    });
    expect(j.latency.points).toHaveLength(5);
    expect(j.acl).toMatchObject({ total: 0, share: 1, maxAgeSeconds: 900 });
    expect(JSON.stringify(j)).not.toMatch(/https?:|@/);
  });

  it("the summary lists attempts per source and nothing else", async () => {
    const tenant = freshTenant();
    const store = storeOf(tenant);
    const src = sourceDef({ name: "Bid library" });
    await store.putSource(src);
    await store.recordAttempt(src.id, {
      at: 5_000,
      ms: 10,
      outcome: "ok",
      reason: null,
      retryAfter: null,
    });
    const r = await signedGet(`/internal/ops/summary?tenantId=${tenant}&since=1000`);
    expect(await r.json()).toEqual({
      sources: [
        {
          id: src.id,
          name: "Bid library",
          scopeId: "c_bid",
          attempts: [{ at: 5_000, ms: 10, outcome: "ok", reason: null, n: 1, retryAfter: null }],
        },
      ],
    });
  });

  it("the cron leaves out paused sources and sources not due yet", async () => {
    const tenant = freshTenant();
    const store = storeOf(tenant);
    await store.putSource(sourceDef({ id: "srcpaused", paused: true }));
    await store.putSource(sourceDef({ id: "srcdue001" }));
    await store.putSource(
      sourceDef({
        id: "srcslow01",
        settings: {
          chips: [],
          deltaMinutes: 120,
          retry: { kind: "none" },
          timeoutSeconds: 15,
          aclMaxAgeSeconds: 900,
        },
      }),
    );
    await store.setCursor({
      sourceId: "srcslow01",
      deltaLink: "x",
      nextLink: null,
      full: false,
      gen: 1,
      lastSyncAt: Date.now() - 20 * 60_000,
      lastFullAt: Date.now(),
      lastError: null,
    });
    const sent: string[] = [];
    await worker.scheduled?.(
      {} as ScheduledController,
      {
        ...env,
        CONNECTOR_ENABLED: "true",
        CONNECTOR_TENANTS: JSON.stringify([tenant]),
        SYNC_QUEUE: {
          sendBatch: async (b: { body: { sourceId: string } }[]) =>
            void sent.push(...b.map((m) => m.body.sourceId)),
        },
      } as unknown as Env,
    );
    expect(sent).toEqual(["srcdue001"]);
  });
});

// Keep the imports honest: GraphClient and timedGraph are part of the public surface of this module.
void GraphClient;
void timedGraph;
