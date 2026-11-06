// v8 Knowledge gaps: signals from unknown answers and empty searches, what is stored and what never
// is, ranking and merging, assign with a due date, start page (a draft in review), dismiss, closure
// rate, and the Home top gaps.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, rawEnv, seed, seenOf, wsOf } from "./helpers.ts";
import { meId, sseOf } from "./uxv2-helpers.ts";

const STEWARD = "v8g.steward@example.invalid";
const OTHER = "v8g.other@example.invalid";
const WS = "c_bid";
const DAYMS = 86_400_000;

const ask = async (persona: string, email: string, q: string, scope?: string) =>
  sseOf(await as(persona, "/v1/ask", { email, body: { q, ...(scope ? { scope } : {}) } }));
const gaps = async (email = STEWARD, query = "", persona = "head_bid") =>
  json<Loose>(await as(persona, `/v1/brains/${WS}/gaps${query}`, { email }));
const findGap = async (text: string, query = "") =>
  ((await gaps(STEWARD, query)).gaps as Loose[]).find((g) => g.text.toLowerCase().includes(text));
const act = (path: string, body: Loose, email = STEWARD, persona = "head_bid") =>
  as(persona, `/v1/brains/${WS}/gaps/${path}`, { email, body });
const receipts = async (email: string): Promise<Loose[]> => {
  const id = await meId("head_bid", { email });
  return (await json<Loose>(await as("auditor", `/v1/audit/receipts?principal=${id}`))).receipts;
};
/** Everything stored as a gap in a workspace, read straight from the object. */
const stored = async (scope: string): Promise<string> =>
  JSON.stringify(await wsOf(ALPHA, scope).listByKind("v8_gap", 500));

beforeAll(async () => {
  await seed();
});

describe("signals", () => {
  it("an Ask that ends in unknown adds a gap, and the same question again counts", async () => {
    await ask("head_bid", STEWARD, "What is our zorblat protocol?", WS);
    await ask("head_bid", OTHER, "zorblat protocol", WS);
    await ask("head_bid", STEWARD, "How is the zorblat protocol applied", WS);
    const g = await findGap("zorblat");
    expect(g).toBeTruthy();
    // The first two are one gap (same words once filler is gone), asked by two people.
    expect(g.count).toBeGreaterThanOrEqual(2);
    expect(g.askers).toBe(2);
    expect(g.status).toBe("open");
    expect(g.bySource.ask).toBe(g.count);
    expect(Object.values(g.byRole as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
      g.count,
    );
    expect(g.days).toHaveLength(14);
    expect(g.days[13].count).toBe(g.count);
  });

  it("a search with no result is a gap too, from its own source", async () => {
    const r = await as("head_bid", `/v1/wiki/${WS}/search`, {
      email: STEWARD,
      body: { q: "quuxflange tolerance" },
    });
    expect((await json<Loose>(r)).results).toEqual([]);
    const g = await findGap("quuxflange");
    expect(g.bySource.search).toBe(1);
  });

  it("an answered question is not a gap", async () => {
    const r = await as("head_bid", `/v1/wiki/${WS}/search?q=bid`, { email: STEWARD });
    const n = ((await json<Loose>(r)).results as Loose[]).length;
    if (n > 0) expect(await findGap("bid")).toBeUndefined();
  });

  it("text with personal data is dropped whole: no record, no count", async () => {
    const before = await stored(WS);
    for (const q of [
      "Why was jane.doe@example.invalid refused quuxsalary access",
      "Call +1 514 555 0199 about quuxphone pricing",
      "my sick leave quuxhealth process",
      "salary bands quuxhr consultants",
    ])
      await ask("head_bid", STEWARD, q, WS);
    const after = await stored(WS);
    expect(after).toBe(before);
    for (const w of ["quuxsalary", "quuxphone", "quuxhealth", "quuxhr", "jane.doe", "555"])
      expect(after).not.toContain(w);
  });

  it("never stores text for a brain the asker cannot read, scoped or not", async () => {
    const cons = "v8g.cons@example.invalid";
    // Scoped to a brain the consultant cannot open: not found, nothing stored.
    const scoped = await as("consultant", "/v1/ask", {
      email: cons,
      body: { q: "snarfblat rotation plan", scope: WS },
    });
    expect(scoped.status).toBe(404);
    // Unscoped: only the brains the consultant can open are searched, so c_bid never hears of it.
    await ask("consultant", cons, "snarfblat rotation plan");
    expect(await stored(WS)).not.toContain("snarfblat");
    // And a scoped ask on c_bid never leaks to Company Global or another brain the asker can read.
    expect(await stored("core")).not.toContain("zorblat");
  });

  it("the Personal Brain never holds a signal", async () => {
    const id = await meId("head_bid", { email: STEWARD });
    await ask("head_bid", STEWARD, "wibblesnort handling procedure", "me");
    expect(await stored(`personal:${id}`)).not.toContain("wibblesnort");
    expect(JSON.stringify(await wsOf(ALPHA, `personal:${id}`).listByKind("v8_gap", 10))).toBe("[]");
  });

  it("a broad question is never filed in a team brain or Company Global, even when its words fit", async () => {
    // Unscoped, mentions the brain's own collection words: "bid". Only a question scoped to a brain, or
    // one naming a client, is stored (H-1; the cases are in v8-security.test.ts).
    await ask("head_bid", STEWARD, "bid blorptastic evaluation grid");
    for (const s of [WS, "core", "c_sales"]) expect(await stored(s)).not.toContain("blorptastic");
  });
});

describe("the Gaps tab API", () => {
  it("needs the contribute right and hides the brain from people who cannot open it", async () => {
    expect(
      (await as("consultant", `/v1/brains/${WS}/gaps`, { email: "v8g.cons@example.invalid" }))
        .status,
    ).toBe(404);
    expect((await as("head_bid", "/v1/brains/me/gaps", { email: STEWARD })).status).toBe(404);
    expect(
      (await as("head_bid", `/v1/brains/${WS}/gaps?status=nope`, { email: STEWARD })).status,
    ).toBe(400);
  });

  it("ranks by frequency and recency, and carries the steward KPI", async () => {
    for (let i = 0; i < 3; i++)
      await ask(
        "head_bid",
        `v8g.rank${i}@example.invalid`,
        "gribblefrotz onboarding checklist",
        WS,
      );
    const d = await gaps();
    const rows = d.gaps as Loose[];
    const scores = rows.map((g) => g.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(rows[0].text.toLowerCase()).toContain("gribblefrotz");
    expect(d.canSteward).toBe(true);
    expect(d.kpi).toMatchObject({ windowDays: 90, closed: 0 });
    expect(d.kpi.closureRate).toBe(0);
    expect(Array.isArray(d.eligible)).toBe(true);
  });
});

describe("assign, merge, dismiss", () => {
  it("assign goes to an eligible contributor with a valid due date, and is audited", async () => {
    const g = (await findGap("zorblat")) as Loose;
    const eligible = (await gaps()).eligible as Loose[];
    expect(eligible.length).toBeGreaterThan(0);
    const due = new Date(Date.now() + 7 * DAYMS).toISOString().slice(0, 10);
    const path = `${encodeURIComponent(g.id)}/assign`;
    expect((await act(path, { to: "u_consultant", due })).status).toBe(403);
    for (const bad of [
      "yesterday",
      "2020-01-01",
      new Date(Date.now() + 400 * DAYMS).toISOString().slice(0, 10),
      5,
    ])
      expect((await act(path, { to: eligible[0].id, due: bad })).status, String(bad)).toBe(400);
    const ok = await act(path, { to: eligible[0].id, due });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const after = (await findGap("zorblat")) as Loose;
    expect(after).toMatchObject({ status: "assigned", due, assignedTo: { id: eligible[0].id } });
    expect((await receipts(STEWARD)).map((x) => x.action)).toContain("gap.assign");
  });

  it("only a steward assigns, merges or dismisses", async () => {
    const g = (await findGap("zorblat")) as Loose;
    const ceo = (path: string, body: Loose) =>
      as("ceo", `/v1/brains/${WS}/gaps${path}`, { email: "v8g.ceo@example.invalid", body });
    // The CEO contributes in the bid circle and may read the tab, but stewards nothing here.
    const view = await json<Loose>(
      await as("ceo", `/v1/brains/${WS}/gaps`, { email: "v8g.ceo@example.invalid" }),
    );
    expect(view.canSteward).toBe(false);
    expect(view.eligible).toEqual([]);
    const id = encodeURIComponent(g.id);
    expect((await ceo(`/${id}/dismiss`, { reason: "other" })).status).toBe(403);
    expect((await ceo(`/${id}/merge`, { into: g.id })).status).toBe(403);
    expect((await ceo(`/${id}/assign`, { to: "u_head_bid", due: "2099-01-01" })).status).toBe(403);
    // A reviewer without the contribute right cannot open the tab at all.
    expect(
      (await as("reviewer", `/v1/brains/${WS}/gaps`, { email: "v8g.rev@example.invalid" })).status,
    ).toBe(403);
  });

  it("merge folds counts, askers and days into the target and later asks follow it", async () => {
    await ask("head_bid", STEWARD, "frumptious scoring rubric", WS);
    await ask("head_bid", OTHER, "rubric for scoring frumptious bids", WS);
    const a = (await findGap("frumptious scoring")) as Loose;
    const b = (await findGap("rubric for scoring")) as Loose;
    expect(a && b && a.id !== b.id).toBeTruthy();
    const total = a.count + b.count;
    const r = await act(`${encodeURIComponent(b.id)}/merge`, { into: a.id });
    expect(r.status, await r.clone().text()).toBe(200);
    const merged = (await json<Loose>(r)).gap;
    expect(merged).toMatchObject({ count: total, mergedFrom: 1 });
    expect(await findGap("rubric for scoring")).toBeUndefined();
    // The source keeps only its pointer; asking it again counts into the target.
    await ask("head_bid", STEWARD, "rubric for scoring frumptious bids", WS);
    expect(((await findGap("frumptious scoring")) as Loose).count).toBe(total + 1);
    expect((await act(`${encodeURIComponent(a.id)}/merge`, { into: a.id })).status).toBe(400);
    expect(
      (await act(`${encodeURIComponent(a.id)}/merge`, { into: "gap:0000000000000000" })).status,
    ).toBe(404);
    expect((await receipts(STEWARD)).map((x) => x.action)).toContain("gap.merge");
  });

  it("dismiss needs a reason, keeps no personal data in its note, and hides the gap from the active list", async () => {
    await ask("head_bid", STEWARD, "plonkering retention cadence", WS);
    const g = (await findGap("plonkering")) as Loose;
    const path = `${encodeURIComponent(g.id)}/dismiss`;
    expect((await act(path, {})).status).toBe(400);
    expect((await act(path, { reason: "because" })).status).toBe(400);
    expect((await act(path, { reason: "other", note: "ask jane@example.invalid" })).status).toBe(
      400,
    );
    const ok = await act(path, { reason: "out_of_scope", note: "Belongs to Delivery" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await findGap("plonkering")).toBeUndefined();
    expect(((await findGap("plonkering", "?status=dismissed")) as Loose).status).toBe("dismissed");
    expect(((await findGap("plonkering", "?status=dismissed")) as Loose).dismissedReason).toBe(
      "out_of_scope",
    );
    expect((await receipts(STEWARD)).map((x) => x.action)).toContain("gap.dismiss");
  });
});

describe("start page", () => {
  it("creates a draft in review with the title filled in, and closes the gap when it is published", async () => {
    await ask("head_bid", STEWARD, "how do we price a wombatic frame agreement?", WS);
    const g = (await findGap("wombatic")) as Loose;
    const path = `${encodeURIComponent(g.id)}/start`;
    const started = await act(path, {});
    expect(started.status, await started.clone().text()).toBe(201);
    const s = await json<Loose>(started);
    expect(s.title).toBe("How do we price a wombatic frame agreement");
    expect(s.status).toBe("candidate");
    // It is a proposal in review: nothing is published, and another reviewer decides it.
    const page = await as("head_bid", `/v1/wiki/${WS}/pages/${s.pageId}`, { email: STEWARD });
    expect(page.status).toBe(404);
    const queue = await json<Loose[]>(await as("head_bid", "/v1/questions", { email: OTHER }));
    const q = queue.find((x) => x.id === s.proposalId) as Loose;
    expect(q).toBeTruthy();
    expect(q.title).toContain("wombatic");
    // Your own draft is never in your own queue.
    expect(
      (await json<Loose[]>(await as("head_bid", "/v1/questions", { email: STEWARD }))).find(
        (x) => x.id === s.proposalId,
      ),
    ).toBeUndefined();
    expect((await findGap("wombatic")) as Loose).toMatchObject({
      status: "drafted",
      proposalId: s.proposalId,
    });
    expect((await act(path, {})).status).toBe(409);
    expect((await receipts(STEWARD)).map((x) => x.action)).toContain("gap.start");

    // Publishing the draft closes the gap, and the closure rate follows.
    const approve = await as("head_bid", `/v1/questions/${encodeURIComponent(s.proposalId)}`, {
      email: OTHER,
      body: { action: "approve", revisionHash: q.detail.revisionHash, seenChanges: seenOf(q) },
    });
    expect(approve.status, await approve.clone().text()).toBe(200);
    const closed = (await findGap("wombatic", "?status=closed")) as Loose;
    expect(closed.status).toBe("closed");
    const d = await gaps(STEWARD, "?status=all");
    expect(d.kpi.closed).toBeGreaterThanOrEqual(1);
    expect(d.kpi.closureRate).toBeGreaterThan(0);
  });

  it("a title with personal data, an unknown type or an existing page is refused", async () => {
    await ask("head_bid", STEWARD, "zimbleflap approval flow", WS);
    const g = (await findGap("zimbleflap")) as Loose;
    const path = `${encodeURIComponent(g.id)}/start`;
    expect((await act(path, { title: "Call +1 514 555 0199" })).status).toBe(400);
    expect((await act(path, { type: "journal" })).status).toBe(400);
    expect((await act("gap:0000000000000000/start", {})).status).toBe(404);
  });
});

describe("Home top gaps", () => {
  it("lists the gaps of brains the caller stewards, and nothing for people who steward none", async () => {
    const top = await json<Loose>(await as("head_bid", "/v1/gaps/top?limit=3", { email: STEWARD }));
    expect(top.gaps.length).toBeGreaterThan(0);
    expect(top.gaps.length).toBeLessThanOrEqual(3);
    expect(top.gaps[0]).toMatchObject({ brainId: WS });
    const scores = (top.gaps as Loose[]).map((g) => g.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(top.kpi.windowDays).toBe(90);
    const none = await json<Loose>(
      await as("consultant", "/v1/gaps/top", { email: "v8g.cons@example.invalid" }),
    );
    expect(none.gaps).toEqual([]);
    expect(none.stewards).toBe(false);
    void rawEnv;
  });
});
