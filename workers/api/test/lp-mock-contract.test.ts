// The web client's mock (apps/web/src/mock/lp.ts) must answer in the shapes the real API does, or the mock
// hides bugs the real stack shows. For each call the same request goes to both; every field the mock emits
// must exist on the real answer with the same JSON type (see uxv2-mock-contract.test.ts). The real side
// is made to produce every optional field the mock can: an image, a figure, a published page with stats,
// a check with each kind of fix, a question with the revision before it.

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, rawEnv } from "./helpers.ts";
import {
  compose,
  inReview,
  lp,
  plantLpBrain,
  publish,
  put,
  TINY_PNG,
  withStory,
} from "./lp-helpers.ts";

beforeAll(plantLpBrain);

// The mock is web code (DOM types), so this package's typecheck does not follow the import.
type Mock = {
  handleLp(method: string, p: string, q: URLSearchParams, body: Loose, role: string): unknown;
  lpQuestions(role: string): Loose[];
  lpAnswer(id: string, role: string, body: Loose): unknown;
  resetLpMock(): void;
};
const MOCK_PATH = `/@fs${new URL("../../../apps/web/src/mock/lp.ts", import.meta.url).pathname}`;
let web: Mock;
beforeAll(async () => {
  web = (await import(/* @vite-ignore */ MOCK_PATH)) as Mock;
  web.resetLpMock();
});

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
/** Fields that exist only when a person attached one, so a sample without it says nothing. */
// (A figure is covered by the compose sample, which has one.)
const OPTIONAL = new Set(["image", "note", "firstName", "metric"]);

/** Problems where `mock` has a field the real answer lacks, or a different JSON type. */
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
      if (!there.length) {
        if (!OPTIONAL.has(k)) out.push(`${path}.${k}: mock only`);
      } else out.push(...drift(v, there, `${path}.${k}`));
    }
  }
  return out;
}

const mock = (method: string, path: string, role: string, body: Loose = {}) => {
  const [p, q] = path.split("?");
  return JSON.parse(
    JSON.stringify(web.handleLp(method, p as string, new URLSearchParams(q ?? ""), body, role)),
  ) as Loose;
};

const PROSPECT = { firstName: "Jo", role: "CIO", company: "Acme Synthetic SA" };
const INPUT = { prospect: PROSPECT, angle: "cloud migration", brand: "amaris", lang: "en" };

describe("web mock and real API agree on Landing Page Studio", () => {
  it("compose, read, edit, references, checks", async () => {
    const metric = { value: "40 stores", label: "on one platform" };
    await withStory(
      (st) => {
        st.permission.metric = metric;
      },
      async () => {
        const made = await json(await lp("ceo", "/compose", { body: INPUT }));
        const fake = mock("POST", "/v1/lp/compose", "ceo", INPUT);
        // A named reference with a figure and a visual: the real side has them, so the mock's can be compared.
        const named = made.references.find((r: Loose) => r.permission === "named");
        expect(named.metric).toEqual(metric);
        const withImage = await json(
          await put("ceo", made, {
            contact: { ...made.contact, title: "Head of Bid" },
            references: made.references.map((r: Loose) =>
              r.permission === "named"
                ? { pageId: r.pageId, image: TINY_PNG }
                : { pageId: r.pageId },
            ),
          }),
        );
        expect(withImage.references.find((r: Loose) => r.permission === "named").image).toBe(
          TINY_PNG,
        );
        expect(drift(fake, [made, withImage], "compose")).toEqual([]);

        // Read and edit answer with the same draft.
        const body = {
          slots: fake.slots,
          references: fake.references.map((r: Loose) => ({ pageId: r.pageId })),
          contact: fake.contact,
          revision: fake.revision,
        };
        expect(drift(mock("GET", `/v1/lp/${fake.id}`, "ceo"), [withImage], "get")).toEqual([]);
        expect(drift(mock("PUT", `/v1/lp/${fake.id}`, "ceo", body), [withImage], "put")).toEqual(
          [],
        );

        // Candidate references: an array, in both.
        const real = await json<Loose[]>(await lp("ceo", `/${made.id}/references?q=cloud`));
        expect(Array.isArray(real)).toBe(true);
        const cands = mock("GET", `/v1/lp/${fake.id}/references?q=a`, "ceo");
        expect(Array.isArray(cands)).toBe(true);
        expect(drift(cands, [real, withImage.references], "references")).toEqual([]);

        // Checks: one issue of each kind the real side raises, each with the fix the web applies.
        const cur = await json(await lp("ceo", `/${made.id}`));
        const bad = {
          ...cur.slots,
          hero: "x".repeat(200),
          intro: "Write to bob@client.example.invalid today",
          whyUs: "We did this for Solana Demo SL last year.",
        };
        const bp = await put("ceo", cur, { slots: bad });
        expect(bp.status, await bp.clone().text()).toBe(200);
        const checked = await json(await lp("ceo", `/${made.id}/check`, { body: {} }));
        for (const k of ["length", "sensitivity", "customer-permission"])
          expect(
            checked.issues.some((i: Loose) => i.kind === k && i.fix?.text),
            k,
          ).toBe(true);
        const fakeChecked = mock("POST", `/v1/lp/${fake.id}/check`, "ceo");
        expect(drift(fakeChecked, [checked], "check")).toEqual([]);
        // Also a mock page with every kind of issue.
        const sick = mock("POST", "/v1/lp/compose", "ceo", INPUT);
        const sickBody = {
          slots: {
            ...sick.slots,
            hero: `Northwind ${"y".repeat(150)}`,
            intro: "Cost is €2.5M, confidential",
          },
          references: [],
          contact: sick.contact,
          revision: sick.revision,
        };
        mock("PUT", `/v1/lp/${sick.id}`, "ceo", sickBody);
        const fakeSick = mock("POST", `/v1/lp/${sick.id}/check`, "ceo");
        expect(fakeSick.issues.length).toBeGreaterThan(2);
        expect(drift(fakeSick, [checked], "check")).toEqual([]);
        // A reference with a problem is dropped by id: that fix exists on the real side too.
        const withRef = (checked.issues as Loose[]).find((i) => i.slot.startsWith("reference:"));
        if (withRef)
          expect(withRef.fix.removeReference).toBe(withRef.slot.slice("reference:".length));
      },
    );
  });

  it("review, publication, statistics and the list", async () => {
    // The real side: one published page with counts, one waiting in review, one draft.
    const sub = await inReview({ prospect: PROSPECT });
    const published = await inReview({ prospect: { role: "CFO", company: "Globex Holdings" } });
    const pub = await publish(published, { utm: { source: "email" } }, "ceo");
    await rawEnv.PAGES.put(
      `stats/${pub.slug}.json`,
      JSON.stringify({
        loads: 8,
        views: 5,
        ctaClicks: 2,
        byDay: [{ day: "2026-11-04", loads: 8, views: 5, ctaClicks: 2 }],
      }),
    );
    // Reviewer's questions: one release question with the page and the revision before it.
    // Two edits, so the revision before this one already has the contact's title.
    const titled = await json(
      await put("ceo", await json(await lp("ceo", `/${sub.id}`)), {
        contact: { ...sub.contact, title: "Sales owner" },
      }),
    );
    const edited = await json(
      await put("ceo", titled, { slots: { ...sub.slots, cta: "One more try" } }),
    );
    await lp("ceo", `/${edited.id}/submit`, { body: {} });
    const realQs = (await json<Loose[]>(await as("reviewer", "/v1/questions"))).filter((q) =>
      /^lp:/.test(q.id),
    );
    expect(realQs.length).toBeGreaterThan(0);

    // The mock side, as the same roles.
    const mine = mock("POST", "/v1/lp/compose", "ceo", INPUT);
    mock("POST", `/v1/lp/${mine.id}/check`, "ceo");
    expect(mock("POST", `/v1/lp/${mine.id}/submit`, "ceo").status).toBe("in_review");
    const fakeQs = web.lpQuestions("reviewer");
    expect(fakeQs.length).toBeGreaterThan(0);
    for (const q of fakeQs) {
      expect(q.kind).toBe("release");
      expect(drift(q, realQs, "question")).toEqual([]);
      for (const o of q.options) expect(["approve", "request_changes"]).toContain(o.action);
    }
    // Approving: the same answer shape from the question route, and the same hash rule.
    const qid = fakeQs.find((q) => q.detail.landing.id === mine.id)?.id as string;
    const realQ = realQs.find((q) => q.id === `lp:${edited.id.slice(3)}`) as Loose;
    const realAns = await json(
      await as("reviewer", `/v1/questions/${encodeURIComponent(realQ.id)}`, {
        body: { action: "approve", revisionHash: realQ.detail.revisionHash },
      }),
    );
    const fakeAns = JSON.parse(
      JSON.stringify(
        web.lpAnswer(qid, "reviewer", {
          action: "approve",
          revisionHash: fakeQs.find((q) => q.id === qid)?.detail.revisionHash,
        }),
      ),
    ) as Loose;
    expect(drift(fakeAns, [realAns], "answer")).toEqual([]);
    const fakeApprove = mock("POST", `/v1/lp/${mine.id}/publish`, "ceo", {});
    expect(fakeApprove.url).toMatch(/^https:\/\//);
    const realPublished = await json(
      await lp("ceo", `/${edited.id}/publish`, { body: { utm: { source: "email" } } }),
    );
    expect(
      drift(fakeApprove, [realPublished, { url: pub.url, expiresAt: pub.expiresAt }], "publish"),
    ).toEqual([]);

    // Statistics: counts per day, as objects, in both.
    const realStats = await json(await lp("ceo", `/${published.id}/stats`));
    expect(realStats.byDay[0]).toEqual({ day: "2026-11-04", views: 5, ctaClicks: 2 });
    const fakeStats = mock("GET", `/v1/lp/${mine.id}/stats`, "ceo");
    expect(drift(fakeStats, [realStats], "stats")).toEqual([]);
    const seeded = (mock("GET", "/v1/lp", "head_bid") as Loose[]).find((r) => r.stats.views > 0);
    expect(seeded.stats.byDay.length).toBeGreaterThan(1);
    expect(drift(seeded.stats, [realStats], "seeded stats")).toEqual([]);

    // The list: drafts with their stats, a published one with its address.
    const realList = await json<Loose[]>(await lp("ceo"));
    expect(realList.some((r) => r.status === "published" && r.url && r.stats.views === 5)).toBe(
      true,
    );
    for (const row of mock("GET", "/v1/lp", "head_bid") as Loose[])
      expect(drift(row, realList, `list(${row.status})`)).toEqual([]);

    // Unpublish.
    const fakeOff = mock("POST", `/v1/lp/${mine.id}/unpublish`, "ceo", {});
    const realOff = await json(await lp("ceo", `/${edited.id}/unpublish`, { body: {} }));
    expect(drift(fakeOff, [realOff], "unpublish")).toEqual([]);
    // The draft's own clock and stamp, as the web shows them.
    const fresh = mock("POST", "/v1/lp/compose", "ceo", INPUT);
    expect(Date.parse(fresh.expiresAt)).toBeGreaterThan(Date.now());
    expect(typeof fresh.updatedAt).toBe("string");
    void compose;
  });
});
