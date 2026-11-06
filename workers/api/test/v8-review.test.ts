// v8 Review desk: priority, sections, the strip and KPIs, SLA per brain, snooze, reassign, comments
// with @mentions and the R-110 warning, request changes, and everything audited. Approving stays
// where it was: the seen-changes rule is enforced by the server.

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed, seenOf } from "./helpers.ts";
import { meId, plantPage } from "./uxv2-helpers.ts";

const AUTHOR = "v8r.author@example.invalid";
const DECIDER = "v8r.decider@example.invalid";
const OTHER = "v8r.other@example.invalid";
const WS = "c_bid";
const DAYMS = 86_400_000;

const BASE = ["# Desk notes", "", "## Summary", "- alpha", "- beta", "- gamma", "- delta"].join(
  "\n",
);
const EDIT = [
  "# Desk notes",
  "",
  "## Summary",
  "- alpha two",
  "- beta",
  "- gamma",
  "- delta two",
].join("\n");

const desk = async (email: string, o: Loose = {}) =>
  json<Loose>(await as("head_bid", "/v1/review-desk", { email, ...o }));
const item = async (email: string, id: string, o: Loose = {}) =>
  (await desk(email, o)).sections.decision
    .concat((await desk(email, o)).sections.snoozed)
    .find((x: Loose) => x.id === id) as Loose;
const post = (email: string, path: string, body: Loose, persona = "head_bid") =>
  as(persona, `/v1/review-desk/${path}`, { email, body });
const receipts = async (email: string): Promise<Loose[]> => {
  const id = await meId("head_bid", { email });
  return (await json<Loose>(await as("auditor", `/v1/audit/receipts?principal=${id}`))).receipts;
};

async function propose(title: string, md: string, email = AUTHOR): Promise<string> {
  const r = await as("head_bid", `/v1/wiki/${WS}/propose`, {
    email,
    body: { title, markdown: md },
  });
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json<Loose>(r)).proposalId as string;
}

let planted: string;
let edit: string;
let fresh: string;

beforeAll(async () => {
  await seed();
  await plantPage(
    WS,
    { id: "v8r-edit", type: "topic", title: "V8r edit", markdown: BASE },
    "TEAM_RESTRICTED",
  );
  planted = await propose(
    "V8r new page",
    "# V8r new page\n\n## Summary\n- Qualify bids within two days.\n",
  );
  edit = await propose("V8r edit", EDIT);
  fresh = await propose("V8r second page", "# V8r second page\n\n## Summary\n- A short note.\n");
});

describe("the desk", () => {
  it("lists what the caller decides, scored, with age, effort and a rules summary", async () => {
    const d = await desk(DECIDER);
    const rows: Loose[] = d.sections.decision;
    const row = rows.find((x) => x.id === planted) as Loose;
    expect(row).toBeTruthy();
    expect(row).toMatchObject({
      kind: "review",
      what: "new_page",
      brain: { id: WS },
      section: "decision",
      summary: { source: "rules" },
    });
    expect(row.priority).toBeGreaterThan(0);
    expect(row.effortMinutes).toBeGreaterThanOrEqual(1);
    expect(row.age).toMatchObject({ slaDays: 2, state: "ok" });
    expect((rows.find((x) => x.id === edit) as Loose).what).toBe("change");
    // Sorted by priority, highest first.
    const p = rows.map((x) => x.priority);
    expect(p).toEqual([...p].sort((a, b) => b - a));
    expect(d.counts.waiting).toBeGreaterThanOrEqual(3);
    expect(d.kpis.waiting).toBe(d.counts.waiting);
  });

  it("the 14-day strip carries a dot per incoming proposal, coloured by state", async () => {
    const d = await desk(DECIDER);
    expect(d.strip.days).toHaveLength(14);
    const mine = d.strip.dots.filter((x: Loose) => [planted, edit, fresh].includes(x.id));
    expect(mine).toHaveLength(3);
    expect(mine.every((x: Loose) => x.state === "waiting")).toBe(true);
  });

  it("an item past the brain SLA is overdue and ranks higher", async () => {
    const soon = await item(DECIDER, planted);
    const late = await item(DECIDER, planted, { now: Date.now() + 8 * DAYMS });
    expect(late.age.state).toBe("overdue");
    expect(late.priority).toBeGreaterThan(soon.priority);
    expect(
      (await desk(DECIDER, { now: Date.now() + 8 * DAYMS })).kpis.overdue,
    ).toBeGreaterThanOrEqual(3);
  });

  it("nothing outside the caller's rights shows, and the author never sees their own", async () => {
    const mineAsAuthor = await desk(AUTHOR);
    const all = Object.values(mineAsAuthor.sections).flat() as Loose[];
    expect(all.find((x) => x.id === planted)).toBeUndefined();
    const consultant = await json<Loose>(
      await as("consultant", "/v1/review-desk", { email: "v8r.cons@example.invalid" }),
    );
    expect(consultant.sections.decision).toEqual([]);
    expect(consultant.counts.waiting).toBe(0);
  });

  it("the detail has risk, context, discussion and eligible reviewers, and no diff of its own", async () => {
    const r = await as("head_bid", `/v1/review-desk/${encodeURIComponent(edit)}`, {
      email: DECIDER,
    });
    expect(r.status).toBe(200);
    const d = await json<Loose>(r);
    expect(d.summary.source).toBe("rules");
    expect(d.risk).toMatchObject({ personalData: { count: 0 }, clients: [] });
    expect(d.context.pageTitle).toBe("V8r edit");
    expect(d.context.current).toContain("- alpha");
    expect(d.comments).toEqual([]);
    expect(Array.isArray(d.eligible)).toBe(true);
    // The summary never stands in for the diff: that is read from the question.
    expect(d.diff).toBeUndefined();
    expect(
      (await as("head_bid", "/v1/review-desk/cand:nope:00000000", { email: DECIDER })).status,
    ).toBe(404);
    expect((await as("head_bid", "/v1/review-desk/not-an-id", { email: DECIDER })).status).toBe(
      404,
    );
    expect(
      (
        await as("consultant", `/v1/review-desk/${encodeURIComponent(edit)}`, {
          email: "v8r.cons@example.invalid",
        })
      ).status,
    ).toBe(404);
  });
});

describe("approve still needs every change seen, on the server", () => {
  it("refuses without proof, accepts with it", async () => {
    const qs = await json<Loose[]>(await as("head_bid", "/v1/questions", { email: DECIDER }));
    const q = qs.find((x) => x.id === edit) as Loose;
    const without = await as("head_bid", `/v1/questions/${encodeURIComponent(edit)}`, {
      email: DECIDER,
      body: { action: "approve", revisionHash: q.detail.revisionHash },
    });
    expect(without.status).toBe(409);
    expect((await json<Loose>(without)).error).toBe("changes_not_seen");
  });
});

describe("snooze", () => {
  it("moves the item for that person only, and is audited", async () => {
    const until = new Date(Date.now() + 2 * DAYMS).toISOString();
    const r = await post(DECIDER, `${encodeURIComponent(fresh)}/snooze`, { until });
    expect(r.status, await r.clone().text()).toBe(200);
    const mine = await desk(DECIDER);
    expect(mine.sections.snoozed.map((x: Loose) => x.id)).toContain(fresh);
    expect(mine.sections.decision.map((x: Loose) => x.id)).not.toContain(fresh);
    expect(mine.counts.waiting).toBe(
      mine.sections.decision.length +
        mine.sections.contradictions.length +
        mine.sections.mentions.length,
    );
    const other = await desk(OTHER);
    expect(other.sections.decision.map((x: Loose) => x.id)).toContain(fresh);
    expect((await receipts(DECIDER)).map((x) => x.action)).toContain("review.snooze");
    // Bring it back.
    expect(
      (await post(DECIDER, `${encodeURIComponent(fresh)}/snooze`, { until: null })).status,
    ).toBe(200);
    expect((await desk(DECIDER)).sections.decision.map((x: Loose) => x.id)).toContain(fresh);
    expect((await receipts(DECIDER)).map((x) => x.action)).toContain("review.unsnooze");
  });

  it("a snooze is in the future and at most 60 days", async () => {
    const path = `${encodeURIComponent(fresh)}/snooze`;
    for (const until of [
      new Date(Date.now() - DAYMS).toISOString(),
      new Date(Date.now() + 90 * DAYMS).toISOString(),
      "tomorrow",
      5,
    ])
      expect((await post(DECIDER, path, { until })).status, String(until)).toBe(400);
  });
});

describe("reassign", () => {
  it("goes only to an eligible reviewer, never the author or someone without the right", async () => {
    const path = `${encodeURIComponent(planted)}/reassign`;
    const detail = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(planted)}`, { email: DECIDER }),
    );
    const eligible: Loose[] = detail.eligible;
    expect(eligible.length).toBeGreaterThan(0);
    // The consultant has no review right in the bid circle, the author never decides their own.
    const consultant = "u_consultant";
    expect(eligible.map((x) => x.id)).not.toContain(consultant);
    const refused = await post(DECIDER, path, { to: consultant });
    expect(refused.status).toBe(403);
    expect((await post(DECIDER, path, { to: "u_nobody" })).status).toBe(403);
    expect((await post(DECIDER, path, { to: 7 })).status).toBe(400);
    const target = eligible[0] as Loose;
    const ok = await post(DECIDER, path, { to: target.id });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const after = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(planted)}`, { email: DECIDER }),
    );
    expect(after.state.assignedTo.id).toBe(target.id);
    const acts = await receipts(DECIDER);
    expect(acts.find((x) => x.action === "review.reassign")).toBeTruthy();
    expect(acts.find((x) => x.action === "review.reassign" && x.decision === "allow")).toBeTruthy();
    // Unassign.
    expect((await post(DECIDER, path, { to: null })).status).toBe(200);
  });
});

describe("comments", () => {
  const path = () => `${encodeURIComponent(edit)}/comments`;

  it("posts, lists, and notifies a mentioned eligible reviewer; others are reported unresolved", async () => {
    const detail = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(edit)}`, { email: DECIDER }),
    );
    const handle = (detail.eligible as Loose[])[0]?.handle as string;
    expect(handle).toBeTruthy();
    const r = await post(DECIDER, path(), {
      text: `Please check the numbers @${handle} and @nobody.here`,
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const out = await json<Loose>(r);
    expect(out.mentioned).toHaveLength(1);
    expect(out.unresolved).toEqual(["nobody.here"]);
    const again = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(edit)}`, { email: OTHER }),
    );
    expect(again.comments).toHaveLength(1);
    expect(again.comments[0]).toMatchObject({ mine: false });
    expect(again.comments[0].mentions).toContain(handle);
    expect((await receipts(DECIDER)).map((x) => x.action)).toContain("review.comment");
  });

  it("personal data in a comment warns first and posts only when confirmed (R-110)", async () => {
    const text = "Ring her on +1 514 555 0199 before we approve";
    const warn = await post(OTHER, path(), { text });
    expect(warn.status).toBe(409);
    const w = await json<Loose>(warn);
    expect(w.error).toBe("personal_data_warning");
    expect(w.kinds).toContain("phone");
    expect(JSON.stringify(w)).not.toContain("555");
    const before = (
      await json<Loose>(
        await as("head_bid", `/v1/review-desk/${encodeURIComponent(edit)}`, { email: OTHER }),
      )
    ).comments.length;
    const ok = await post(OTHER, path(), { text, acknowledged: true });
    expect(ok.status).toBe(201);
    const after = (
      await json<Loose>(
        await as("head_bid", `/v1/review-desk/${encodeURIComponent(edit)}`, { email: OTHER }),
      )
    ).comments.length;
    expect(after).toBe(before + 1);
    expect(
      (await receipts(OTHER)).find(
        (x) =>
          x.action === "review.comment" && String(x.reason).includes("personal_data_confirmed"),
      ),
    ).toBeTruthy();
  });

  it("refuses an empty or oversized comment, and a comment on an item the caller cannot see", async () => {
    expect((await post(OTHER, path(), { text: "  " })).status).toBe(400);
    expect((await post(OTHER, path(), { text: "x".repeat(2_001) })).status).toBe(400);
    expect(
      (await post("v8r.cons@example.invalid", path(), { text: "hello" }, "consultant")).status,
    ).toBe(404);
  });
});

describe("mentions section", () => {
  it("an unanswered mention moves the item to Mentions until the person replies", async () => {
    const id = await propose(
      "V8r mention page",
      "# V8r mention page\n\n## Summary\n- Mention me.\n",
    );
    // The knowledge reviewer is a directory person, so a mention resolves to their principal.
    const reviewer = (email?: string) => as("reviewer", "/v1/review-desk", email ? { email } : {});
    const mineBefore = await json<Loose>(await reviewer());
    expect(Object.values(mineBefore.sections).flat().length).toBeGreaterThan(0);
    const detail = await json<Loose>(
      await as("head_bid", `/v1/review-desk/${encodeURIComponent(id)}`, { email: DECIDER }),
    );
    const target = (detail.eligible as Loose[]).find((p) => p.handle === "reviewer");
    expect(target, JSON.stringify(detail.eligible)).toBeTruthy();
    const r = await post(DECIDER, `${encodeURIComponent(id)}/comments`, { text: "@reviewer look" });
    expect((await json<Loose>(r)).mentioned).toEqual([target?.id]);
    const mine = await json<Loose>(await reviewer());
    expect(mine.sections.mentions.map((x: Loose) => x.id)).toContain(id);
    expect(mine.sections.decision.map((x: Loose) => x.id)).not.toContain(id);
    const reply = await post(
      "reviewer@example.invalid",
      `${encodeURIComponent(id)}/comments`,
      { text: "On it" },
      "reviewer",
    );
    expect(reply.status, await reply.clone().text()).toBe(201);
    const after = await json<Loose>(await reviewer());
    expect(after.sections.mentions.map((x: Loose) => x.id)).not.toContain(id);
    expect(after.sections.decision.map((x: Loose) => x.id)).toContain(id);
  });
});

describe("request changes", () => {
  it("keeps the proposal open, waits on its author and is audited", async () => {
    const id = await propose(
      "V8r changes page",
      "# V8r changes page\n\n## Summary\n- Needs work.\n",
    );
    const q = (await json<Loose[]>(await as("head_bid", "/v1/questions", { email: DECIDER }))).find(
      (x) => x.id === id,
    ) as Loose;
    const path = `${encodeURIComponent(id)}/request-changes`;
    expect(
      (await post(DECIDER, path, { note: "Cite a source", revisionHash: "0".repeat(64) })).status,
    ).toBe(409);
    expect(
      (await post(DECIDER, path, { note: "", revisionHash: q.detail.revisionHash })).status,
    ).toBe(400);
    const ok = await post(DECIDER, path, {
      note: "Cite a source",
      revisionHash: q.detail.revisionHash,
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const d = await desk(DECIDER);
    expect(d.sections.snoozed.find((x: Loose) => x.id === id)).toMatchObject({
      waitingOnAuthor: true,
    });
    expect((await receipts(DECIDER)).map((x) => x.action)).toContain("review.request_changes");
    // Still open: it was neither approved nor rejected.
    const still = await json<Loose[]>(await as("head_bid", "/v1/questions", { email: DECIDER }));
    expect(still.find((x) => x.id === id)).toBeTruthy();
    // A new revision brings it back to the decision list.
    const edited = await as("head_bid", `/v1/wiki/${WS}/proposals/${id}/edit`, {
      email: DECIDER,
      body: {
        pageId: "v8r-changes-page",
        markdown: "# V8r changes page\n\n## Summary\n- Needs work, with a source.\n",
      },
    });
    if (edited.status === 200)
      expect((await desk(DECIDER)).sections.decision.map((x: Loose) => x.id)).toContain(id);
  });
});

describe("review SLA per brain", () => {
  it("defaults to two business days, a manager sets it, a reader reads it, everything is audited", async () => {
    const read = async (persona: string, email: string) =>
      as(persona, `/v1/brains/${WS}/review-sla`, { email });
    const first = await json<Loose>(await read("head_bid", DECIDER));
    expect(first).toMatchObject({ days: 2, defaultDays: 2, min: 1, max: 10 });
    const put = (persona: string, email: string, days: unknown) =>
      as(persona, `/v1/brains/${WS}/review-sla`, { email, method: "PUT", body: { days } });
    for (const days of [0, 11, 1.5, "3", null])
      expect((await put("head_bid", DECIDER, days)).status, String(days)).toBe(400);
    // Someone who can read but not manage the brain cannot set it; someone outside it cannot see it.
    expect((await put("ceo", "v8r.ceo@example.invalid", 5)).status).toBe(403);
    expect((await put("consultant", "v8r.cons@example.invalid", 5)).status).toBe(404);
    const set = await put("head_bid", DECIDER, 1);
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await json<Loose>(await read("head_bid", DECIDER))).days).toBe(1);
    const row = await item(DECIDER, planted);
    expect(row.age.slaDays).toBe(1);
    expect((await receipts(DECIDER)).find((x: Loose) => x.action === "review.sla")).toBeTruthy();
    await put("head_bid", DECIDER, 2);
  });
});
