// v8 security review fixes (docs/security/V8-SECURITY-REVIEW.md): H-1 gap text never crosses brains,
// M-1 no raw person ids in the v8 sidecars (keyed ids, rights export and erase), M-2 capture only
// from POST with a rate limit and a cap one person cannot fill, L-1 review writes are rate limited.

import { beforeAll, describe, expect, it } from "vitest";
import { keyOf } from "../src/v8-keys.ts";
import { ALPHA, as, json, type Loose, seed, testEnv, wsOf } from "./helpers.ts";
import { meId } from "./uxv2-helpers.ts";

const WS = "c_bid";
const ASKER = "v8s.asker@example.invalid";
const SECOND = "v8s.second@example.invalid";
const ADMIN_A = { email: "v8s.admin-a@example.invalid" };
const ADMIN_B = { email: "v8s.admin-b@example.invalid" };
const MIN = 61_000;
const ALL = ["core", "c_bid", "c_sales", "a_acme", "a_andes", "a_cedar", "a_flandre", "a_ibero"];

const ask = (q: string, scope?: string, email = ASKER) =>
  as("head_bid", "/v1/ask", { email, body: { q, ...(scope ? { scope } : {}) } }).then((r) =>
    r.text(),
  );
const kept = async (scope: string): Promise<string> =>
  JSON.stringify(await wsOf(ALPHA, scope).listByKind("v8_gap", 600));
const keptAnywhere = async (word: string): Promise<string[]> =>
  (await Promise.all(ALL.map(async (s) => [s, (await kept(s)).includes(word)] as const)))
    .filter(([, h]) => h)
    .map(([s]) => s);

beforeAll(async () => {
  await seed();
});

describe("H-1 gap text stays where the asker aimed it", () => {
  it("a cross-brain question that names no brain is dropped, never filed in Company Global", async () => {
    await ask("When does the quuxfalcon acquisition of Beta Corp close");
    expect(await keptAnywhere("quuxfalcon")).toEqual([]);
  });

  it("text naming another client never lands in a team brain", async () => {
    await ask("Acme renewal discount quuxacmea", WS);
    await ask("Cedar Mock Corp quuxcedara terms", WS);
    expect(await keptAnywhere("quuxacmea")).toEqual([]);
    expect(await keptAnywhere("quuxcedara")).toEqual([]);
  });

  it("a question scoped to its own client brain is kept there only", async () => {
    await ask("Acme renewal discount quuxacmeb", "a_acme");
    expect(await keptAnywhere("quuxacmeb")).toEqual(["a_acme"]);
  });

  it("a cross-brain question lands only in the client brain it names, not in a team or Global", async () => {
    await ask("Cedar Mock Corp quuxcedarb renewal terms");
    expect(await keptAnywhere("quuxcedarb")).toEqual(["a_cedar"]);
  });

  it("a question naming two clients is kept in neither", async () => {
    await ask("Cedar Mock Corp versus Andes Fictive quuxduo pricing");
    expect(await keptAnywhere("quuxduo")).toEqual([]);
  });

  it("a single-brain question without a client name still lands", async () => {
    await ask("What is our quuxplain method", WS);
    expect(await keptAnywhere("quuxplain")).toEqual([WS]);
  });
});

describe("M-1 no person id in the gap records", () => {
  it("the item is authored by a service actor and holds keyed asker ids only", async () => {
    await ask("What is the quuxkeyed rotation", WS);
    const id = await meId("head_bid", { email: ASKER });
    const rows = await wsOf(ALPHA, WS).listByKind("v8_gap", 600);
    const row = rows.find((r) => (r.body ?? "").includes("quuxkeyed")) as Loose;
    expect(row.authorId).toBe("svc:v8");
    expect(row.body).not.toContain(id);
    const old = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ALPHA}:${WS}:${id}`)),
    );
    const oldHash = [...old]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    const body = JSON.parse(row.body);
    expect(body.askerHashes).toHaveLength(1);
    expect(body.askerHashes[0]).not.toBe(oldHash);
    expect(body.askerHashes[0]).toBe(await keyOf(testEnv(), ALPHA, id, `asker:${WS}`));
  });
});

describe("M-1 review desk state, rights export and erase", () => {
  let proposal = "";
  let aId = "";
  let bId = "";
  const post = (email: string, path: string, body: Loose) =>
    as("head_bid", `/v1/review-desk/${path}`, { email, body });
  const exportReq = (principal: string, who = ADMIN_A) =>
    as("platform_admin", "/v1/admin/rights/export", { ...who, body: { principal } });
  const everything = async (): Promise<string> =>
    (
      await Promise.all(
        [...ALL, "global", "d_bid"].map(async (s) =>
          JSON.stringify(await wsOf(ALPHA, s).exportAll()),
        ),
      )
    ).join("\n");

  beforeAll(async () => {
    const r = await as("head_bid", `/v1/wiki/${WS}/propose`, {
      email: "v8s.author@example.invalid",
      body: { title: "V8s page", markdown: "# V8s page\n\n## Summary\n- A short note.\n" },
    });
    proposal = (await json<Loose>(r)).proposalId;
    aId = await meId("head_bid", { email: ASKER });
    bId = await meId("head_bid", { email: SECOND });
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect((await post(ASKER, `${encodeURIComponent(proposal)}/snooze`, { until })).status).toBe(
      200,
    );
    expect((await post(SECOND, `${encodeURIComponent(proposal)}/snooze`, { until })).status).toBe(
      200,
    );
    const detail = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(proposal)}`, { email: ASKER }),
    );
    const to = (detail.eligible as Loose[]).find((p) => p.id === bId) ?? detail.eligible[0];
    expect(
      (await post(ASKER, `${encodeURIComponent(proposal)}/reassign`, { to: to.id })).status,
    ).toBe(200);
    // The asker of gaps in this brain, for the export.
    await ask("What is the quuxexport rotation", WS, SECOND);
  });

  it("the state item is authored by a service actor and holds no principal id", async () => {
    const row = (await wsOf(ALPHA, WS).listByKind("v8_review", 50)).find(
      (r) => r.id === `rvx:${proposal}`,
    ) as Loose;
    expect(row.authorId).toBe("svc:v8");
    expect(row.body).not.toContain(aId);
    expect(row.body).not.toContain(bId);
    expect(row.body).toContain(await keyOf(testEnv(), ALPHA, aId));
    // The desk still resolves it for the person: A's snooze and the assignment show.
    const d = await json<Loose>(await as("head_bid", "/v1/review-desk", { email: ASKER }));
    expect(d.sections.snoozed.find((x: Loose) => x.id === proposal)).toBeTruthy();
  });

  it("the export of A holds A's own rows and none of B's ids or keys", async () => {
    const first = await exportReq(aId);
    const res = first.status === 202 ? await exportReq(aId, ADMIN_B) : first;
    expect(res.status).toBe(200);
    const text = JSON.stringify(await json<Loose>(res));
    const out = JSON.parse(text);
    const mine = (out.v8Records as Loose[]).flatMap((r) => r.review);
    expect(mine.find((x: Loose) => x.proposalId === proposal)?.snoozedUntil).toBeGreaterThan(0);
    expect(text).not.toContain(bId);
    expect(text).not.toContain(await keyOf(testEnv(), ALPHA, bId));
    expect(text).not.toContain(await keyOf(testEnv(), ALPHA, bId, `asker:${WS}`));
  });

  it("the export of B lists B's own gap question", async () => {
    const first = await exportReq(bId);
    const res = first.status === 202 ? await exportReq(bId, ADMIN_B) : first;
    const out = await json<Loose>(res);
    const gaps = (out.v8Records as Loose[]).flatMap((r) => r.gaps);
    expect(gaps.some((g: Loose) => String(g.text).includes("quuxexport"))).toBe(true);
  });

  it("after erasing A no v8 record holds A's id or keys; B's rows stay", async () => {
    const aKey = await keyOf(testEnv(), ALPHA, aId);
    const aAsker = await keyOf(testEnv(), ALPHA, aId, `asker:${WS}`);
    const bKey = await keyOf(testEnv(), ALPHA, bId);
    const first = await as("platform_admin", "/v1/admin/rights/erase", {
      ...ADMIN_A,
      body: { principal: aId },
    });
    const res =
      first.status === 202
        ? await as("platform_admin", "/v1/admin/rights/erase", {
            ...ADMIN_B,
            body: { principal: aId },
          })
        : first;
    expect(res.status, await res.clone().text()).toBe(200);
    const all = await everything();
    expect(all).not.toContain(aId);
    expect(all).not.toContain(aKey);
    expect(all).not.toContain(aAsker);
    expect(all).toContain(bKey);
  });
});

describe("M-2 capture only from a same-origin POST, rate limited, and a cap one person cannot fill", () => {
  const search = (q: string, o: Loose = {}) =>
    as("head_bid", `/v1/wiki/${WS}/search`, { email: SECOND, body: { q }, ...o });

  it("a GET search or ask leaves no gap", async () => {
    const g = await as("head_bid", `/v1/wiki/${WS}/search?q=quuxgetone%20tolerance`, {
      email: SECOND,
    });
    expect((await json<Loose>(g)).results).toEqual([]);
    await as("head_bid", `/v1/wiki/${WS}/ask?q=quuxgettwo%20tolerance`, { email: SECOND });
    expect(await keptAnywhere("quuxget")).toEqual([]);
  });

  it("a POST search with no result records one; a cross-site POST records none", async () => {
    const ok = await search("quuxpostone tolerance");
    expect(ok.status).toBe(200);
    expect(await keptAnywhere("quuxpostone")).toEqual([WS]);
    const cross = await search("quuxposttwo tolerance", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(cross.status).toBe(403);
    expect(await keptAnywhere("quuxposttwo")).toEqual([]);
  });

  it("the capture limit holds per person per minute", async () => {
    const t = Date.now() + 10 * 86_400_000;
    for (let i = 0; i < 24; i++) await search(`quuxrate${i}word tolerance`, { now: t });
    const stored = new Set((await kept(WS)).match(/quuxrate\d+word/g));
    expect(stored.size).toBe(20);
  });

  it("one person cannot create more than 25 gaps in a brain over time", async () => {
    const solo = "v8s.solo@example.invalid";
    const t = Date.now() + 20 * 86_400_000;
    for (let i = 0; i < 30; i++)
      await as("head_bid", `/v1/wiki/${WS}/search`, {
        email: solo,
        body: { q: `quuxsolo${i}cap tolerance` },
        now: t + i * MIN,
      });
    const stored = new Set((await kept(WS)).match(/quuxsolo\d+cap/g));
    expect(stored.size).toBe(25);
  });

  it("a full brain evicts its lowest-scored open gap instead of dropping the new one", async () => {
    const stub = wsOf(ALPHA, "c_sales");
    const now = Date.now();
    const rec = (i: number, count: number) => ({
      id: `gap:fill${String(i).padStart(4, "0")}`,
      label: "gap",
      kind: "v8_gap",
      plane: "TEAM_RESTRICTED",
      origin: "personal" as const,
      status: "open" as const,
      authorId: "svc:v8",
      body: JSON.stringify({
        text: `fill ${i}`,
        key: `fill${i}`,
        count,
        askerHashes: ["k_x"],
        byRole: {},
        bySource: { ask: count, agent: 0, search: 0 },
        days: {},
        firstAt: now,
        lastAt: now,
        status: "open",
      }),
    });
    for (let i = 0; i < 500; i++) await stub.scratch(rec(i, i === 7 ? 50 : 1), now);
    const who = "v8s.fill@example.invalid";
    const r = await as("acme_lead", "/v1/ask", {
      email: who,
      body: { q: "What is the quuxevict policy", scope: "c_sales" },
    });
    expect(r.status).toBe(200);
    const sse = await r.text();
    const rows = await stub.listByKind("v8_gap", 600);
    expect(rows.length).toBe(500);
    expect(
      rows.some((x) => x.body?.includes("quuxevict")),
      sse.slice(0, 300),
    ).toBe(true);
    expect(rows.some((x) => x.id === "gap:fill0007")).toBe(true);
  });
});

describe("L-1 review writes are rate limited", () => {
  it("the 31st comment in a minute is refused", async () => {
    const r = await as("head_bid", `/v1/wiki/${WS}/propose`, {
      email: "v8s.author2@example.invalid",
      body: { title: "V8s limit", markdown: "# V8s limit\n\n## Summary\n- A note.\n" },
    });
    const id = encodeURIComponent((await json<Loose>(r)).proposalId);
    const t = Date.now() + 30 * 86_400_000;
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (
        await as("head_bid", `/v1/review-desk/${id}/comments`, {
          email: ASKER,
          body: { text: `note ${i}` },
          now: t,
        })
      ).status;
    expect(last).toBe(429);
  });
});
