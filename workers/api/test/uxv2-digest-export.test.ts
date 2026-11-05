// UX v2: the weekly digest (preview and draft) and the OKF export.

import { beforeAll, describe, expect, it } from "vitest";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { meId, okfProblems, plantPage, unzip } from "./uxv2-helpers.ts";

const ACC = "a_acme";
const A = "dg.a@example.invalid";
const B = "dg.b@example.invalid";
const TODAY = new Date().toISOString().slice(0, 10);
const SRC = `src:abcdef:${"ux2export".padEnd(24, "0")}`;
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

const wiki = (persona: string, path: string, o: Loose = {}) => as(persona, `/v1/wiki/${path}`, o);
let record = "";

beforeAll(async () => {
  await seed();
  // A meeting with a commitment due today, ingested and approved by a second person.
  const m = await wiki("acme_lead", `${ACC}/meetings`, {
    email: A,
    body: {
      title: "Digest kickoff",
      date: "2026-11-03",
      decisions: [{ title: "Adopt fixed fee for phase 2", owner: "Account lead" }],
      commitments: [{ title: "Send revised proposal", owner: "Bid manager", due: TODAY }],
      risks: [],
    },
  });
  expect(m.status).toBe(201);
  record = (await json(m)).id as string;
  const run = await json(await wiki("acme_lead", `${ACC}/run`, { email: A, body: {} }));
  for (const r of run.results) {
    const v = await json(await wiki("acme_lead", `${ACC}/proposals/${r.id}`, { email: B }));
    const d = await wiki("acme_lead", `${ACC}/proposals/${r.id}/decide`, {
      email: B,
      body: { decision: "approve", revisionHash: v.revisionHash },
    });
    expect(d.status, await d.clone().text()).toBe(200);
  }
  // A success story that is ready this week.
  const story = await as("acme_lead", `/v1/ux/accounts/${ACC}/records`, {
    email: A,
    body: { section: "out", title: "Retail rollout story", status: "ready" },
  });
  expect(story.status, await story.clone().text()).toBe(201);
  // A topic page, a page resting on a file the connector controls, and a Calypso page.
  await plantPage(ACC, {
    id: "dg-pricing",
    type: "topic",
    title: "Pricing approach",
    markdown: `# Pricing approach\n\n## Summary\n- The fixed fee covers phase 2 {src:${record}}\n- See [[dg-method]] for the method {src:${record}}\n`,
  });
  await plantPage(ACC, {
    id: "dg-method",
    type: "method",
    title: "Estimating method",
    markdown: `# Estimating method\n\n## Summary\n- Estimate in three passes {src:${record}}\n\n## Steps\n- Size, price, review {src:${record}}\n`,
  });
  await wsOf(ALPHA, ACC).sourceUpsert([
    {
      id: SRC,
      sourceId: "abcdef",
      gateNodeId: "a_acme:con",
      plane: "ACCOUNT_RESTRICTED",
      title: "Restructuring plan Lyon.md",
      body: "x",
      webUrl: null,
      mime: "text/markdown",
      size: 1,
      eTag: "e1",
      syncedAt: Date.now(),
    },
  ]);
  await plantPage(ACC, {
    id: "dg-mixed",
    type: "topic",
    title: "Mixed sources",
    markdown: `# Mixed sources\n\n## Summary\n- Phase 2 budget is approved {src:${record}}\n- Lyon site closes next year {src:${SRC}}\n`,
  });
  await plantPage(
    "a_calypso",
    {
      id: "dg-calypso",
      type: "topic",
      title: "Calypso confidential plan",
      markdown: "# Calypso confidential plan\n\n## Summary\n- Calypso renewal is at risk\n",
    },
    "ACCOUNT_RESTRICTED",
  );
});

describe("GET /v1/digest/preview", () => {
  it("composes the four sections from what the caller may read, linked to pages they can open", async () => {
    const r = await as("acme_lead", "/v1/digest/preview", { email: B });
    expect(r.status).toBe(200);
    const d = await json(r);
    expect(d.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(d.weekOf).getUTCDay()).toBe(1);
    expect(d.sections.map((s: Loose) => s.title)).toEqual([
      "Opportunities",
      "New leads",
      "Commitments due",
      "Wins",
    ]);
    const due = d.sections[2].items.find((x: Loose) => x.label === "Send revised proposal");
    expect(due).toMatchObject({ pageId: "commitments", workspaceId: ACC });
    expect(due.meta).toContain(`Due ${TODAY}`);
    expect(d.sections[0].items.find((x: Loose) => x.label.startsWith("Acme"))).toMatchObject({
      pageId: "overview",
      workspaceId: ACC,
    });
    expect(d.sections[3].items.map((x: Loose) => x.label)).toContain("Retail rollout story");
    expect(d.stats).toMatchObject({ commitmentsDue: 1, wins: 1 });
    expect(d.stats.opportunities).toBe(d.sections[0].items.length);
  });

  it("every link opens: the same caller can read each page the digest points at", async () => {
    let links = 0;
    for (const persona of ["acme_lead", "head_bid", "ceo"]) {
      const o = persona === "acme_lead" ? { email: B } : {};
      const d = await json(await as(persona, "/v1/digest/preview", o));
      for (const sec of d.sections)
        for (const it of sec.items) {
          if (!it.pageId) continue;
          links++;
          const page = await as(persona, `/v1/wiki/${it.workspaceId}/pages/${it.pageId}`, o);
          expect(page.status, `${persona} ${it.workspaceId}/${it.pageId}`).toBe(200);
        }
    }
    expect(links).toBeGreaterThan(1);
  });

  it("leaves out accounts the caller is not in, and every trace of an NDA account", async () => {
    for (const p of [
      "ceo",
      "head_bid",
      "acme_lead",
      "consultant",
      "reviewer",
      "platform_admin",
      "auditor",
    ]) {
      const body = JSON.stringify(await json(await as(p, "/v1/digest/preview")));
      expect(body, p).not.toMatch(/calypso/i);
    }
    const consultant = await json(await as("consultant", "/v1/digest/preview"));
    expect(JSON.stringify(consultant)).not.toContain("Send revised proposal");
    expect(consultant.stats).toEqual({ opportunities: 0, newLeads: 0, commitmentsDue: 0, wins: 0 });
  });

  it("an item that rests on a file the caller cannot read has no link", async () => {
    // The commitment's source is a readable record, so it is shown; a fact on the restricted file is not.
    await wsOf(ALPHA, ACC).wikiTouch(ALPHA, ACC, Date.now());
    const ws = wsOf(ALPHA, ACC);
    const made = await ws.wikiPropose(
      {
        kind: "wiki_ingest",
        title: "Restricted commitment",
        rationale: "t",
        origin: "human",
        pages: [],
        facts: [
          {
            subject: "commitment: Close the Lyon site",
            predicate: "due",
            object: TODAY,
            validAt: new Date().toISOString(),
            sourceIds: [SRC],
            sourceHashes: { [SRC]: "x" },
            confidence: 0.6,
            origin: "human",
          },
        ],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      },
      "u_planter",
      Date.now(),
      { plane: "ACCOUNT_RESTRICTED" },
    );
    if (!made.ok || !made.created) throw new Error(JSON.stringify(made));
    const v = await ws.wikiProposalView(made.id);
    await ws.wikiDecide(made.id, "approve", "u_checker", Date.now(), {
      revisionHash: v?.revisionHash,
    });
    const hidden = JSON.stringify(
      await json(await as("acme_lead", "/v1/digest/preview", { email: B })),
    );
    expect(hidden).not.toContain("Lyon");
    const open = JSON.stringify(
      await json(await as("acme_lead", "/v1/digest/preview", { email: B, env: allow })),
    );
    expect(open).toContain("Close the Lyon site");
  });

  it("head_bid sees the bid accounts as opportunities and onboarding ones as leads", async () => {
    const d = await json(await as("head_bid", "/v1/digest/preview"));
    expect(d.sections[0].items.map((x: Loose) => x.label)).toContain("Ibero Mock SA");
    expect(d.sections[1].items.map((x: Loose) => x.label)).toContain("Ibero Mock SA");
  });
});

describe("POST /v1/digest/draft", () => {
  it("stores an email draft for the caller and sends nothing", async () => {
    const m = stubModel(() => ({}));
    const r = await aiCall("acme_lead", "/v1/digest/draft", {
      body: {},
      env: { ...KEY },
      fetch: m.fetch,
    });
    expect(r.status).toBe(201);
    const { draftId } = await json(r);
    expect(draftId).toMatch(/^dg:[0-9a-f]{16}$/);
    // No outbound call of any kind was made.
    expect(m.calls).toHaveLength(0);
    const draft = await json(await aiCall("acme_lead", `/v1/digest/drafts/${draftId}`));
    expect(draft).toMatchObject({
      state: "draft",
      to: "acme_lead@example.invalid",
      subject: expect.stringContaining("Weekly digest"),
    });
    expect(draft.markdown).toContain("Send revised proposal");
    expect(draft.markdown).toContain(`(/brain/${ACC}/commitments)`);
    expect(draft.markdown).not.toMatch(/calypso/i);
    // The draft is the author's: nobody else can read it.
    expect((await as("head_bid", `/v1/digest/drafts/${draftId}`)).status).toBe(404);
    expect((await as("acme_lead", "/v1/digest/drafts/dg:nothing")).status).toBe(404);
  });

  it("is counted in the ledger as a capability run with no tokens", async () => {
    const u = await json(await as("acme_lead", "/v1/usage"));
    expect(u.byCapability.find((x: Loose) => x.capability === "digest")).toMatchObject({
      tokens: 0,
      runs: 1,
    });
  });
});

describe("GET /v1/brain/export", () => {
  const exportZip = async (persona: string, ws: string, o: Loose = {}) => {
    const r = await as(persona, `/v1/brain/export?workspaceId=${encodeURIComponent(ws)}`, o);
    return r;
  };
  const files = async (r: Response) => unzip(new Uint8Array(await r.arrayBuffer()));

  it("returns an Open Knowledge Format zip: index.md and log.md at every level, a type on every page", async () => {
    const r = await exportZip("acme_lead", ACC, { email: B });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("content-disposition")).toContain("brain-a_acme-okf.zip");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const f = await files(r);
    expect(okfProblems(f)).toEqual([]);
    expect([...f.keys()]).toEqual(
      expect.arrayContaining([
        "index.md",
        "log.md",
        "topic/index.md",
        "topic/log.md",
        "topic/dg-pricing.md",
        "method/dg-method.md",
      ]),
    );
    const page = f.get("topic/dg-pricing.md") as string;
    expect(page).toMatch(/^---\ntype: "topic"\ntitle: "Pricing approach"\n/);
    expect(page).toContain('status: "published"');
    expect(page).toMatch(/stale_after: "\d{4}-\d{2}-\d{2}"/);
    expect(page).toMatch(/generated: "\d{4}-\d{2}-\d{2}T/);
    // Wiki links became root-absolute Markdown links, and citations moved to the frontmatter.
    expect(page).toContain("[Estimating method](/method/dg-method.md)");
    expect(page).not.toContain("{src:");
    expect(page).toContain(`sources: ["${record}"]`);
    expect(f.get("index.md")).toContain("- [Pricing approach](/topic/dg-pricing.md):");
    expect(f.get("topic/log.md")).toContain("updated [Pricing approach](/topic/dg-pricing.md)");
    // Generated pages are exported as their own type.
    expect(f.has("commitments/commitments.md")).toBe(true);
    expect(f.get("commitments/commitments.md")).toContain("Send revised proposal");
  });

  it("writes readable content only: an unreadable source drops its line, and the page when nothing is left", async () => {
    const f = await files(await exportZip("acme_lead", ACC, { email: B }));
    const all = [...f.values()].join("\n");
    expect(all).not.toContain("Lyon");
    expect(f.get("topic/dg-mixed.md")).toContain("Phase 2 budget is approved");
    const open = await files(await exportZip("acme_lead", ACC, { email: B, env: allow }));
    expect(open.get("topic/dg-mixed.md")).toContain("Lyon site closes next year");
  });

  it("is absent for an account the caller cannot read, and for an NDA account whoever asks", async () => {
    for (const p of [
      "ceo",
      "head_bid",
      "acme_lead",
      "consultant",
      "reviewer",
      "platform_admin",
      "auditor",
    ]) {
      const r = await exportZip(p, "a_calypso");
      expect(r.status, p).toBe(404);
      expect(await r.text()).not.toMatch(/calypso/i);
    }
    expect((await exportZip("consultant", ACC)).status).toBe(404);
    // Structure-only access is not content access.
    expect((await exportZip("platform_admin", ACC)).status).toBe(404);
    expect((await exportZip("acme_lead", "nonexistent")).status).toBe(404);
    expect((await as("acme_lead", "/v1/brain/export")).status).toBe(400);
  });

  it("the Personal Brain exports only for its owner", async () => {
    const consultant = await meId("consultant");
    const note = await as("consultant", "/v1/personal/items", {
      body: { title: "Private idea", body: "Quokka tariff", kind: "note" },
    });
    const nid = (await json(note)).id as string;
    await plantPage(
      `personal:${consultant}`,
      {
        id: "private-idea",
        type: "topic",
        title: "Private idea",
        markdown: `# Private idea\n\n## Summary\n- Quokka tariff {src:${nid}}\n`,
      },
      "PERSONAL_HOSTED",
    );
    const mine = await files(await exportZip("consultant", "me"));
    expect(mine.get("topic/private-idea.md")).toContain("Quokka tariff");
    expect(okfProblems(mine)).toEqual([]);
    // Nobody else's `me` is theirs, and no one can name another person's Personal Brain.
    for (const p of ["ceo", "head_bid", "acme_lead", "reviewer", "auditor", "platform_admin"]) {
      const r = await exportZip(p, "me");
      const all = r.status === 200 ? [...(await files(r)).values()].join("\n") : "";
      expect(all, p).not.toContain("Quokka");
      for (const other of [`pb:${consultant}`, `personal:${consultant}`, consultant]) {
        const t = await exportZip(p, other);
        expect(t.status, `${p} ${other}`).toBe(404);
      }
    }
  });

  it("an empty workspace still exports a valid, empty archive", async () => {
    const r = await exportZip("head_bid", "c_bid");
    expect(r.status).toBe(200);
    const f = await files(r);
    expect([...f.keys()].sort()).toEqual(["index.md", "log.md"]);
    expect(okfProblems(f)).toEqual([]);
  });
});
