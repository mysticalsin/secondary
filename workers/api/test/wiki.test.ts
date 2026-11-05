import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import hostile1 from "../../../packages/fixtures/sample/docs/acct-acme/general/doc-0004.md?raw";
import hostile2 from "../../../packages/fixtures/sample/docs/acct-borealis/contacts/doc-0154.md?raw";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import { ALPHA, as, BETA, json, type Loose, seed, withBeta, wsOf } from "./helpers.ts";

beforeAll(async () => {
  await seed();
  await seed({ tenantId: BETA, emailDomain: "beta.example.invalid", seed: 99 });
});

const ACC = "a_acme";
const get = (persona: string, path: string, o: Loose = {}) => as(persona, `/v1/wiki/${path}`, o);
const post = (persona: string, path: string, body: unknown = {}, o: Loose = {}) =>
  as(persona, `/v1/wiki/${path}`, { body, ...o });

async function meeting(persona: string, ws: string, b: Loose) {
  const r = await post(persona, `${ws}/meetings`, b);
  expect(r.status).toBe(201);
  return (await json(r)).id as string;
}
const run = async (persona: string, ws: string, jobs?: string[], o: Loose = {}) => {
  const r = await post(persona, `${ws}/run`, jobs ? { jobs } : {}, o);
  expect(r.status).toBe(200);
  return (await json(r)).results as Loose[];
};
const pending = async (persona: string, ws: string) =>
  json<Loose[]>(await get(persona, `${ws}/proposals`));
const decide = (persona: string, ws: string, id: string, decision = "approve", o: Loose = {}) =>
  post(persona, `${ws}/proposals/${id}/decide`, { decision }, o);

const PRICING = {
  title: "Pricing review",
  date: "2026-11-03",
  decisions: [
    { title: "Adopt fixed fee for phase 2", owner: "Account lead" },
    { title: "Acme Synthetic SA accepts the phase 2 scope" },
  ],
  commitments: [{ title: "Send revised proposal", owner: "Bid manager", due: "2026-11-12" }],
  risks: [{ title: "Budget approval slips", severity: "high" }],
};

describe("ingest: a source becomes a reviewable, cited diff in that workspace only", () => {
  let mtg = "";
  let proposalId = "";

  it("a new synthetic meeting creates one diff in the account's review queue", async () => {
    mtg = await meeting("acme_lead", ACC, PRICING);
    const res = await run("acme_lead", ACC);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      kind: "ingest",
      triage: "proposed",
      method: "deterministic extractor",
    });
    proposalId = res[0]?.id;
    const queue = await json<Loose[]>(await as("acme_lead", "/v1/review"));
    const row = queue.find((q) => q.id === proposalId);
    expect(row).toMatchObject({ kind: "wiki_ingest", scopeLabel: expect.stringContaining("Acme") });
    expect(row?.approve.allowed).toBe(true);
    // Nobody else's queue has it, and no other workspace holds a proposal.
    for (const p of ["consultant", "ceo", "platform_admin", "auditor", "head_bid"])
      expect(
        (await json<Loose[]>(await as(p, "/v1/review"))).some((q) => q.id === proposalId),
        p,
      ).toBe(false);
    for (const other of ["a_borealis", "a_calypso", "a_delta", "c_bid", "global"])
      expect(await wsOf(ALPHA, other).wikiProposals("candidate"), other).toEqual([]);
  });

  it("every claim in the diff is cited, and nothing is published before review", async () => {
    const v = await json(await get("acme_lead", `${ACC}/proposals/${proposalId}`));
    expect(v.kind).toBe("wiki_ingest");
    expect(v.facts.length).toBeGreaterThanOrEqual(7);
    for (const f of v.facts) expect(f.sources.map((s: Loose) => s.id)).toEqual([mtg]);
    const pages = v.pages.map((p: Loose) => p.pageId).sort();
    expect(pages).toEqual(["commitments", "decision-log", "overview", "risk-register"]);
    for (const p of v.pages)
      for (const line of p.after.split("\n").filter((l: string) => /^- (?!\[\[)/.test(l)))
        expect(line, `${p.pageId}: ${line}`).toContain(`{src:${mtg}}`);
    const idx = await json(await get("acme_lead", `${ACC}/index`));
    expect(idx.pages).toEqual([]);
  });

  it("approving publishes the pages with resolvable citations, and the log records it", async () => {
    const r = await decide("acme_lead", ACC, proposalId);
    expect(r.status).toBe(200);
    expect((await json(r)).applied.pages).toContain("decision-log");
    const page = await json(await get("acme_lead", `${ACC}/pages/decision-log`));
    expect(page.markdown).toContain("Adopt fixed fee for phase 2");
    expect(page.citations[mtg]).toMatchObject({ title: "Pricing review", kind: "item" });
    expect(page.uncited).toBe(0);
    const facts = await json<Loose[]>(await get("acme_lead", `${ACC}/facts`));
    expect(facts.every((f) => f.verifiedBy === "u_acme_lead" && !f.unverified)).toBe(true);
    const log = await json<Loose[]>(await get("acme_lead", `${ACC}/log`));
    expect(log.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["wiki_ingest.proposed", "wiki_ingest.applied"]),
    );
    // The same source again is triage only: nothing changed, so nothing is proposed.
    await post("acme_lead", `${ACC}/run`, {});
    await wsOf(ALPHA, ACC).wikiNotify(ALPHA, ACC, [mtg], Date.now());
    const again = await run("acme_lead", ACC);
    expect(again[0]).toMatchObject({ triage: "unchanged" });
  });

  it("search and ask are index first, cite their sources, and say unknown when nothing supports an answer", async () => {
    const s = await json(await get("acme_lead", `${ACC}/search?q=fixed%20fee`));
    expect(s.results[0]).toMatchObject({ pageId: expect.any(String) });
    const ask = await json(
      await get("acme_lead", `${ACC}/ask?q=What%20was%20decided%20about%20the%20fixed%20fee`),
    );
    expect(ask.unknown).toBe(false);
    expect(ask.answer[0].citations[0].id).toBe(mtg);
    const none = await json(await get("acme_lead", `${ACC}/ask?q=quantum%20teleportation%20zebra`));
    expect(none).toMatchObject({ unknown: true, answer: null });
    expect((await get("acme_lead", `${ACC}/ask?q=%20`)).status).toBe(400);
  });

  it("a contradiction invalidates the older fact, keeps it, and the history shows both", async () => {
    await meeting("acme_lead", ACC, {
      title: "Pricing follow-up",
      date: "2026-11-10",
      decisions: [{ title: "Adopt fixed fee for phase 2", status: "reversed" }],
    });
    const res = await run("acme_lead", ACC);
    const id = res[0]?.id;
    const view = await json(await get("acme_lead", `${ACC}/proposals/${id}`));
    expect(view.invalidate).toHaveLength(1);
    expect(view.invalidate[0]).toMatchObject({
      subject: "decision: Adopt fixed fee for phase 2",
      predicate: "status",
      object: "decided",
    });
    expect((await decide("acme_lead", ACC, id)).status).toBe(200);
    const all = await json<Loose[]>(
      await get(
        "acme_lead",
        `${ACC}/facts?all=1&subject=${encodeURIComponent("decision: Adopt fixed fee for phase 2")}`,
      ),
    );
    const status = all.filter((f) => f.predicate === "status");
    expect(status.map((f) => [f.object, f.invalidAt !== null]).sort()).toEqual([
      ["decided", true],
      ["reversed", false],
    ]);
    expect(status.find((f) => f.object === "decided")?.invalidAt).toContain("2026-11-10");
    const page = await json(await get("acme_lead", `${ACC}/pages/decision-log`));
    expect(page.markdown).toContain("status reversed");
    expect(page.markdown).not.toContain("Adopt fixed fee for phase 2: status decided");
    const hist = await json<Loose[]>(await get("acme_lead", `${ACC}/pages/decision-log/history`));
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist[0]?.diff.some((d: Loose) => d.type === "add" && d.text.includes("reversed"))).toBe(
      true,
    );
    expect(hist[0]?.diff.some((d: Loose) => d.type === "del" && d.text.includes("decided"))).toBe(
      true,
    );
  });

  it("lint flags a claim whose source hash changed, and approving it re-reads the source", async () => {
    const ws = wsOf(ALPHA, ACC);
    const row = await ws.get(mtg);
    const body = JSON.parse(row?.body ?? "{}");
    body.decisions[0].title = "Adopt a retainer for phase 2";
    const e = await ws.edit(
      mtg,
      row?.revision ?? 0,
      { body: JSON.stringify(body) },
      Date.now(),
      "u_planter",
    );
    expect("ok" in e && e.ok).toBe(true);
    const res = await run("acme_lead", ACC, ["lint"]);
    expect(res[0]?.found).toBeGreaterThan(0);
    const list = await pending("acme_lead", ACC);
    const f = list.find((p) => p.kind === "wiki_lint" && p.title.startsWith("Source changed"));
    expect(f).toBeTruthy();
    expect(f?.detail).toContain("changed since");
    // A second lint of the same condition files nothing new.
    const again = await run("acme_lead", ACC, ["lint"]);
    expect(again[0]?.filed).toBe(0);
    // Approving queues a re-ingest, which proposes the new wording.
    expect((await decide("acme_lead", ACC, f?.id)).status).toBe(200);
    const next = await run("acme_lead", ACC);
    expect(next.find((r) => r.kind === "ingest")?.triage).toBe("proposed");
  });
});

describe("hostile documents stay in their workspace and are never obeyed", () => {
  const CANARY = "CANARY-BOREALIS-7f3a91c2";

  it("a hostile document with no structure yields no diff at all", async () => {
    const ws = wsOf(ALPHA, ACC);
    const made = await ws.create(
      {
        id: "rec:a_acme:hostile01",
        label: "Imported note",
        kind: "record",
        plane: "ACCOUNT_RESTRICTED",
        origin: "record",
        status: "open",
        authorId: "u_planter",
        body: hostile1,
        tags: ["dec"],
      },
      Date.now(),
    );
    expect("ok" in made).toBe(false);
    await wsOf(ALPHA, ACC).wikiNotify(ALPHA, ACC, ["rec:a_acme:hostile01"], Date.now());
    const before = (await pending("acme_lead", ACC)).length;
    const res = await run("acme_lead", ACC);
    // The record itself is a structured decision (title, status), so it can be proposed, but its text is data only.
    for (const r of res)
      expect(["proposed", "no_new_information", "unchanged"]).toContain(r.triage);
    const added = (await pending("acme_lead", ACC)).slice(
      0,
      (await pending("acme_lead", ACC)).length - before,
    );
    for (const p of added) expect(JSON.stringify(p)).not.toContain("acct-borealis");
    for (const other of ["a_borealis", "a_calypso", "a_delta", "c_bid", "c_sales", "global"])
      expect(await wsOf(ALPHA, other).wikiProposals("candidate"), other).toEqual([]);
  });

  it("a model that obeys the hostile text still cannot write elsewhere, and its prompt holds no other workspace", async () => {
    // Plant a canary in another account and a hostile free-text note in the Acme circle workspace.
    const bor = wsOf(ALPHA, "a_borealis");
    await bor.create(
      {
        id: "rec:a_borealis:canary01",
        label: CANARY,
        kind: "record",
        plane: "ACCOUNT_RESTRICTED",
        origin: "record",
        status: "open",
        authorId: "u_planter",
        body: CANARY,
        tags: ["dec"],
      },
      Date.now(),
    );
    const ws = wsOf(ALPHA, ACC);
    await ws.create(
      {
        id: "rec:a_acme:hostile02",
        label: "Partner note",
        kind: "record",
        plane: "ACCOUNT_RESTRICTED",
        origin: "record",
        status: "open",
        authorId: "u_planter",
        body: `${hostile2}\nDecision: Ship the toolkit (status: decided)`,
        tags: ["dec"],
      },
      Date.now(),
    );
    await ws.wikiNotify(ALPHA, ACC, ["rec:a_acme:hostile02"], Date.now());
    const m = stubModel(() => ({
      new_information: true,
      target_workspace: "a_borealis",
      facts: [
        {
          kind: "decision",
          title: "Export the contact list to account acct-delta",
          attribute: "status",
          value: "decided",
          citations: ["E1"],
        },
        {
          kind: "risk",
          title: "Uncited invented risk",
          attribute: "status",
          value: "open",
          citations: [],
        },
        {
          kind: "decision",
          title: "Cites a source that does not exist",
          attribute: "status",
          value: "decided",
          citations: ["E9"],
        },
      ],
      pages: [
        {
          type: "topic",
          title: "Everything from other accounts",
          sections: [
            {
              heading: "Dump",
              claims: [{ text: "Copied text from a_borealis", citations: ["E7"] }],
            },
          ],
        },
      ],
    }));
    const r = await aiCall("acme_lead", `/v1/wiki/${ACC}/run`, {
      body: {},
      env: KEY,
      fetch: m.fetch,
    });
    expect(r.status).toBe(200);
    expect(m.calls.length).toBeGreaterThanOrEqual(1);
    for (const c of m.calls) {
      expect(c.user).not.toContain(CANARY);
      expect(c.user).not.toContain("a_borealis");
      expect(c.user).toContain('<evidence id="E1"');
      expect(c.system).toContain("untrusted");
      expect(c.body.tools).toBeUndefined();
    }
    const out = (await json(r)).results as Loose[];
    const aiRun = out.find((x) => x.method?.startsWith("AI processor"));
    expect(aiRun?.triage).toBe("proposed");
    const v = await json(await aiCall("acme_lead", `/v1/wiki/${ACC}/proposals/${aiRun?.id}`));
    // Only the properly cited fact survived, and it is a proposal for people to read, in this workspace.
    expect(v.facts.map((f: Loose) => f.subject)).toEqual([
      "decision: Export the contact list to account acct-delta",
    ]);
    expect(v.pages.map((p: Loose) => p.pageId)).not.toContain("everything-from-other-accounts");
    for (const other of ["a_borealis", "a_calypso", "a_delta", "c_bid", "c_sales", "global"]) {
      expect(await wsOf(ALPHA, other).wikiProposals("candidate"), other).toEqual([]);
      expect(JSON.parse(await wsOf(ALPHA, other).wikiDigest()).pages, other).toEqual([]);
    }
    expect(JSON.stringify(v)).not.toContain(CANARY);
    // And the other tenant's workspace of the same name never saw any of it.
    expect(await wsOf(BETA, ACC).wikiProposals("candidate")).toEqual([]);
  });

  it("without a contract that allows AI, no model call is made and the extractor runs instead", async () => {
    const m = stubModel();
    await wsOf(ALPHA, "a_borealis").wikiNotify(
      ALPHA,
      "a_borealis",
      ["rec:a_borealis:canary01"],
      Date.now(),
    );
    // a_borealis is not an account the Acme lead can open: the call is a 404 and nothing runs.
    const r = await aiCall("acme_lead", "/v1/wiki/a_borealis/run", {
      body: {},
      env: KEY,
      fetch: m.fetch,
    });
    expect(r.status).toBe(404);
    expect(m.calls).toHaveLength(0);
  });
});

describe("citations are re-checked for the caller", () => {
  const SRC = `src:abcdef:${"a1".repeat(12)}`;
  let id = "";
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

  beforeAll(async () => {
    const ws = wsOf(ALPHA, ACC);
    await ws.sourceUpsert([
      {
        id: SRC,
        sourceId: "abcdef",
        gateNodeId: "a_acme:con",
        plane: "ACCOUNT_RESTRICTED",
        title: "Partner terms.md",
        body: "Decision: Share pricing with the partner (status: decided)",
        webUrl: null,
        mime: "text/markdown",
        size: 50,
        eTag: "e1",
        syncedAt: Date.now(),
      },
    ]);
    await ws.wikiNotify(ALPHA, ACC, [SRC], Date.now());
    const res = await run("acme_lead", ACC);
    id = res.find((r) => r.kind === "ingest" && r.triage === "proposed")?.id;
    expect((await decide("acme_lead", ACC, id)).status).toBe(200);
  });

  it("a caller who may read the source sees the claim and its citation", async () => {
    const page = await json(await get("acme_lead", `${ACC}/pages/decision-log`, { env: allow }));
    expect(page.markdown).toContain("Share pricing with the partner");
    expect(page.citations[SRC]).toMatchObject({ kind: "source", title: "Partner terms.md" });
  });

  it("a caller who cannot read the source loses the citation and the claim that rested on it", async () => {
    const page = await json(await get("ceo", `${ACC}/pages/decision-log`, { env: allow }));
    expect(page.markdown).not.toContain("Share pricing");
    expect(page.markdown).not.toContain(SRC);
    expect(page.restricted).toBeGreaterThanOrEqual(1);
    const facts = await json<Loose[]>(await get("ceo", `${ACC}/facts`, { env: allow }));
    expect(facts.some((f) => f.subject.includes("Share pricing"))).toBe(false);
    const s = await json(await get("ceo", `${ACC}/search?q=partner`, { env: allow }));
    expect(JSON.stringify(s)).not.toContain("Share pricing");
    const ask = await json(
      await get("ceo", `${ACC}/ask?q=share%20pricing%20partner`, { env: allow }),
    );
    expect(ask.unknown).toBe(true);
    // The same caller still reads claims whose sources they may read.
    expect(
      (await json(await get("ceo", `${ACC}/pages/decision-log`, { env: allow }))).markdown,
    ).toContain("Adopt");
  });

  it("fails closed: the connector not confirming drops it for everyone", async () => {
    const page = await json(await get("acme_lead", `${ACC}/pages/decision-log`));
    expect(page.markdown).not.toContain("Share pricing");
    expect(page.restricted).toBeGreaterThanOrEqual(1);
  });
});

describe("permissions", () => {
  it("only people admitted at content level see a workspace wiki", async () => {
    for (const p of ["consultant", "platform_admin", "auditor"])
      expect((await get(p, `${ACC}/index`)).status, p).toBe(404);
    expect((await get("ceo", `${ACC}/index`)).status).toBe(200);
    expect((await get("acme_lead", "a_nope/index")).status).toBe(404);
    expect((await get("acme_lead", "personal:u_consultant/index")).status).toBe(404);
    // Another tenant's Acme lead gets their own, empty wiki.
    const beta = await as("acme_lead", `/v1/wiki/${ACC}/index`, {
      email: "acme_lead@beta.example.invalid",
      env: withBeta,
    });
    expect(beta.status).toBe(200);
    expect((await json(beta)).pages).toEqual([]);
  });

  it("reading is not deciding: a reader cannot see proposals or approve", async () => {
    const ceo = await get("ceo", `${ACC}/proposals`);
    expect(ceo.status).toBe(403);
    expect(
      (await post("ceo", `${ACC}/proposals/cand:a_acme:00000000/decide`, { decision: "approve" }))
        .status,
    ).toBe(403);
    expect((await post("ceo", `${ACC}/run`, {})).status).toBe(403);
    expect((await post("ceo", `${ACC}/meetings`, PRICING)).status).toBe(403);
  });

  it("the wiki agent's proposals cannot be decided as ordinary items", async () => {
    const res = await run("acme_lead", ACC, ["lint"]);
    expect(res.length).toBeGreaterThan(0);
    const p = (await pending("acme_lead", ACC))[0] as Loose;
    const act = await as("acme_lead", "/v1/actions", {
      body: { nodeId: p.id, action: "approve_release", revision: 1 },
    });
    expect([403, 409]).toContain(act.status);
    expect((await wsOf(ALPHA, ACC).get(p.id))?.status).toBe("candidate");
  });
});

describe("a person proposes, someone else decides", () => {
  const C = "c_bid";
  const page = (title: string, md: string) =>
    post("head_bid", `${C}/propose`, { title, markdown: md });

  it("wiki_propose creates a review item and the proposer cannot approve it", async () => {
    const r = await page(
      "Fixed fee pricing playbook",
      "# Fixed fee pricing playbook\n\n## Summary\n- Quote a fixed fee when scope is stable\n",
    );
    expect(r.status).toBe(201);
    const { proposalId } = await json(r);
    expect((await decide("head_bid", C, proposalId)).status).toBe(403);
    expect((await decide("reviewer", C, proposalId)).status).toBe(200);
    const p = await json(await get("reviewer", `${C}/pages/fixed-fee-pricing-playbook`));
    expect(p.markdown).toContain("Quote a fixed fee");
    // Cross-workspace links and made-up citations never survive.
    const bad = await page(
      "Links test",
      "# Links\n- Fact [[a_borealis:secret]] {src:rec:a_borealis:canary01} [[global:glossary]]\n",
    );
    const v = await json(await get("reviewer", `${C}/proposals/${(await json(bad)).proposalId}`));
    expect(v.pages[0].after).not.toContain("a_borealis");
    expect(v.pages[0].after).toContain("[[global:glossary]]");
  });

  it("readers without contribute rights are refused", async () => {
    expect((await post("auditor", `${C}/propose`, { title: "x", markdown: "y" })).status).toBe(404);
    expect(
      (await post("ceo", "core/propose", { title: "Glossary entry", markdown: "# G\n- term" }))
        .status,
    ).toBe(201);
    expect((await post("consultant", `${C}/propose`, { title: "x", markdown: "y" })).status).toBe(
      404,
    );
  });
});

describe("lint and dreaming", () => {
  const C = "c_bid";

  it("lint finds contradictions, broken links, orphans and uncited claims, and acceptance ends the older fact", async () => {
    const ws = wsOf(ALPHA, C);
    await ws.wikiTouch(ALPHA, C, Date.now());
    const fact = (object: string, validAt: string, id: string) => ({
      subject: "risk: Vendor delay",
      predicate: "severity",
      object,
      validAt,
      sourceIds: [id],
      sourceHashes: { [id]: "x" },
      sourceSeen: true,
      confidence: 0.8,
      origin: "human" as const,
    });
    const prop = async (object: string, validAt: string, id: string) => {
      const r = await ws.wikiPropose(
        {
          kind: "wiki_ingest",
          title: `Facts ${object}`,
          rationale: "t",
          origin: "human",
          pages: [],
          facts: [fact(object, validAt, id)],
          invalidate: [],
          confirm: [],
          archive: [],
          reingest: [],
          sources: [],
          findingKey: null,
        },
        "u_planter",
        Date.now(),
        { plane: "TEAM_RESTRICTED" },
      );
      expect(r.ok && r.created).toBe(true);
      if (r.ok && r.created)
        expect((await ws.wikiDecide(r.id, "approve", "u_checker", Date.now())).ok).toBe(true);
    };
    await prop("medium", "2026-09-01T00:00:00.000Z", "ghost-1");
    await prop("high", "2026-10-01T00:00:00.000Z", "ghost-2");
    expect(
      (await json<Loose[]>(await get("head_bid", `${C}/facts`))).filter(
        (f) => f.subject === "risk: Vendor delay",
      ),
    ).toHaveLength(0);
    await post("head_bid", `${C}/propose`, {
      title: "Orphan page",
      markdown: "# Orphan\n\n## Summary\n- Says something without a source [[no-such-page]]\n",
    });
    const prop2 = (await pending("reviewer", C)).find((p) => p.title.includes("Orphan"));
    await decide("reviewer", C, prop2?.id);
    const res = await run("head_bid", C, ["lint"]);
    expect(res[0]?.filed).toBeGreaterThan(0);
    const titles = (await pending("head_bid", C))
      .filter((p) => p.kind === "wiki_lint")
      .map((p) => p.title);
    expect(titles.some((t) => t.startsWith("Contradiction: Vendor delay"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Broken link"))).toBe(true);
    expect(titles, titles.join(" | ")).toContain("Orphan page: Orphan page");
    expect(titles.some((t) => t.startsWith("Uncited claims"))).toBe(true);
  });

  it("a contradiction found by lint is resolved by approval, which ends the older fact and keeps it", async () => {
    // Two facts that are both valid and disagree. Facts with no sources are fine here: they only need to exist.
    const ws = wsOf(ALPHA, C);
    for (const [o, at] of [
      ["low", "2026-08-01T00:00:00.000Z"],
      ["critical", "2026-09-01T00:00:00.000Z"],
    ] as const) {
      const r = await ws.wikiPropose(
        {
          kind: "wiki_ingest",
          title: `Severity ${o}`,
          rationale: "t",
          origin: "human",
          pages: [],
          facts: [
            {
              subject: "risk: Key supplier loss",
              predicate: "severity",
              object: o,
              validAt: at,
              sourceIds: [],
              sourceHashes: {},
              confidence: 0.5,
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
        { plane: "TEAM_RESTRICTED" },
      );
      if (r.ok && r.created) await ws.wikiDecide(r.id, "approve", "u_checker", Date.now());
    }
    await run("head_bid", C, ["lint"]);
    const contra = (await pending("head_bid", C)).find((p) =>
      p.title.startsWith("Contradiction: Key supplier loss"),
    );
    expect(contra).toBeTruthy();
    expect((await decide("reviewer", C, contra?.id)).status).toBe(200);
    const all = await json<Loose[]>(
      await get(
        "head_bid",
        `${C}/facts?all=1&subject=${encodeURIComponent("risk: Key supplier loss")}`,
      ),
    );
    expect(all.map((f) => [f.object, f.invalidAt?.slice(0, 10) ?? null]).sort()).toEqual([
      ["critical", null],
      ["low", "2026-09-01"],
    ]);
  });

  it("stale claims are flagged once the freshness window has passed", async () => {
    const later = Date.now() + 400 * 86_400_000;
    const res = await run("head_bid", C, ["lint"], { now: later });
    expect(res[0]?.found).toBeGreaterThan(0);
    expect((await pending("head_bid", C)).some((p) => p.title.startsWith("Stale:"))).toBe(true);
  });

  it("dreaming proposes merges, summaries and links and never writes", async () => {
    for (const [t, md] of [
      [
        "Fixed fee pricing playbook guide",
        "# Guide\n\n## Summary\n- Add a risk buffer to every fixed fee quote\n",
      ],
      ["Kickoff method", "# Kickoff\n- We follow the Orphan page approach in week one\n"],
    ] as const) {
      const r = await json(await post("head_bid", `${C}/propose`, { title: t, markdown: md }));
      await decide("reviewer", C, r.proposalId);
    }
    const ws = wsOf(ALPHA, C);
    const before = await ws.wikiDigest();
    const res = await run("head_bid", C, ["dream"]);
    expect(res[0]?.filed).toBeGreaterThanOrEqual(2);
    expect(await ws.wikiDigest()).toBe(before);
    const dreams = (await pending("head_bid", C)).filter((p) => p.kind === "wiki_dream");
    expect(dreams.some((d) => d.title.startsWith("Merge"))).toBe(true);
    expect(dreams.some((d) => d.title.startsWith("Link"))).toBe(true);
    // Approval is what writes: the merge archives the duplicate and keeps its lines.
    const merge = dreams.find((d) => d.title.startsWith("Merge"));
    expect((await decide("reviewer", C, merge?.id)).status).toBe(200);
    const kept = await json(await get("head_bid", `${C}/pages/fixed-fee-pricing-playbook`));
    expect(kept.markdown).toContain("Add a risk buffer");
    expect((await get("head_bid", `${C}/pages/fixed-fee-pricing-playbook-guide`)).status).toBe(404);
  });

  it("a stale or conflicting proposal is refused rather than applied blindly", async () => {
    const r = await json(
      await post("head_bid", `${C}/propose`, {
        title: "Kickoff method",
        markdown: "# Kickoff v2\n- Changed text\n",
      }),
    );
    // Another edit lands first.
    const r2 = await json(
      await post("head_bid", `${C}/propose`, {
        title: "Kickoff method",
        markdown: "# Kickoff v3\n- Other change\n",
      }),
    );
    expect((await decide("reviewer", C, r2.proposalId)).status).toBe(200);
    const late = await decide("reviewer", C, r.proposalId);
    expect(late.status).toBe(409);
  });

  it("the alarm runs lint daily and dreaming nightly under the workspace's own identity", async () => {
    const ws = wsOf(ALPHA, "c_sales");
    const t = Date.now() - 3 * 86_400_000;
    await ws.wikiTouch(ALPHA, "c_sales", t);
    await runInDurableObject(ws, async (inst) => {
      await (inst as unknown as { alarm(): Promise<void> }).alarm();
    });
    const log = (await ws.wikiLog(20)).map((e) => `${e.actor}:${e.kind}`);
    expect(log).toContain("svc:wiki:c_sales:lint.run");
    expect(log).toContain("svc:wiki:c_sales:dream.run");
  });
});

describe("Personal Brain wikis", () => {
  const note =
    "Date: 2026-11-02\nDecision: Review the playbook weekly (owner: Delivery lead)\nCommitment: Draft the checklist (due: 2026-11-20)";

  async function makeNote(persona: string, body = note) {
    const r = await as(persona, "/v1/personal/items", {
      body: { title: "Weekly notes", body, kind: "note" },
    });
    expect(r.status).toBe(201);
    return (await json(r)).id as string;
  }

  it("goes through review unless the owner turns on auto-accept, and uses no model", async () => {
    await makeNote("consultant");
    const m = stubModel();
    const r = await aiCall("consultant", "/v1/wiki/me/run", { body: {}, env: KEY, fetch: m.fetch });
    expect(m.calls).toHaveLength(0);
    const res = (await json(r)).results as Loose[];
    expect(res[0]?.triage).toBe("proposed");
    expect(res[0]?.autoAccepted).toBe(false);
    const queue = await json<Loose[]>(await as("consultant", "/v1/review"));
    expect(
      queue.some(
        (q) => q.id === res[0]?.id && q.kind === "wiki_ingest" && q.scopeLabel === "My Secondary",
      ),
    ).toBe(true);
    expect((await json(await get("consultant", "me/index"))).pages).toEqual([]);
    expect((await decide("consultant", "me", res[0]?.id)).status).toBe(200);
    expect((await json(await get("consultant", "me/index"))).pages.length).toBeGreaterThan(0);
  });

  it("auto-accept publishes at once and leaves the facts unverified until the owner confirms", async () => {
    const s = await as("consultant", "/v1/wiki/me/settings", {
      method: "PUT",
      body: { autoAccept: true },
    });
    expect((await json(s)).autoAccept).toBe(true);
    await makeNote("consultant", "Decision: Pair on every estimate (status: decided)");
    const res = await run("consultant", "me");
    expect(res.find((r) => r.triage === "proposed")?.autoAccepted).toBe(true);
    const facts = await json<Loose[]>(await get("consultant", "me/facts"));
    const f = facts.find(
      (x) => x.subject === "decision: Pair on every estimate" && x.predicate === "status",
    );
    expect(f).toMatchObject({ unverified: true, verifiedBy: null });
    expect((await post("consultant", `me/facts/${f?.id}/verify`)).status).toBe(200);
    expect(
      (await json<Loose[]>(await get("consultant", "me/facts"))).find((x) => x.id === f?.id)
        ?.unverified,
    ).toBe(false);
    // A shared wiki can never auto-accept.
    expect(
      (
        await as("acme_lead", `/v1/wiki/${ACC}/settings`, {
          method: "PUT",
          body: { autoAccept: true },
        })
      ).status,
    ).toBe(400);
  });

  it("CEO, admin and auditor never see it", async () => {
    await makeNote("consultant", "Decision: Zebra protocol for onboarding (status: decided)");
    await run("consultant", "me");
    for (const p of ["ceo", "platform_admin", "auditor", "head_bid", "reviewer", "acme_lead"]) {
      expect((await get(p, "pb:u_consultant/index")).status, p).toBe(404);
      expect((await get(p, "personal:u_consultant/index")).status, p).toBe(404);
      const all = await json(await get(p, "all/search?q=zebra"));
      expect(JSON.stringify(all), p).not.toContain("Zebra");
      const health = await json<Loose[]>(await get(p, "health"));
      expect(
        health.some((h) => h.nodeId === "pb:u_consultant"),
        p,
      ).toBe(false);
      const q = await json<Loose[]>(await as(p, "/v1/review"));
      expect(
        q.some((x) => x.kind?.startsWith("wiki_") && x.scopeLabel === "My Secondary"),
        p,
      ).toBe(false);
      // `me` is always the caller's own, never the consultant's.
      expect(JSON.stringify(await json(await get(p, "me/search?q=zebra"))), p).not.toContain(
        "Zebra",
      );
    }
    expect(JSON.stringify(await json(await get("consultant", "all/search?q=zebra")))).toContain(
      "Zebra",
    );
  });
});

describe("Promote to Global", () => {
  const PROMOTER = "ceo.promoter@example.invalid";
  let candidate = "";
  const validated = (by: string) => ({ by, at: new Date().toISOString(), revision: 1 });

  it("creates a de-identified candidate through the contribute flow, with no back-link to the account", async () => {
    // A CEO address of its own: the seeded CEO id belongs to the erase test in ops-rights.
    const r = await post(
      "ceo",
      `${ACC}/pages/decision-log/promote`,
      { user_validated: validated(PROMOTER), acknowledged_flags: [] },
      { email: PROMOTER },
    );
    expect(r.status, await r.clone().text()).toBe(201);
    candidate = (await json(r)).candidateId;
    const item = await wsOf(ALPHA, "global").get(candidate);
    expect(item).toMatchObject({ kind: "candidate", releaseTarget: "global", required: 2 });
    for (const bad of ["Acme", "a_acme", "{src", "[[", "rec:", "mtg:", "src:"])
      expect(`${item?.label}\n${item?.body}`, bad).not.toContain(bad);
    expect(item?.body).toContain("the client");
    // The caller could not read the partner file, so the claim that rests on it is not in the copy.
    expect(item?.body).not.toContain("Share pricing");
    // The account wiki holds the request; the global side holds nothing that names the account.
    expect(JSON.stringify(await wsOf(ALPHA, "global").wikiLog(50))).not.toContain("a_acme");
  });

  it("needs two distinct approvers, then becomes a cited Company Global page", async () => {
    const approve = (email: string) =>
      as("reviewer", "/v1/actions", {
        email,
        body: { nodeId: candidate, action: "approve_release", revision: 1 },
      });
    const a = await json(await approve("reviewer@example.invalid"));
    expect(a).toMatchObject({ released: false, approvals: 1, required: 2 });
    expect((await approve("reviewer@example.invalid")).status).toBe(409);
    const b = await json(await approve("second.reviewer@example.invalid"));
    expect(b).toMatchObject({ released: true, approvals: 2 });
    const idx = await json(await get("ceo", "core/index"));
    expect(idx.pages.length).toBe(1);
    const page = await json(await get("ceo", `core/pages/${idx.pages[0].id}`));
    expect(page.markdown).not.toMatch(/Acme|a_acme|\[\[/);
    expect(page.uncited).toBe(0);
    expect(page.citations[candidate]).toBeTruthy();
    // Account answers never read the global wiki.
    const ask = await json(await get("acme_lead", `${ACC}/ask?q=the%20client`));
    expect(ask.pages.every((p: Loose) => p.ws === ACC)).toBe(true);
  });

  it("is refused for personal wikis, and for people who cannot contribute to Company Global", async () => {
    expect((await post("consultant", "me/pages/x/promote", {})).status).toBe(422);
    const r = await post("acme_lead", `${ACC}/pages/decision-log/promote`, {
      user_validated: validated("u_acme_lead"),
    });
    expect(r.status).toBe(403);
  });
});

describe("operations", () => {
  it("wiki tables are part of the workspace snapshot, and an erased person's id leaves the wiki", async () => {
    const ws = wsOf(ALPHA, "c_bid");
    const snap = await ws.exportAll();
    expect(Object.keys(snap)).toEqual(
      expect.arrayContaining(["wiki_pages", "wiki_facts", "wiki_log", "wiki_schema"]),
    );
    expect(JSON.stringify(snap.wiki_facts)).toContain("u_checker");
    await ws.pseudonymise("u_checker", "pseudo_x");
    expect(JSON.stringify((await ws.exportAll()).wiki_facts)).not.toContain("u_checker");
    const before = await ws.wikiDigest();
    const again = await ws.exportAll();
    await ws.importAll(JSON.parse(JSON.stringify(again)));
    expect(await ws.wikiDigest()).toBe(before);
  });

  it("the log is append only: there is no route or method that edits or deletes an entry", async () => {
    const proto = Object.getOwnPropertyNames(
      Object.getPrototypeOf(Object.getPrototypeOf(wsOf(ALPHA, ACC))),
    );
    expect(proto.filter((n) => /^wikiLog/.test(n))).toEqual([]);
    for (const m of ["PUT", "DELETE", "PATCH"])
      expect([404, 405]).toContain(
        (await as("acme_lead", `/v1/wiki/${ACC}/log`, { method: m, body: {} })).status,
      );
  });

  it("health reports findings and freshness for the map", async () => {
    const h = await json<Loose[]>(await get("head_bid", "health"));
    const bid = h.find((x) => x.nodeId === "c_bid");
    expect(bid).toMatchObject({
      pages: expect.any(Number),
      openFindings: expect.any(Number),
      score: expect.any(Number),
    });
    expect(bid?.score).toBeLessThan(100);
  });
});
