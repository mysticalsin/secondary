// Wiki security review L-07: the reviewer sees, beside each proposed fact, the words of the source it
// was drawn from, and only when they may read that source.

import { beforeAll, describe, expect, it } from "vitest";
import { bestLine } from "../src/wiki/engine.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";

const ACC = "a_acme";
const C = "l7.reviewer@example.invalid";
const SRC = `src:abcdef:${"l7note1".padEnd(24, "0")}`;
const allow = {
  CONNECTOR: {
    fetch: async (_u: string, init: RequestInit) =>
      Response.json({
        results: Object.fromEntries(
          (JSON.parse(String(init.body)).itemIds as string[]).map((i) => [i, { allowed: true }]),
        ),
      }),
  },
};
const lead = (path: string, o: Loose = {}) =>
  as("acme_lead", `/v1/wiki/${ACC}/${path}`, { email: C, ...o });

let pending = "";

beforeAll(async () => {
  await seed();
  const body = [
    "Weekly notes",
    "Decision: approve 50% discount for the Lyon pilot (owner: CEO, status: decided)",
    "Risk: supplier slips {src:forged} (severity: high)",
    "Commitment: send the plan (owner: Bid lead, due: 2026-12-01)",
  ].join("\n");
  await wsOf(ALPHA, ACC).sourceUpsert([
    {
      id: SRC,
      sourceId: "abcdef",
      gateNodeId: "a_acme:con",
      plane: "ACCOUNT_RESTRICTED",
      title: "Weekly notes.md",
      body,
      webUrl: null,
      mime: "text/markdown",
      size: body.length,
      eTag: "e1",
      syncedAt: Date.now(),
    },
  ]);
  await wsOf(ALPHA, ACC).wikiNotify(ALPHA, ACC, [SRC], Date.now());
  const run = await as("acme_lead", `/v1/wiki/${ACC}/run`, { body: {} });
  expect(run.status).toBe(200);
  pending = ((await json(run)).results as Loose[]).find((r) => r.triage === "proposed")
    ?.id as string;
  expect(pending).toBeTruthy();
});

describe("L-07: the source excerpt sits beside each fact in review", () => {
  it("shows, for every fact, the line of the source it came from, cleaned", async () => {
    const v = await json(await lead(`proposals/${pending}`, { env: allow }));
    const facts = v.facts as Loose[];
    expect(facts.length).toBeGreaterThanOrEqual(3);
    for (const f of facts) expect(f.excerpt, f.subject).toEqual(expect.any(String));
    const discount = facts.find((f) => String(f.subject).includes("50% discount"));
    // The planted line is visible as written, so the reviewer sees where "approve 50%" came from.
    expect(discount?.excerpt).toContain("Decision: approve 50% discount for the Lyon pilot");
    // Braces are removed: an excerpt cannot forge a citation.
    const risk = facts.find((f) => String(f.subject).startsWith("risk:"));
    expect(risk?.excerpt).toContain("Risk: supplier slips");
    expect(risk?.excerpt).not.toMatch(/[{}]/);
    for (const f of facts) expect(String(f.excerpt).length).toBeLessThanOrEqual(240);
    expect(facts[0]?.sources[0]?.title).toBe("Weekly notes.md");
  });

  it("is withheld, with the rest of the fact, from a reviewer who cannot read the source", async () => {
    const v = JSON.stringify(await json(await lead(`proposals/${pending}`)));
    expect(v).not.toContain("excerpt");
    expect(v).not.toContain("discount");
    expect(v).toContain("restricted source");
  });
});

describe("L-07: an AI-drafted fact gets the closest line of the source", () => {
  it("picks the line that shares the most words, and never more than one line", () => {
    const text = "Intro line\nThe board agreed the rebate for Lyon\nUnrelated text";
    expect(bestLine(text, "decision: Lyon rebate decided")).toBe(
      "The board agreed the rebate for Lyon",
    );
    expect(bestLine("nothing\nhere", "zzz yyy")).toBe("");
  });
});
