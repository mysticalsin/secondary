// v7 operate API: Brain activity, own agent calls, Sources, Platform health.
// Scope (manager, steward, admin, the person themself), no page content in any answer, retry that is
// idempotent, audited and manager-only, two-person credential rotation, and numbers that equal an
// independent aggregation of the fixtures.

import { beforeAll, describe, expect, it } from "vitest";
import { aclStrip, latencyStats, type OpRecord } from "../../../packages/contracts/src/ops-v7.ts";
import { synthAcl, synthAttempts, synthCalls } from "../src/v7ops/synthetic.ts";
import { ALPHA, as, json, type Loose, rawEnv, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const HEAD = "v7o.headbid@example.invalid"; // manages c_bid
const CONS = "v7o.consultant@example.invalid"; // reads c_delivery, does not manage it
const ADM1 = "v7o.admin1@example.invalid";
const ADM2 = "v7o.admin2@example.invalid";
const CANARY = "V7OPSCANARY";
const KEY_API = "test-audit-key-api-0123456789abcdef0123";
const KEY_READ = "test-audit-key-read-0123456789abcdef012";

const headbid = (path: string, o: Loose = {}) => as("head_bid", path, { email: HEAD, ...o });
const consultant = (path: string, o: Loose = {}) => as("consultant", path, { email: CONS, ...o });
const admin = (path: string, o: Loose = {}) => as("platform_admin", path, { email: ADM1, ...o });
const admin2 = (path: string, o: Loose = {}) => as("platform_admin", path, { email: ADM2, ...o });
/** Activity tests run at a fixed clock in 2032, so receipts other test files wrote at real time stay out. */
const T = Date.UTC(2032, 5, 1, 12, 0, 0);
const headbidT = (path: string, o: Loose = {}) => headbid(path, { now: T, ...o });
const consultantT = (path: string, o: Loose = {}) => consultant(path, { now: T, ...o });
const getJ = async (r: Response) => json<Loose>(r);

/** A receipt in the audit stand-in, the way the API or MCP worker would have written it. */
async function plant(o: {
  at: number;
  scope: string | null;
  node?: string | null;
  action: string;
  decision?: "allow" | "deny" | "rejected";
  reason?: string;
  principal?: string;
  clientId?: string | null;
  tool?: string | null;
}): Promise<string> {
  const receiptId = `rcpt_${crypto.randomUUID()}`;
  const res = await rawEnv.AUDIT.fetch("https://audit.internal/append", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Audit-Key": KEY_API },
    body: JSON.stringify({
      receiptId,
      at: new Date(o.at).toISOString(),
      tenantId: ALPHA,
      principalId: o.principal ?? "u_planted",
      action: o.action,
      nodeId: o.node === undefined ? o.scope : o.node,
      scopeId: o.scope,
      decision: o.decision ?? "allow",
      reason: o.reason ?? "owner",
      revision: null,
      requestId: null,
      clientId: o.clientId ?? null,
      tool: o.tool ?? null,
    }),
  });
  expect(res.status).toBe(202);
  return receiptId;
}

async function receiptsOf(principal: string): Promise<Loose[]> {
  const res = await rawEnv.AUDIT.fetch(
    `https://audit.internal/receipts?tenant=${ALPHA}&days=30&principal=${encodeURIComponent(principal)}`,
    { headers: { "X-Audit-Key": KEY_READ } },
  );
  return ((await res.json()) as { receipts: Loose[] }).receipts;
}

const idOf = async (persona: string, email: string): Promise<string> =>
  (await json<Loose>(await as(persona, "/v1/me", { email }))).principal.id as string;

beforeAll(async () => {
  await seed();
  await wsOf(ALPHA, "c_bid").wikiTouch(ALPHA, "c_bid", Date.now());
  await wsOf(ALPHA, "c_delivery").wikiTouch(ALPHA, "c_delivery", Date.now());
  await plantPage(
    "c_bid",
    {
      id: "v7-canary",
      type: "topic",
      title: `${CANARY} title`,
      markdown: `# ${CANARY} title\n\n## Summary\n- ${CANARY} body\n`,
    },
    "TEAM_RESTRICTED",
  );
});

describe("GET /v1/brains/:id/activity", () => {
  it("answers the contract shape from receipts, with agents, rules and no content", async () => {
    const now = T;
    const rule = await plant({
      at: now - 20 * 60_000,
      scope: "c_bid",
      action: "wiki.propose",
      decision: "deny",
      reason: `blocked by rule client-name@3 ${CANARY}`,
    });
    await plant({ at: now - 10 * 60_000, scope: "c_bid", action: "wiki.edit" });
    await plant({
      at: now - 8 * 60_000,
      scope: "c_bid",
      action: "propose_page",
      clientId: "client_dust",
      tool: "propose_page",
    });
    await plant({ at: now - 5 * 60_000, scope: "c_delivery", action: "wiki.edit" });
    const res = await headbidT("/v1/brains/c_bid/activity?window=60m");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await getJ(res);
    expect(Object.keys(body).sort()).toEqual(
      [
        "brainId",
        "buckets",
        "callout",
        "events",
        "from",
        "generatedAt",
        "partial",
        "perDot",
        "synthetic",
        "to",
        "totals",
        "window",
      ].sort(),
    );
    expect(body.brainId).toBe("c_bid");
    expect(body.buckets).toHaveLength(60);
    const sum = body.buckets.reduce((n: number, b: Loose) => n + b.total, 0);
    expect(sum).toBe(body.totals.all);
    // The blocked receipt carries its rule; the agent call is labelled; the other brain is absent.
    const blocked = body.events.find((e: Loose) => e.status === "blocked");
    expect(blocked).toMatchObject({
      type: "wiki.propose",
      ruleRef: "client-name@3",
      reason: "blocked_by_rule",
      retryable: false,
    });
    expect(blocked.id).toMatch(/^evt_[0-9a-f]{16}$/);
    const agent = body.events.find((e: Loose) => e.type === "wiki.propose_page");
    expect(agent.source.kind).toBe("agent");
    expect(agent.status).toBe("needs_review");
    expect(body.events.every((e: Loose) => e.at >= body.from)).toBe(true);
    expect(body.callout).toMatchObject({ kind: "blocked", label: "client-name@3" });
    // Filters and search.
    const only = await getJ(await headbidT("/v1/brains/c_bid/activity?window=60m&status=blocked"));
    expect(only.events.every((e: Loose) => e.status === "blocked")).toBe(true);
    expect(only.totals.matching).toBe(only.events.length);
    const q = await getJ(await headbidT("/v1/brains/c_bid/activity?window=60m&q=client-name"));
    expect(q.events.map((e: Loose) => e.id)).toEqual([rule && blocked.id]);
    // A brushed span.
    const brushed = await getJ(
      await headbidT(
        `/v1/brains/c_bid/activity?window=60m&from=${new Date(now - 9 * 60_000).toISOString()}&to=${new Date(now).toISOString()}`,
      ),
    );
    expect(brushed.events.every((e: Loose) => Date.parse(e.at) >= now - 9 * 60_000)).toBe(true);
    expect(brushed.buckets).toHaveLength(60);
    // Content never travels: not in the list and not in a detail.
    const detail = await getJ(await headbidT(`/v1/brains/c_bid/activity/${blocked.id}`));
    expect(detail.steps.map((s: Loose) => s.kind)).toEqual(["policy", "rule", "review"]);
    expect(detail.metadata).toMatchObject({
      ruleId: "client-name",
      ruleVersion: "3",
      decision: "deny",
    });
    for (const text of [JSON.stringify(body), JSON.stringify(detail)])
      expect(text).not.toContain(CANARY);
  });

  it("refuses bad parameters", async () => {
    for (const q of ["window=2h", "status=weird", "q=" + "x".repeat(81), "from=nope"])
      expect((await headbidT(`/v1/brains/c_bid/activity?${q}`)).status).toBe(400);
    expect((await headbidT("/v1/brains/c_bid/activity/not-an-id")).status).toBe(404);
  });

  it("is for the brain's managers: others get 403 or 404, never data", async () => {
    expect((await consultantT("/v1/brains/c_delivery/activity")).status).toBe(403);
    expect((await consultantT("/v1/brains/c_bid/activity")).status).toBe(404);
    expect((await headbidT("/v1/brains/c_delivery/activity")).status).toBe(404);
    expect((await admin("/v1/brains/c_bid/activity")).status).toBe(404);
    // An event of another brain is not found through this brain.
    const other = await plant({
      at: T - 60_000,
      scope: "c_delivery",
      action: "wiki.edit",
    });
    expect(other).toBeTruthy();
    const list = await getJ(await headbidT("/v1/brains/c_bid/activity?window=60m"));
    expect(list.events.every((e: Loose) => !e.id.includes("c_delivery"))).toBe(true);
    expect(list.events.length).toBeGreaterThan(0);
  });
});

describe("retry", () => {
  const SRC = `src:abcdef:${"7".repeat(24)}`;

  it("queues an ingest once: idempotent, audited once, manager only", async () => {
    const now = T;
    await wsOf(ALPHA, "c_bid").wikiLogAppend(
      "svc:wiki:c_bid",
      "ingest.failed",
      { error: "boom", sourceId: SRC },
      now - 4 * 60_000,
    );
    const list = await getJ(await headbidT("/v1/brains/c_bid/activity?window=60m&status=failed"));
    const ev = list.events.find((e: Loose) => e.type === "ingest.run");
    expect(ev).toMatchObject({ status: "failed", retryable: true, reason: "parse_error" });
    const before = await wsOf(ALPHA, "c_bid").wikiJobsPending();

    const first = await headbidT(`/v1/brains/c_bid/activity/${ev.id}/retry`, { method: "POST" });
    expect(first.status).toBe(202);
    const a = await getJ(first);
    expect(a).toMatchObject({ ok: true, kind: "ingest", already: false });
    expect(a.retryId).toMatch(/^rty_/);
    expect(await wsOf(ALPHA, "c_bid").wikiJobsPending()).toBe(before + 1);

    const second = await headbidT(`/v1/brains/c_bid/activity/${ev.id}/retry`, { method: "POST" });
    expect(second.status).toBe(200);
    expect(await getJ(second)).toEqual({
      ok: true,
      retryId: a.retryId,
      kind: "ingest",
      already: true,
    });
    expect(await wsOf(ALPHA, "c_bid").wikiJobsPending()).toBe(before + 1);

    const mine = (await receiptsOf(await idOf("head_bid", HEAD))).filter(
      (r) => r.action === "activity.retry",
    );
    expect(mine.filter((r) => r.reason.includes(ev.id))).toHaveLength(1);
    expect(mine[0]).toMatchObject({ nodeId: "c_bid", scopeId: "c_bid", decision: "allow" });
    const detail = await getJ(await headbidT(`/v1/brains/c_bid/activity/${ev.id}`));
    expect(detail.retry).toEqual({ requestedAt: expect.any(String) });
  });

  it("is manager only and only for failures", async () => {
    await wsOf(ALPHA, "c_delivery").wikiLogAppend(
      "svc:wiki:c_delivery",
      "ingest.failed",
      { error: "boom", sourceId: SRC },
      T - 3 * 60_000,
    );
    // A reader of the brain is not a manager; the retry is refused before anything is looked up.
    const fake = "evt_0000000000000000";
    expect(
      (await consultantT(`/v1/brains/c_delivery/activity/${fake}/retry`, { method: "POST" }))
        .status,
    ).toBe(403);
    expect(
      (await consultantT(`/v1/brains/c_bid/activity/${fake}/retry`, { method: "POST" })).status,
    ).toBe(404);
    // A published receipt cannot be retried.
    await plant({ at: T - 30_000, scope: "c_bid", action: "wiki.edit" });
    const list = await getJ(await headbidT("/v1/brains/c_bid/activity?window=60m"));
    const ok = list.events.find((e: Loose) => e.status === "published");
    const res = await headbidT(`/v1/brains/c_bid/activity/${ok.id}/retry`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await getJ(res)).error).toBe("not_retryable");
  });

  it("a connector failure syncs the source now (once)", async () => {
    // The dev stand-in is in a 429 streak on the first source, which feeds c_bid.
    const list = await getJ(await headbidT("/v1/brains/c_bid/activity?window=24h&status=failed"));
    const ev = list.events.find(
      (e: Loose) => e.type === "connector.sync" && e.status === "retrying",
    );
    expect(ev).toBeTruthy();
    expect(ev.attempts.outcomes.at(-1)).toBe("scheduled");
    expect(ev).toMatchObject({ reason: "graph_429", retryable: true });
    const detail = await getJ(await headbidT(`/v1/brains/c_bid/activity/${ev.id}`));
    expect(detail.steps.at(-1)).toMatchObject({ kind: "attempt", state: "pending" });
    const r1 = await headbidT(`/v1/brains/c_bid/activity/${ev.id}/retry`, { method: "POST" });
    expect(r1.status).toBe(202);
    expect(await getJ(r1)).toMatchObject({ kind: "connector", already: false });
    const r2 = await headbidT(`/v1/brains/c_bid/activity/${ev.id}/retry`, { method: "POST" });
    expect(await getJ(r2)).toMatchObject({ kind: "connector", already: true });
  });
});

describe("GET /v1/agents/activity (the person's own agent calls)", () => {
  it("shows the caller's own calls only, never someone else's, never a non-agent receipt", async () => {
    const me = await idOf("consultant", CONS);
    const other = await idOf("head_bid", HEAD);
    const now = T;
    const mineId = await plant({
      at: now - 120_000,
      scope: "c_delivery",
      action: "propose_page",
      principal: me,
      clientId: "client_a",
      tool: "propose_page",
    });
    await plant({ at: now - 90_000, scope: "c_delivery", action: "wiki.edit", principal: me });
    await plant({
      at: now - 60_000,
      scope: "c_bid",
      action: "propose_page",
      principal: other,
      clientId: "client_b",
      tool: "propose_page",
    });
    const res = await consultantT("/v1/agents/activity?window=60m");
    expect(res.status).toBe(200);
    const body = await getJ(res);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      type: "wiki.propose_page",
      retryable: false,
      source: { kind: "agent" },
    });
    expect(body.totals.all).toBe(1);
    expect(body.hosts).toBeInstanceOf(Array);
    expect(JSON.stringify(body)).not.toContain(other);
    // The other person's event id is not visible to me; mine is, with its steps.
    const theirs = await getJ(await headbidT("/v1/agents/activity?window=60m"));
    expect(theirs.events).toHaveLength(1);
    expect((await consultantT(`/v1/agents/activity/${theirs.events[0].id}`)).status).toBe(404);
    const detail = await getJ(await consultantT(`/v1/agents/activity/${body.events[0].id}`));
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(detail.metadata.receiptId).toBe(mineId);
    expect((await consultantT("/v1/agents/activity?host=nope")).status).toBe(400);
  });
});

describe("Sources", () => {
  it("is for administrators", async () => {
    for (const path of ["/v1/sources", "/v1/sources/src_synth_1", "/v1/sources/src_synth_1/stats"])
      for (const who of [headbid, consultant]) expect((await who(path)).status).toBe(403);
    expect((await headbid("/v1/sources/src_synth_1/run", { method: "POST" })).status).toBe(403);
    expect(
      (await consultant("/v1/sources/src_synth_1", { method: "PUT", body: { status: "paused" } }))
        .status,
    ).toBe(403);
    expect(
      (await headbid("/v1/sources/src_synth_1/credential/rotate", { method: "POST" })).status,
    ).toBe(403);
  });

  it("lists sources and answers a config with names only, never a secret or content", async () => {
    const list = await getJ(await admin("/v1/sources"));
    expect(list.synthetic).toBe(true);
    expect(list.sources.map((s: Loose) => s.id)).toEqual([
      "src_synth_1",
      "src_synth_2",
      "src_synth_3",
    ]);
    expect(list.sources[0]).toMatchObject({
      target: { brainId: "c_bid" },
      status: "active",
      synthetic: true,
    });
    const cfg = await getJ(await admin("/v1/sources/src_synth_1"));
    expect(cfg).toMatchObject({
      id: "src_synth_1",
      provider: "sharepoint_drive",
      retry: { kind: "exponential", baseSeconds: 5, maxSeconds: 86_400, tries: 8 },
      timeoutSeconds: 15,
      aclMaxAgeSeconds: 900,
      schedule: { deltaMinutes: 15 },
      credential: { name: "GRAPH_CLIENT_SECRET", pending: null },
      status: "active",
    });
    expect(cfg.chips.selected).toEqual(["pdf", "docx", "pptx", "/Proposals"]);
    expect(cfg.chips.total).toBe(cfg.chips.available.length);
    // A file record id is still the file route: not a config, and not found here.
    expect((await admin(`/v1/sources/src:abcdef:${"0".repeat(24)}`)).status).toBe(404);
    expect((await admin("/v1/sources/src_nope_1")).status).toBe(404);
    expect(JSON.stringify(cfg)).not.toMatch(/secret_value|password|token/i);
  });

  it("saves a merge, validates every field, audits key names and pauses", async () => {
    const put = (body: Loose) => admin("/v1/sources/src_synth_2", { method: "PUT", body });
    for (const bad of [
      { retry: { kind: "exponential", baseSeconds: 5, maxSeconds: 1, tries: 4 } },
      { retry: { kind: "weird" } },
      { timeoutSeconds: 0 },
      { timeoutSeconds: 500 },
      { aclMaxAgeSeconds: 5 },
      { schedule: { deltaMinutes: 1 } },
      { chips: ["ok", "bad/\u0000"] },
      { status: "gone" },
      { enabled: false },
      {},
    ])
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(400);
    const ok = await put({
      retry: { kind: "linear", everySeconds: 600, tries: 4 },
      timeoutSeconds: 30,
      chips: ["pdf", "docx"],
      schedule: { deltaMinutes: 60 },
    });
    expect(ok.status).toBe(200);
    const cfg = await getJ(await admin("/v1/sources/src_synth_2"));
    expect(cfg).toMatchObject({
      retry: { kind: "linear", everySeconds: 600, tries: 4 },
      timeoutSeconds: 30,
      schedule: { deltaMinutes: 60 },
      aclMaxAgeSeconds: 900,
    });
    expect(cfg.chips.selected).toEqual(["pdf", "docx"]);
    const receipts = (await receiptsOf(await idOf("platform_admin", ADM1))).filter(
      (r) => r.action === "source.config",
    );
    expect(receipts[0].reason).toBe("source=src_synth_2 keys=chips,retry,schedule,timeoutSeconds");
    // Pause: run now is refused, resume: queued.
    expect((await put({ status: "paused" })).status).toBe(200);
    expect((await admin("/v1/sources/src_synth_2/run", { method: "POST" })).status).toBe(409);
    expect((await getJ(await admin("/v1/sources"))).sources[1].nextRunInSeconds).toBeNull();
    expect((await put({ status: "active" })).status).toBe(200);
    expect((await admin("/v1/sources/src_synth_2/run", { method: "POST" })).status).toBe(202);
    // Back to the default interval: later tests count the stand-in's runs.
    expect((await put({ schedule: { deltaMinutes: 15 } })).status).toBe(200);
  });

  it("rotates a credential only with two different people, and never shows a value", async () => {
    const path = "/v1/sources/src_synth_3/credential/rotate";
    const first = await admin(path, { method: "POST" });
    expect(first.status).toBe(202);
    expect(await getJ(first)).toEqual({
      status: "pending",
      needs: "second_person",
      name: "GRAPH_CLIENT_SECRET",
    });
    expect((await getJ(await admin("/v1/sources/src_synth_3"))).credential.pending).toEqual({
      requestedAt: expect.any(String),
    });
    // The same person again stays pending.
    const same = await admin(path, { method: "POST" });
    expect(same.status).toBe(202);
    expect((await getJ(same)).status).toBe("pending");
    expect((await getJ(await admin("/v1/sources/src_synth_3"))).credential.rotatedAt).toBeNull();
    // A second administrator completes it.
    const second = await admin2(path, { method: "POST" });
    expect(second.status).toBe(200);
    const done = await getJ(second);
    expect(done).toMatchObject({ status: "rotated", name: "GRAPH_CLIENT_SECRET" });
    expect(Object.keys(done).sort()).toEqual(["name", "rotatedAt", "status"]);
    const cfg = await getJ(await admin("/v1/sources/src_synth_3"));
    expect(cfg.credential).toEqual({
      name: "GRAPH_CLIENT_SECRET",
      rotatedAt: done.rotatedAt,
      pending: null,
    });
    const actions = [
      ...(await receiptsOf(await idOf("platform_admin", ADM1))),
      ...(await receiptsOf(await idOf("platform_admin", ADM2))),
    ].filter((r) => r.action.startsWith("source.rotate"));
    expect(actions.map((r) => r.action).sort()).toEqual(["source.rotate", "source.rotate_request"]);
    for (const r of actions) expect(r.reason).toBe("source=src_synth_3 secret=GRAPH_CLIENT_SECRET");
    // A new rotation needs two people again.
    expect((await getJ(await admin(path, { method: "POST" }))).status).toBe("pending");
  });

  it("stats equal the fixtures: retry plan, p50 and p95, timed-out share, ACL strip", async () => {
    const now = Date.UTC(2031, 2, 1, 12, 0, 0);
    const stats = await getJ(await admin("/v1/sources/src_synth_1/stats?window=24h", { now }));
    expect(stats.synthetic).toBe(true);
    expect(stats.retry.plan.map((p: Loose) => p.afterSeconds)).toEqual([
      5, 30, 180, 1080, 6480, 38880, 86400,
    ]);
    expect(stats.retry).toMatchObject({ tries: 8, totalSeconds: 133_055, honoursRetryAfter: true });
    const points = synthCalls(ALPHA, "src_synth_1", 15);
    expect(stats.latency.points).toEqual(points);
    const want = latencyStats(points, 15);
    expect(stats.latency).toMatchObject({
      n: 320,
      p50Ms: want.p50Ms,
      p95Ms: want.p95Ms,
      timedOut: want.timedOut,
      timedOutShare: want.timedOutShare,
      hint: want.hint,
    });
    expect(want.timedOutShare).toBeGreaterThan(0.05);
    expect(stats.latency.hint.raiseTimeout).toBe(true);
    expect(stats.acl).toEqual(aclStrip(synthAcl(ALPHA, "src_synth_1", now), 900, now));
    // The live 429 streak: next try follows the plan and the Retry-After.
    expect(stats.retry.next).toMatchObject({ last: "429" });
    expect(stats.retry.next.try).toBeGreaterThanOrEqual(2);
    // Raising the timeout is what the hint asks: the timed-out share drops to zero.
    expect(
      (await admin("/v1/sources/src_synth_1", { method: "PUT", body: { timeoutSeconds: 30 } }))
        .status,
    ).toBe(200);
    const after = await getJ(await admin("/v1/sources/src_synth_1/stats", { now }));
    expect(after.latency.timedOut).toBe(0);
    expect(after.latency.hint.raiseTimeout).toBe(false);
    expect((await admin("/v1/sources/src_synth_1/stats?window=1h")).status).toBe(400);
    await admin("/v1/sources/src_synth_1", { method: "PUT", body: { timeoutSeconds: 15 } });
  });
});

describe("GET /v1/ops/health (and /v1/health stays liveness)", () => {
  const NOW = Date.UTC(2031, 0, 1, 12, 30, 0);
  const H11 = Date.UTC(2031, 0, 1, 11, 0, 0);

  it("answers the liveness probe without a window, and the health with one", async () => {
    expect((await as("consultant", "/v1/health", { email: CONS })).status).toBe(200);
    expect(
      await getJ(await as("consultant", "/v1/health", { email: CONS, token: null })),
    ).toMatchObject({ ok: true });
    // `/v1/health` is liveness whatever the query says; it never turns into Platform health.
    expect(
      await getJ(await as("consultant", "/v1/health?window=24h", { email: CONS, token: null })),
    ).toEqual({ ok: true, env: expect.any(String), version: expect.any(String) });
    expect((await as("consultant", "/v1/ops/health?window=24h", { token: null })).status).toBe(401);
    expect((await as("consultant", "/v1/ops/health?window=9d", { email: CONS })).status).toBe(400);
    expect((await consultant("/v1/ops/health?window=24h")).status).toBe(403);
  });

  it("success, outcomes, failures and the heatmap equal an aggregation of the fixtures", async () => {
    // c_bid at 11:xx: 10 operations, 3 blocked by a rule; two of them again in the next hour. c_delivery: 4 fine.
    const at = (m: number) => H11 + m * 60_000;
    for (let i = 0; i < 7; i++) await plant({ at: at(i), scope: "c_bid", action: "wiki.edit" });
    for (let i = 0; i < 3; i++)
      await plant({
        at: at(10 + i),
        scope: "c_bid",
        action: "wiki.propose",
        decision: "deny",
        reason: "blocked by rule client-name@3",
      });
    for (let i = 0; i < 4; i++)
      await plant({ at: at(20 + i), scope: "c_delivery", action: "wiki.edit" });
    await plant({
      at: at(75),
      scope: "c_bid",
      action: "wiki.propose",
      decision: "deny",
      reason: "denied",
    });
    await wsOf(ALPHA, "c_bid").wikiLogAppend(
      "svc:wiki:c_bid",
      "ingest.triage",
      { sourceId: "x", result: `${CANARY} unchanged` },
      at(80),
    );
    await wsOf(ALPHA, "c_bid").wikiLogAppend(
      "svc:wiki:c_bid",
      "ingest.failed",
      { error: "boom", sourceId: "x" },
      at(81),
    );
    const env = { OPS_SYNTHETIC: "off" };
    const res = await admin("/v1/ops/health?window=24h", { now: NOW, env });
    expect(res.status).toBe(200);
    const body = await getJ(res);
    expect(body).toMatchObject({ window: "24h", scope: "tenant", synthetic: false, slo: 0.99 });
    // 7 + 3 + 4 + 1 receipts, 1 log triage (delivered), 1 log failure.
    expect(body.totals).toEqual({ attempts: 17, delivered: 12, failed: 5 });
    expect(body.success).toEqual({ attempts: 17, delivered: 12, failed: 5, rate: 12 / 17 });
    expect(body.outcomes).toEqual({ firstTry: 12, recovered: 0, failing: 5 });
    expect(body.outcomes.firstTry + body.outcomes.recovered + body.outcomes.failing).toBe(
      body.totals.attempts,
    );
    expect(body.failures).toEqual([
      { reason: "blocked_by_rule", count: 3, share: 3 / 5 },
      { reason: "permission_denied", count: 1, share: 1 / 5 },
      { reason: "parse_error", count: 1, share: 1 / 5 },
    ]);
    expect(body.heatmap.columnMs).toBe(3_600_000);
    expect(body.heatmap.columns).toHaveLength(24);
    const col = (ms: number) => body.heatmap.columns.indexOf(new Date(ms).toISOString());
    const bid = body.heatmap.rows.find((r: Loose) => r.id === "c_bid");
    expect(bid).toMatchObject({ kind: "brain", total: 13, failed: 5 });
    expect(bid.cells[col(H11)]).toEqual({
      attempts: 10,
      delivered: 7,
      failed: 3,
      failing: true,
      topReason: "blocked_by_rule",
      ruleRef: "client-name@3",
    });
    const next = bid.cells[col(H11 + 3_600_000)];
    expect(next).toMatchObject({ attempts: 3, failed: 2, failing: true });
    expect(bid.cells.reduce((n: number, c: Loose) => n + c.attempts, 0)).toBe(bid.total);
    expect(body.heatmap.rows.find((r: Loose) => r.id === "c_delivery")).toMatchObject({
      total: 4,
      failed: 0,
    });
    for (const row of body.heatmap.rows) expect(row.cells).toHaveLength(24);
    // The canary never travels, and a verdict outside the two known codes is not echoed.
    expect(JSON.stringify(body)).not.toContain(CANARY);

    // 1h: 5-minute columns, only the last hour. 7d: the same totals in 6-hour columns.
    const hour = await getJ(
      await admin("/v1/ops/health?window=1h", { now: H11 + 25 * 60_000 + 1000, env }),
    );
    expect(hour.heatmap.columns).toHaveLength(12);
    expect(hour.totals.attempts).toBe(14);
    const week = await getJ(await admin("/v1/ops/health?window=7d", { now: NOW, env }));
    expect(week.heatmap.columns).toHaveLength(28);
    expect(week.totals).toEqual(body.totals);
  });

  it("a steward sees only their brains; an admin sees the tenant", async () => {
    const env = { OPS_SYNTHETIC: "off" };
    const steward = await getJ(await headbid("/v1/ops/health?window=24h", { now: NOW, env }));
    expect(steward.scope).toBe("stewards");
    expect(steward.heatmap.rows.map((r: Loose) => r.id)).toEqual(["c_bid"]);
    expect(steward.totals).toEqual({ attempts: 13, delivered: 8, failed: 5 });
    expect(JSON.stringify(steward)).not.toContain("c_delivery");
    const tenant = await getJ(await admin("/v1/ops/health?window=24h", { now: NOW, env }));
    expect(tenant.heatmap.rows.map((r: Loose) => r.id).sort()).toEqual(["c_bid", "c_delivery"]);
    expect(tenant.totals.attempts).toBeGreaterThan(steward.totals.attempts);
    // Someone who manages nothing sees nothing.
    expect((await consultant("/v1/ops/health?window=24h", { now: NOW, env })).status).toBe(403);
  });

  it("with the dev stand-in, the numbers equal an independent count of its attempts", async () => {
    const now = Date.UTC(2031, 3, 1, 12, 0, 0);
    const body = await getJ(await admin("/v1/ops/health?window=24h", { now }));
    expect(body.synthetic).toBe(true);
    // Independent count: one event per success (first try when it was the first run of a streak,
    // recovered otherwise) and one for a streak still going at the end.
    let first = 0;
    let recovered = 0;
    let failing = 0;
    for (const [i] of [0, 1, 2].entries()) {
      const rows = synthAttempts(ALPHA, i, `src_synth_${i + 1}`, 15, now).filter(
        (a) => a.at >= now - 86_400_000,
      );
      let streak = 0;
      for (const a of rows) {
        if (a.outcome !== "ok") streak++;
        else {
          if (streak > 0) recovered++;
          else first++;
          streak = 0;
        }
      }
      if (streak > 0) failing++;
    }
    expect(body.outcomes.failing).toBeGreaterThanOrEqual(failing);
    expect(body.outcomes.recovered).toBeGreaterThanOrEqual(recovered);
    // Nothing else writes in 2031: the stand-in is the only source of these records.
    expect(body.outcomes).toEqual({ firstTry: first, recovered, failing });
    expect(body.totals.attempts).toBe(first + recovered + failing);
    const sourceRows = body.heatmap.rows.filter((r: Loose) => r.kind === "source");
    expect(sourceRows.map((r: Loose) => r.id).sort()).toEqual([
      "src_synth_1",
      "src_synth_2",
      "src_synth_3",
    ]);
    const live = body.heatmap.rows.find((r: Loose) => r.id === "src_synth_1");
    expect(live.failed).toBe(1);
    expect(body.failures[0].reason).toBe("graph_429");
  });
});

// Keep the type import honest for readers of the aggregation above.
export type { OpRecord };
