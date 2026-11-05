// B1 L5: search used to take the best 25 rows of a workspace and only then drop what the caller may not
// see, so rows in an admitted scope but outside the view could crowd out visible hits.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, plantLabel, seed, wsOf } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

describe("L5: hits the caller may not see do not crowd out the ones they may", () => {
  it("finds the visible row behind 60 better ranked rows that are outside the view", async () => {
    const ws = wsOf(ALPHA, "c_bid");
    const ghosts = Array.from({ length: 60 }, (_, i) => ({
      id: `ghost-row-${i}`,
      label: "zephyrite zephyrite zephyrite zephyrite",
      kind: "topic",
      plane: "TEAM_RESTRICTED",
      status: "",
      revision: 0,
      authorId: null,
      tags: [],
      reviewedBy2: false,
    }));
    await ws.seed(ghosts, false, Date.now());
    await plantLabel(
      ALPHA,
      "c_bid",
      "c_bid:pricing-models",
      "topic",
      "TEAM_RESTRICTED",
      "zephyrite pricing note with a longer title than the others",
    );
    const res = await json(await as("head_bid", "/v1/search?q=zephyrite"));
    const ids = res.results.map((r: { id: string }) => r.id);
    expect(ids).toContain("c_bid:pricing-models");
    expect(ids.some((id: string) => id.startsWith("ghost-row-"))).toBe(false);
  });
});
