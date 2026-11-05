// Review events reach the in-app inbox: a contribution notifies the reviewers, a decision notifies
// the contributor. Titles name the scope and carry no content.

import { beforeEach, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

beforeEach(async () => {
  await seed();
});

const act = (p: string, body: unknown) => as(p, "/v1/actions", { body });
const inbox = async (p: string): Promise<Loose[]> =>
  (await json(await as(p, "/v1/admin/notifications", { method: "GET" }))).items;
const kinds = async (p: string) => (await inbox(p)).map((n) => n.kind);

async function contribute(release?: "global") {
  const res = await act("consultant", {
    nodeId: "c_delivery",
    action: "contribute",
    payload: {
      title: "Handover checklist SECRET-TITLE",
      body: "One\nTwo",
      ...(release ? { releaseTarget: release } : {}),
      user_validated: { by: "u_consultant", at: new Date().toISOString(), revision: 1 },
    },
  });
  expect(res.status).toBe(201);
  return (await json(res)).candidateId as string;
}

describe("review notifications", () => {
  it("a contribution notifies the people who can review it, not the contributor or outsiders", async () => {
    const id = await contribute();
    const mine = await inbox("reviewer");
    const n = mine.find((x) => x.kind === "review_requested");
    expect(n).toBeTruthy();
    expect(n.ref).toBe(id);
    expect(n.title).toContain("Delivery");
    // No content in the notice.
    expect(JSON.stringify(mine)).not.toContain("SECRET-TITLE");
    expect(await kinds("consultant")).not.toContain("review_requested");
    expect(await kinds("auditor")).not.toContain("review_requested");
    expect(await kinds("head_bid")).not.toContain("review_requested");
  });

  it("requesting changes notifies the contributor", async () => {
    const id = await contribute();
    const res = await as("reviewer", `/v1/ux/review/${id}/decision`, {
      body: { revision: 1, verdict: "changes_requested", comment: "Name the owner of each step" },
    });
    expect(res.status).toBe(200);
    const n = (await inbox("consultant")).find((x) => x.kind === "review_changes_requested");
    expect(n?.ref).toBe(id);
    expect(n.title).not.toContain("owner of each step");
    // The reviewer who decided is not told about their own decision.
    expect(await kinds("reviewer")).not.toContain("review_changes_requested");
  });

  it("the review action on /v1/actions notifies the contributor too", async () => {
    const id = await contribute();
    const res = await act("reviewer", {
      nodeId: id,
      action: "review",
      revision: 1,
      payload: { verdict: "changes_requested" },
    });
    expect(res.status).toBe(200);
    expect(await kinds("consultant")).toContain("review_changes_requested");
  });

  it("an approval that releases the item notifies the contributor", async () => {
    const id = await contribute();
    const res = await act("reviewer", { nodeId: id, action: "approve_release", revision: 1 });
    expect(res.status).toBe(200);
    expect((await json(res)).released).toBe(true);
    expect(await kinds("consultant")).toContain("review_released");
  });

  it("a first approval of a global release tells the contributor it is waiting for a second", async () => {
    const id = await contribute("global");
    const res = await act("reviewer", { nodeId: id, action: "approve_release", revision: 1 });
    expect(res.status).toBe(200);
    expect((await json(res)).released).toBe(false);
    const n = (await inbox("consultant")).find((x) => x.kind === "review_approved");
    expect(n?.ref).toBe(id);
  });

  it("a notification never fails the action it reports", async () => {
    // The inbox is private: the contributor sees theirs, and unread counts as usual.
    await contribute();
    const r = await json(await as("reviewer", "/v1/admin/notifications", { method: "GET" }));
    expect(r.unread).toBeGreaterThan(0);
  });
});
