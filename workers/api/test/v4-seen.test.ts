// v4: approving a wiki proposal needs proof that every change was seen, on the current revision.
// Every approving path (single decide, Questions decide, batch) runs the same rule; reject needs none.

import { beforeAll, describe, expect, it } from "vitest";
import { numberChanges, seenProblem } from "../src/wiki/changes.ts";
import { as, json, type Loose, seed, seenOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const AUTHOR = "v4s.author@example.invalid";
const DECIDER = "v4s.decider@example.invalid";
const WS = "c_bid";

const BASE = ["# Gate notes", "", "## Summary", "- alpha", "- beta", "- gamma", "- delta"].join(
  "\n",
);
/** Two separate runs of changed lines: alpha and delta. */
const EDIT = [
  "# Gate notes",
  "",
  "## Summary",
  "- alpha two",
  "- beta",
  "- gamma",
  "- delta two",
].join("\n");

const wiki = (email: string, path: string, body?: Loose) =>
  as("head_bid", `/v1/wiki/${WS}/${path}`, { email, ...(body ? { body } : {}) });

/** A pending edit of a planted page, with two changes. */
async function pendingEdit(pageId: string): Promise<string> {
  await plantPage(
    WS,
    { id: pageId, type: "topic", title: `Gate ${pageId}`, markdown: BASE },
    "TEAM_RESTRICTED",
  );
  const r = await wiki(AUTHOR, "propose", { title: `Gate ${pageId}`, pageId, markdown: EDIT });
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json<Loose>(r)).proposalId as string;
}
const view = async (id: string) => json<Loose>(await wiki(DECIDER, `proposals/${id}`));
const decide = (id: string, body: Loose) => wiki(DECIDER, `proposals/${id}/decide`, body);
const pageText = async (pageId: string) =>
  (await json<Loose>(await wiki(DECIDER, `pages/${pageId}`))).markdown as string;

beforeAll(async () => {
  await seed();
});

describe("numbering (pure)", () => {
  it("a maximal run of add/del lines is one change, per page, in page order", () => {
    const d = (s: string) =>
      [...s].map((ch) => ({
        type: ch === "+" ? ("add" as const) : ch === "-" ? ("del" as const) : ("same" as const),
        text: ch,
      }));
    expect(numberChanges([d("=+-=="), d("==-+="), d("===")])).toEqual({
      index: [
        [null, 0, 0, null, null],
        [null, null, 1, 1, null],
        [null, null, null],
      ],
      count: 2,
    });
  });

  it("a proposal that changes no page needs no acknowledgement", () => {
    expect(seenProblem({ revisionHash: "h", pages: [] }, undefined)).toBeNull();
    expect(
      seenProblem({ revisionHash: "h", pages: [{ diff: [{ type: "same", text: "x" }] }] }, null),
    ).toBeNull();
  });
});

describe("proposal detail", () => {
  it("exposes revisionHash, changeCount and a 0-based change on every changed line", async () => {
    const id = await pendingEdit("v4s-detail");
    const v = await view(id);
    expect(v.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.changeCount).toBe(2);
    const lines = v.pages[0].diff as Loose[];
    expect(lines.filter((l) => l.type === "same").every((l) => !("change" in l))).toBe(true);
    const changed = lines.filter((l) => l.type !== "same");
    expect(changed.map((l) => [l.type, l.text, l.change])).toEqual([
      ["del", "- alpha", 0],
      ["add", "- alpha two", 0],
      ["del", "- delta", 1],
      ["add", "- delta two", 1],
    ]);
  });

  it("the Waiting-for-you detail carries the same numbering", async () => {
    await pendingEdit("v4s-question");
    const qs = await json<Loose[]>(await as("head_bid", "/v1/questions", { email: DECIDER }));
    const q = qs.find((x) => x.title.includes("v4s-question")) as Loose;
    expect(q.detail.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(q.detail.changeCount).toBe(2);
    const changed = (q.detail.pages[0].diff as Loose[]).filter((l) => l.type !== "same");
    expect(changed.map((l) => l.change)).toEqual([0, 0, 1, 1]);
  });
});

describe("decide (approve) refuses what was not seen", () => {
  it("missing, partial, stale and wrong-revision acknowledgements are 409 changes_not_seen", async () => {
    const id = await pendingEdit("v4s-single");
    const v = await view(id);
    const approve = (seenChanges?: Loose) =>
      decide(id, {
        decision: "approve",
        revisionHash: v.revisionHash,
        ...(seenChanges ? { seenChanges } : {}),
      });

    const missing = await approve();
    expect(missing.status).toBe(409);
    expect(await json<Loose>(missing)).toMatchObject({ error: "changes_not_seen", changeCount: 2 });
    const partial = await approve({ revisionHash: v.revisionHash, indexes: [0] });
    expect(partial.status).toBe(409);
    expect((await json<Loose>(partial)).error).toBe("changes_not_seen");
    const stale = await approve({ revisionHash: "0".repeat(64), indexes: [0, 1] });
    expect(stale.status).toBe(409);
    expect((await json<Loose>(stale)).error).toBe("changes_not_seen");
    expect((await approve({ revisionHash: v.revisionHash, indexes: [-1] })).status).toBe(400);
    // Nothing was published by any refusal.
    expect(await pageText("v4s-single")).toContain("- alpha\n");
    expect((await view(id)).status).toBe("candidate");

    const ok = await approve(seenOf(v));
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await pageText("v4s-single")).toContain("- alpha two");
  });

  it("an edit after reading makes the old acknowledgement stale", async () => {
    const id = await pendingEdit("v4s-stale");
    const before = await view(id);
    const edited = await wiki(DECIDER, `proposals/${id}/edit`, {
      pageId: "v4s-stale",
      markdown: EDIT.replace("- beta", "- beta two"),
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const after = await view(id);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    // The editor is now an author, so another person decides; the old acknowledgement is refused first.
    const r = await as("head_bid", `/v1/wiki/${WS}/proposals/${id}/decide`, {
      email: "v4s.third@example.invalid",
      body: { decision: "approve", revisionHash: after.revisionHash, seenChanges: seenOf(before) },
    });
    expect(r.status).toBe(409);
    expect((await json<Loose>(r)).error).toBe("changes_not_seen");
  });

  it("reject needs no acknowledgement", async () => {
    const id = await pendingEdit("v4s-reject");
    const r = await decide(id, { decision: "reject" });
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await view(id)).status).toBe("rejected");
  });
});

describe("Questions: single and batch", () => {
  const question = async (needle: string) =>
    ((await json<Loose[]>(await as("head_bid", "/v1/questions", { email: DECIDER }))).find((x) =>
      x.title.includes(needle),
    ) as Loose) ?? null;
  const resolve = (id: string, body: Loose) =>
    as("head_bid", `/v1/questions/${id}`, { email: DECIDER, body });

  it("single: missing and partial are refused, a full acknowledgement approves", async () => {
    await pendingEdit("v4s-qsingle");
    const q = await question("v4s-qsingle");
    const base = { action: "approve", revisionHash: q.detail.revisionHash };
    const missing = await resolve(q.id, base);
    expect(missing.status).toBe(409);
    expect((await json<Loose>(missing)).error).toBe("changes_not_seen");
    const partial = await resolve(q.id, {
      ...base,
      seenChanges: { revisionHash: q.detail.revisionHash, indexes: [1] },
    });
    expect(partial.status).toBe(409);
    const stale = await resolve(q.id, {
      ...base,
      seenChanges: { revisionHash: "a".repeat(64), indexes: [0, 1] },
    });
    expect(stale.status).toBe(409);
    expect(await pageText("v4s-qsingle")).toContain("- alpha\n");
    const ok = await resolve(q.id, { ...base, seenChanges: seenOf(q) });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await pageText("v4s-qsingle")).toContain("- alpha two");
  });

  it("batch: each approving item needs its own acknowledgement, a missing one fails that item only", async () => {
    await pendingEdit("v4s-b1");
    await pendingEdit("v4s-b2");
    await pendingEdit("v4s-b3");
    const [a, b, c] = await Promise.all(["v4s-b1", "v4s-b2", "v4s-b3"].map(question));
    const item = (q: Loose, seen?: Loose) => ({
      id: q.id,
      action: "approve",
      revisionHash: q.detail.revisionHash,
      ...(seen ? { seenChanges: seen } : {}),
    });
    const res = await as("head_bid", "/v1/questions/batch", {
      email: DECIDER,
      body: {
        items: [
          item(a, seenOf(a)),
          item(b), // no acknowledgement
          item(c, { revisionHash: c.detail.revisionHash, indexes: [0] }), // partial
        ],
      },
    });
    expect(res.status).toBe(200);
    const out = await json<Loose>(res);
    expect(out.results.map((r: Loose) => [r.ok, r.status, r.error])).toEqual([
      [true, 200, undefined],
      [false, 409, "changes_not_seen"],
      [false, 409, "changes_not_seen"],
    ]);
    expect(out.ok).toBe(1);
    expect(await pageText("v4s-b1")).toContain("- alpha two");
    expect(await pageText("v4s-b2")).toContain("- alpha\n");
    expect(await pageText("v4s-b3")).toContain("- alpha\n");
  });

  it("an acknowledgement that is not the right shape is a 400", async () => {
    await pendingEdit("v4s-shape");
    const q = await question("v4s-shape");
    const r = await resolve(q.id, {
      action: "approve",
      revisionHash: q.detail.revisionHash,
      seenChanges: "all",
    });
    expect(r.status).toBe(400);
  });
});
