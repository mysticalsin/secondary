// N-01: release, wiki decide and the second-person steps (rights export and erase, a prod switch)
// compare the stable identity, so one human who switches persona cannot satisfy a two-person rule.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, call, json, type Loose, seed, tenantDo } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const NODE = "c_bid:pricing-models"; // contributed by u_head_bid, waiting for release
const HEAD_BID = "head_bid@example.invalid";

describe("N-01: persona switching by one human", () => {
  it("the contributor cannot release their own item as another persona", async () => {
    const d = await json(await as("reviewer", `/v1/nodes/${NODE}`));
    const revision = d.record.revision as number;
    const res = await call("/v1/actions", {
      email: HEAD_BID,
      persona: "reviewer",
      body: { nodeId: NODE, action: "approve_release", revision },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).reason).toMatch(/self-approval/i);
    const rec = await json(await as("reviewer", `/v1/nodes/${NODE}`));
    expect(rec.record.status).toBe("candidate");
  });

  it("a real second person still releases it", async () => {
    // A real second person still can.
    const d = await json(await as("reviewer", `/v1/nodes/${NODE}`));
    const ok = await as("reviewer", "/v1/actions", {
      body: { nodeId: NODE, action: "approve_release", revision: d.record.revision },
    });
    expect(ok.status).toBe(200);
  });

  it("a wiki proposal cannot be decided by its proposer under another persona", async () => {
    const made = await as("head_bid", "/v1/wiki/c_bid/propose", {
      email: HEAD_BID,
      body: { title: "Same human trap", markdown: "# Same human trap\n\n- One line.\n" },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const id = (await json(made)).proposalId as string;
    const asReviewer = (email: string, path: string, body?: unknown) =>
      call(`/v1/wiki/c_bid/${path}`, {
        email,
        persona: "reviewer",
        ...(body === undefined ? {} : { body }),
      });
    const v = await json(await asReviewer(HEAD_BID, `proposals/${id}`));
    const mine = await asReviewer(HEAD_BID, `proposals/${id}/decide`, {
      decision: "approve",
      revisionHash: v.revisionHash,
    });
    expect(mine.status).toBe(403);
    expect((await json(mine)).error).toBe("self_approval");
    const other = await asReviewer("someone.else@example.invalid", `proposals/${id}/decide`, {
      decision: "approve",
      revisionHash: v.revisionHash,
    });
    expect(other.status, await other.clone().text()).toBe(200);
  });

  it("the second person of a two-person step is a different human, whatever the principal id", async () => {
    const t = tenantDo(ALPHA) as unknown as Loose;
    const now = Date.now();
    const one = await t.requestSecond(
      "export:u_x",
      "u_reviewer_aaaa",
      now,
      "same.person@example.invalid",
    );
    expect(one).toBe("first");
    // Another id, same address: still the same person.
    expect(
      await t.requestSecond(
        "export:u_x",
        "u_head_bid_bbbb",
        now + 1,
        "Same.Person@example.invalid",
      ),
    ).toBe("same");
    // A different address is a second person.
    expect(
      await t.requestSecond("export:u_x", "u_ceo_cccc", now + 2, "other.person@example.invalid"),
    ).toBe("second");
  });
});
