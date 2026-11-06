// The web dev mock for v7 operate (apps/web/src/mock/v7ops.ts) must answer in the shapes the real API
// does. For each endpoint the same call is made against both; every field the mock emits must exist on
// the real answer with the same JSON type (the real answer may carry more).

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, rawEnv, seed, wsOf } from "./helpers.ts";

type Mock = {
  handleV7Ops(method: string, p: string, q: URLSearchParams, body: Loose, role: string): unknown;
};
const MOCK_PATH = `/@fs${new URL("../../../apps/web/src/mock/v7ops.ts", import.meta.url).pathname}`;
let web: Mock;
const T = Date.UTC(2033, 5, 1, 12, 0, 0);
const HEAD = "v7m.headbid@example.invalid";
const KEY_API = "test-audit-key-api-0123456789abcdef0123";

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function drift(mock: Loose, real: Loose[], path = "$"): string[] {
  const out: string[] = [];
  const samples = real.filter((r) => r !== null && r !== undefined);
  if (mock === null || mock === undefined || !samples.length) return out;
  const t = typeOf(mock);
  if (samples.some((r) => typeOf(r) !== t)) {
    out.push(`${path}: mock is ${t}, real is ${[...new Set(samples.map(typeOf))].join("|")}`);
    return out;
  }
  if (t === "array") {
    for (const el of mock as Loose[]) out.push(...drift(el, samples.flat(), `${path}[]`));
  } else if (t === "object") {
    for (const [k, v] of Object.entries(mock as Loose)) {
      const there = samples.filter((r) => k in r).map((r) => r[k]);
      if (!there.length) out.push(`${path}.${k}: mock only`);
      else out.push(...drift(v, there, `${path}.${k}`));
    }
  }
  return out;
}

const mock = (method: string, path: string, role: string, body: Loose = {}) =>
  JSON.parse(
    JSON.stringify(
      web.handleV7Ops(
        method,
        path.split("?")[0] as string,
        new URLSearchParams(path.split("?")[1] ?? ""),
        body,
        role,
      ),
    ),
  ) as Loose;
const pathOf = (p: string) => p.split("?")[0] as string;

async function plant(o: Loose) {
  await rawEnv.AUDIT.fetch("https://audit.internal/append", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Audit-Key": KEY_API },
    body: JSON.stringify({
      receiptId: `rcpt_${crypto.randomUUID()}`,
      tenantId: ALPHA,
      principalId: "u_planted",
      nodeId: o.scope,
      revision: null,
      requestId: null,
      clientId: null,
      tool: null,
      reason: "owner",
      decision: "allow",
      ...o,
      scopeId: o.scope,
    }),
  });
}

beforeAll(async () => {
  web = (await import(/* @vite-ignore */ MOCK_PATH)) as Mock;
  await seed();
  await wsOf(ALPHA, "c_bid").wikiTouch(ALPHA, "c_bid", T);
  const at = (m: number) => new Date(T - m * 60_000).toISOString();
  await plant({ at: at(5), scope: "c_bid", action: "wiki.edit" });
  await plant({
    at: at(6),
    scope: "c_bid",
    action: "wiki.propose",
    decision: "deny",
    reason: "blocked by rule client-name@3",
  });
  await plant({
    at: at(7),
    scope: "c_bid",
    action: "propose_page",
    clientId: "client_x",
    tool: "propose_page",
  });
  await wsOf(ALPHA, "c_bid").wikiLogAppend(
    "svc:wiki:c_bid",
    "ingest.failed",
    { error: "x", sourceId: "s" },
    T - 8 * 60_000,
  );
});

const head = (p: string, o: Loose = {}) => as("head_bid", p, { email: HEAD, now: T, ...o });
const admin = (p: string, o: Loose = {}) =>
  as("platform_admin", p, { email: "v7m.admin@example.invalid", now: T, ...o });

describe("web mock and real API agree on v7 operate", () => {
  it("brain activity list and detail", async () => {
    const p = "/v1/brains/c_bid/activity?window=60m";
    const real = await json<Loose>(await head(p));
    expect(real.events.length).toBeGreaterThan(2);
    expect(drift(mock("GET", p, "head_bid"), [real])).toEqual([]);
    const m = mock("GET", p, "head_bid");
    const detailMock = mock("GET", `/v1/brains/c_bid/activity/${m.events[0].id}`, "head_bid");
    const detailReal = await Promise.all(
      real.events.map(async (e: Loose) =>
        json<Loose>(await head(`/v1/brains/c_bid/activity/${e.id}`)),
      ),
    );
    // `metadata` holds whichever optional ids an event has (receipt, source, job, verdict): only its type is fixed.
    const bare = (d: Loose) => ({ ...d, metadata: {} });
    expect(typeOf(detailMock.metadata)).toBe("object");
    expect(drift(bare(detailMock), detailReal.map(bare))).toEqual([]);
  });

  it("the person's own agent calls", async () => {
    const real = await json<Loose>(await head("/v1/agents/activity?window=60m"));
    const fake = mock("GET", "/v1/agents/activity?window=60m", "head_bid");
    // The real list is empty for this person; compare the shape against the brain list's events instead.
    const brain = await json<Loose>(await head("/v1/brains/c_bid/activity?window=60m"));
    expect(drift({ ...fake, events: [] }, [real])).toEqual([]);
    expect(drift(fake.events[0], brain.events)).toEqual([]);
  });

  it("sources, a config and its stats", async () => {
    const list = await json<Loose>(await admin("/v1/sources"));
    expect(drift(mock("GET", "/v1/sources", "platform_admin"), [list])).toEqual([]);
    const cfg = await json<Loose>(await admin("/v1/sources/src_synth_1"));
    const fakeList = mock("GET", "/v1/sources", "platform_admin");
    const fakeCfg = mock("GET", `/v1/sources/${fakeList.sources[0].id}`, "platform_admin");
    expect(drift(fakeCfg, [cfg])).toEqual([]);
    const stats = await json<Loose>(await admin("/v1/sources/src_synth_1/stats?window=24h"));
    const fakeStats = mock(
      "GET",
      `/v1/sources/${fakeList.sources[0].id}/stats?window=24h`,
      "platform_admin",
    );
    expect(drift(fakeStats, [stats])).toEqual([]);
  });

  it("platform health", async () => {
    for (const [who, role] of [
      [admin, "platform_admin"],
      [head, "head_bid"],
    ] as const) {
      const real = await json<Loose>(await who("/v1/health?window=24h"));
      expect(drift(mock("GET", "/v1/health?window=24h", role), [real])).toEqual([]);
    }
  });

  it("the two-person rotation and the retry answer alike", async () => {
    const ev = (
      await json<Loose>(await head("/v1/brains/c_bid/activity?window=60m&status=failed"))
    ).events.find((e: Loose) => e.retryable);
    const real = await json<Loose>(
      await head(`/v1/brains/c_bid/activity/${ev.id}/retry`, { method: "POST" }),
    );
    const mocked = mock(
      "GET",
      "/v1/brains/c_bid/activity?window=60m&status=failed",
      "head_bid",
    ).events.find((e: Loose) => e.retryable);
    const fake = mock("POST", `/v1/brains/c_bid/activity/${mocked.id}/retry`, "head_bid");
    expect(drift(fake, [real])).toEqual([]);
    const rot = await json<Loose>(
      await admin("/v1/sources/src_synth_3/credential/rotate", { method: "POST" }),
    );
    const fakeId = mock("GET", "/v1/sources", "platform_admin").sources[2].id;
    const fakeRot = mock("POST", `/v1/sources/${fakeId}/credential/rotate`, "platform_admin");
    expect(drift(fakeRot, [rot])).toEqual([]);
    expect(pathOf("/x?y")).toBe("/x");
  });
});
