// v3 brains: Questions upgrades. Search and filters, and batch review that keeps every rule of the
// single-item path (never your own, revisionHash, two people counted per item).

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

const AUTHOR = "qb.author@example.invalid";
const OTHER = "qb.other@example.invalid";
const R1 = "qb.r1@example.invalid";
const R2 = "qb.r2@example.invalid";
const WORK =
  "The delivery gates are reviewed before each release and the owner signs the checklist.";

const propose = (email: string, ws: string, title: string, persona = "head_bid") =>
  as(persona, `/v1/wiki/${ws}/propose`, {
    email,
    body: { title, markdown: `# ${title}\n\n## Summary\n- ${WORK}\n` },
  });
const list = async (persona: string, email: string, q = "") =>
  json<Loose[]>(await as(persona, `/v1/questions${q}`, { email }));
const batch = (persona: string, email: string, items: Loose[]) =>
  as(persona, "/v1/questions/batch", { email, body: { items } });
const find = (qs: Loose[], title: string) => qs.find((x) => x.title.includes(title)) as Loose;

beforeAll(async () => {
  await seed();
  for (const t of ["Batch alpha", "Batch beta", "Batch gamma", "Gate checklist"])
    expect((await propose(AUTHOR, "c_bid", t)).status).toBe(201);
});

describe("search and filters", () => {
  it("search matches title and summary as the caller sees them", async () => {
    const all = await list("head_bid", OTHER);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const q = await list("head_bid", OTHER, "?q=batch%20beta");
    expect(q.map((x) => x.title)).toEqual([expect.stringContaining("Batch beta")]);
    expect(await list("head_bid", OTHER, "?q=zzzznothing")).toEqual([]);
  });

  it("filters by brain, kind and age", async () => {
    const byBrain = await list("head_bid", OTHER, "?brain=c_bid");
    expect(byBrain.length).toBeGreaterThanOrEqual(4);
    expect(byBrain.every((x) => x.workspaceId === "c_bid")).toBe(true);
    expect(await list("head_bid", OTHER, "?brain=core")).toEqual([]);
    expect((await list("head_bid", OTHER, "?kind=review")).length).toBeGreaterThanOrEqual(4);
    expect(await list("head_bid", OTHER, "?kind=contradiction")).toEqual([]);
    expect((await list("head_bid", OTHER, "?age=1d")).length).toBeGreaterThanOrEqual(4);
    expect(await list("head_bid", OTHER, "?age=older")).toEqual([]);
    for (const bad of ["?kind=other", "?age=2d"])
      expect((await as("head_bid", `/v1/questions${bad}`, { email: OTHER })).status, bad).toBe(400);
  });

  it("a filter never widens what the caller may see", async () => {
    // The consultant has no review right in the bid circle: nothing, however it is filtered.
    expect(await list("consultant", "qb.cons@example.invalid", "?brain=c_bid")).toEqual([]);
  });
});

describe("batch review", () => {
  it("approves several at once, and each item is judged alone", async () => {
    const qs = await list("head_bid", OTHER, "?brain=c_bid");
    const a = find(qs, "Batch alpha");
    const b = find(qs, "Batch beta");
    const c = find(qs, "Batch gamma");
    const res = await batch("head_bid", OTHER, [
      { id: a.id, action: "approve", revisionHash: a.detail.revisionHash },
      { id: b.id, action: "approve" }, // no revisionHash
      { id: c.id, action: "approve", revisionHash: "stale-hash" },
      { id: "cand:c_bid:00000000", action: "approve", revisionHash: "x" },
    ]);
    expect(res.status).toBe(200);
    const out = await json<Loose>(res);
    expect(out.results.map((r: Loose) => [r.id === a.id, r.status])).toEqual([
      [true, 200],
      [false, 400],
      [false, 409],
      [false, 404],
    ]);
    expect(out.results[1].error).toBe("revision_required");
    expect(out.ok).toBe(1);
    expect(out.failed).toBe(3);
    // Only the first was applied.
    const left = (await list("head_bid", OTHER, "?brain=c_bid")).map((x) => x.title);
    expect(left.some((t) => t.includes("Batch alpha"))).toBe(false);
    expect(left.some((t) => t.includes("Batch beta"))).toBe(true);
  });

  it("never your own: the author's batch is refused item by item", async () => {
    // Another reviewer reads the revision; the author, who wrote these, sends the approvals.
    const own = (await list("head_bid", OTHER, "?brain=c_bid")).filter((x) =>
      /Batch|Gate/.test(x.title),
    );
    expect(own.length).toBeGreaterThanOrEqual(2);
    const res = await batch(
      "head_bid",
      AUTHOR,
      own.map((x) => ({ id: x.id, action: "approve", revisionHash: x.detail.revisionHash })),
    );
    const out = await json<Loose>(res);
    expect(out.ok).toBe(0);
    expect(out.results.every((r: Loose) => r.status === 403)).toBe(true);
    expect(out.results.every((r: Loose) => r.error === "self_approval")).toBe(true);
  });

  it("a release that needs two people takes one approval per person, never two from one", async () => {
    expect((await propose(AUTHOR, "core", "Company method one")).status).toBe(201);
    expect((await propose(AUTHOR, "core", "Company method two")).status).toBe(201);
    const qs = await list("reviewer", R1, "?brain=core");
    const one = find(qs, "Company method one");
    const two = find(qs, "Company method two");
    expect(one.detail.required).toBe(2);
    const items = (q: Loose[]) =>
      q.map((x) => ({ id: x.id, action: "approve", revisionHash: x.detail.revisionHash }));

    const first = await json<Loose>(await batch("reviewer", R1, items([one, two])));
    expect(first.ok).toBe(2);
    // Still waiting: one approval of two.
    const waiting = await list("reviewer", R2, "?brain=core");
    expect(find(waiting, "Company method one").detail).toMatchObject({ approvals: 1, required: 2 });

    // The same person again, in a batch: refused for each item.
    const again = await json<Loose>(await batch("reviewer", R1, items(waiting)));
    expect(again.ok).toBe(0);
    expect(again.results.every((r: Loose) => [403, 409].includes(r.status))).toBe(true);
    expect((await list("reviewer", R2, "?brain=core")).length).toBe(waiting.length);

    // A different person completes both.
    const fresh = await list("reviewer", R2, "?brain=core");
    const second = await json<Loose>(await batch("reviewer", R2, items(fresh)));
    expect(second.ok).toBe(2);
    expect(await list("reviewer", R2, "?brain=core")).toEqual([]);
  });

  it("is limited to 50 distinct items, and a malformed batch changes nothing", async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `cand:c_bid:${i.toString(16).padStart(8, "0")}`,
        action: "approve",
      }));
    expect((await batch("head_bid", OTHER, mk(51))).status).toBe(400);
    expect((await batch("head_bid", OTHER, [])).status).toBe(400);
    const dup = { id: "cand:c_bid:00000001", action: "approve" };
    expect((await batch("head_bid", OTHER, [dup, dup])).status).toBe(400);
    expect((await batch("head_bid", OTHER, [{ id: "../x", action: "approve" }])).status).toBe(400);
    expect(
      (await as("head_bid", "/v1/questions/batch", { email: OTHER, body: { items: "no" } })).status,
    ).toBe(400);
  });

  it("can be limited to a pilot cohort", async () => {
    const made = await as("platform_admin", "/v1/admin/pilot", {
      email: "qb.admin@example.invalid",
      body: { name: "Batch pilot", members: [R1], flags: { batch_review: true } },
    });
    const id = (await json<Loose>(made)).id as string;
    const x = await batch("head_bid", OTHER, [{ id: "cand:c_bid:00000002", action: "approve" }]);
    expect(x.status).toBe(403);
    expect(await json(x)).toEqual({ error: "not_in_pilot", flag: "batch_review" });
    await as("platform_admin", `/v1/admin/pilot/${id}`, {
      email: "qb.admin@example.invalid",
      method: "DELETE",
    });
  });
});
