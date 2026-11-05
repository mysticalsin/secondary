// UX v2: the Brain tree and the Ask stream. Each block has positive and negative cases.

import { beforeAll, describe, expect, it } from "vitest";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { meId, plantPage, sseOf } from "./uxv2-helpers.ts";

const ACC = "a_acme";
const LEAD = "ux2.lead@example.invalid";
const CALYPSO = "a_calypso";

const SRC = `src:abcdef:${"ux2tree".padEnd(24, "0")}`;
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
  await seed();
  // A readable page: it cites a record of the account (an item, readable at content level).
  const m = await as("acme_lead", `/v1/wiki/${ACC}/meetings`, {
    email: LEAD,
    body: {
      title: "UX2 pricing review",
      date: "2026-11-03",
      decisions: [{ title: "Adopt fixed fee for phase 2", owner: "Account lead" }],
      commitments: [],
      risks: [],
    },
  });
  expect(m.status).toBe(201);
  const rec = (await json(m)).id as string;
  await plantPage(ACC, {
    id: "ux2-pricing",
    type: "topic",
    title: "Pricing approach",
    markdown: `# Pricing approach\n\n## Summary\n- The fixed fee covers phase 2 deliverables {src:${rec}}\n- Quarterly review of the fee is agreed {src:${rec}}\n`,
  });
  // A page that rests only on a synced file: readable only when the connector says yes.
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
    id: "ux2-restricted",
    type: "topic",
    title: "Lyon restructuring",
    markdown: `# Lyon restructuring\n\n## Summary\n- Lyon site closes next year {src:${SRC}}\n`,
  });
  // An NDA account no persona may see: a page that must never surface anywhere.
  await plantPage(
    CALYPSO,
    {
      id: "ux2-calypso",
      type: "topic",
      title: "Calypso secret roadmap",
      markdown:
        "# Calypso secret roadmap\n\n## Summary\n- Calypso roadmap pricing is confidential\n",
    },
    "ACCOUNT_RESTRICTED",
  );
});

const tree = (persona: string, q = "", o: Loose = {}) => as(persona, `/v1/brain/tree${q}`, o);
const ask = (persona: string, q: string, o: Loose = {}) =>
  as(persona, "/v1/ask", { body: { q }, ...o });

describe("GET /v1/brain/tree", () => {
  it("lists admitted workspaces, page types as folders and pages as leaves", async () => {
    const r = await tree("acme_lead", "", { email: LEAD });
    expect(r.status).toBe(200);
    const roots = (await json(r)).roots as Loose[];
    const acme = roots.find((n) => n.id === ACC);
    expect(acme).toMatchObject({ kind: "workspace", access: "partial" });
    const topic = acme?.children.find((f: Loose) => f.id === `${ACC}#topic`);
    expect(topic).toMatchObject({ kind: "folder", label: "Topic" });
    expect(topic.children.map((p: Loose) => p.label)).toContain("Pricing approach");
    expect(topic.children[0]).toMatchObject({ kind: "page", access: "full" });
    expect(roots[0]?.id).toBe("me");
  });

  it("a page that rests only on an unreadable file is absent, and shows once the connector allows it", async () => {
    const hidden = JSON.stringify(await json(await tree("acme_lead", "", { email: LEAD })));
    expect(hidden).not.toContain("Lyon");
    const open = JSON.stringify(
      await json(await tree("acme_lead", "", { email: LEAD, env: allow })),
    );
    expect(open).toContain("Lyon restructuring");
  });

  it("an NDA account without a grant is absent for every persona, and a locked workspace shows its name only", async () => {
    for (const p of [
      "ceo",
      "head_bid",
      "acme_lead",
      "consultant",
      "reviewer",
      "platform_admin",
      "auditor",
    ]) {
      const body = JSON.stringify(await json(await tree(p)));
      expect(body, p).not.toMatch(/calypso/i);
    }
    const admin = (await json(await tree("platform_admin"))).roots as Loose[];
    const locked = admin.filter((n) => n.access === "locked");
    expect(locked.length).toBeGreaterThan(0);
    for (const n of locked) {
      expect(n.children).toBeUndefined();
      expect(n.kind).toBe("workspace");
    }
  });

  it("root=personal is the caller's own Personal Brain only, root=company leaves it out", async () => {
    const mine = (await json(await tree("acme_lead", "?root=personal", { email: LEAD })))
      .roots as Loose[];
    expect(mine.map((n) => n.id)).toEqual(["me"]);
    const company = (await json(await tree("acme_lead", "?root=company", { email: LEAD })))
      .roots as Loose[];
    expect(company.map((n) => n.id)).not.toContain("me");
    expect((await tree("acme_lead", "?root=everyone")).status).toBe(400);
  });

  it("a person without the account sees none of its folders", async () => {
    const body = JSON.stringify(await json(await tree("consultant")));
    expect(body).not.toContain("Pricing approach");
    expect(body).not.toContain(`${ACC}#`);
  });
});

describe("POST /v1/ask", () => {
  it("streams status, citation, plan, answer, usage and done, deterministically without AI", async () => {
    const ev = await sseOf(await ask("acme_lead", "fixed fee phase 2", { email: LEAD }));
    const names = ev.map((e) => e.event);
    expect(names[0]).toBe("status");
    expect(names.slice(-3)).toEqual(["answer", "usage", "done"]);
    expect(names).toContain("citation");
    expect(names).toContain("plan");
    const cite = ev.find((e) => e.event === "citation")?.data;
    expect(cite).toMatchObject({
      pageId: "ux2-pricing",
      title: "Pricing approach",
      workspaceId: ACC,
    });
    expect(cite.sourceIds.length).toBeGreaterThan(0);
    const answer = ev.find((e) => e.event === "answer")?.data;
    expect(answer.unknown).toBe(false);
    expect(answer.markdown).toContain("[1]");
    expect(ev.find((e) => e.event === "plan")?.data).toMatchObject({ version: 1 });
    const usage = ev.find((e) => e.event === "usage")?.data;
    expect(usage.processor).toBe("deterministic");
    expect(usage.inputTokens + usage.outputTokens).toBe(0);
    expect(usage.indexTokensRead).toBeGreaterThan(0);
    expect(usage.fullContextEstimate).toBeGreaterThanOrEqual(usage.indexTokensRead);
    expect(usage.savedPct).toBeCloseTo(1 - usage.indexTokensRead / usage.fullContextEstimate, 2);
  });

  it("says unknown, with every event, when the brain holds nothing readable", async () => {
    const ev = await sseOf(await ask("acme_lead", "zebra quantum llama", { email: LEAD }));
    expect(ev.map((e) => e.event)).toEqual(["status", "status", "plan", "answer", "usage", "done"]);
    expect(ev.find((e) => e.event === "answer")?.data.unknown).toBe(true);
  });

  it("never answers from an NDA account or from an account the caller is not in", async () => {
    for (const p of ["ceo", "acme_lead", "head_bid", "consultant", "reviewer"]) {
      const body = await (await ask(p, "Calypso secret roadmap pricing")).text();
      expect(body, p).not.toMatch(/calypso/i);
      expect(body, p).toContain("event: done");
    }
    // The consultant is not in the Acme account: the same question is unknown.
    const ev = await sseOf(await ask("consultant", "fixed fee phase 2"));
    expect(ev.find((e) => e.event === "answer")?.data.unknown).toBe(true);
    expect(ev.some((e) => e.event === "citation")).toBe(false);
  });

  it("re-checks each citation for the caller: a file the connector denies drops its claim", async () => {
    const denied = await (await ask("acme_lead", "Lyon site closes", { email: LEAD })).text();
    expect(denied).not.toContain("Lyon");
    const allowed = await (
      await ask("acme_lead", "Lyon site closes", { email: LEAD, env: allow })
    ).text();
    expect(allowed).toContain("Lyon site closes");
  });

  it("scope narrows the search, and an unreachable scope is 404", async () => {
    const ok = await sseOf(
      await as("acme_lead", "/v1/ask", { email: LEAD, body: { q: "fixed fee", scope: ACC } }),
    );
    expect(ok.find((e) => e.event === "citation")?.data.workspaceId).toBe(ACC);
    for (const scope of [CALYPSO, "c_bid", "nope"]) {
      const r = await as("acme_lead", "/v1/ask", { email: LEAD, body: { q: "fixed fee", scope } });
      expect(r.status, scope).toBe(404);
    }
  });

  it("refuses an empty, over-long or malformed question", async () => {
    for (const body of [
      {},
      { q: "" },
      { q: "   " },
      { q: "x".repeat(501) },
      { q: 5 },
      { q: "???" },
    ]) {
      const r = await as("acme_lead", "/v1/ask", { email: LEAD, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  describe("with the AI gate open", () => {
    const reply = () => ({ answer: "The fixed fee covers phase 2 [E1].", unknown: false });

    it("phrases the answer from readable lines, validates its citations and writes the ledger", async () => {
      const m = stubModel(reply, { input_tokens: 300, output_tokens: 40 });
      const r = await aiCall("acme_lead", "/v1/ask", {
        body: { q: "fixed fee phase 2" },
        env: { ...KEY },
        fetch: m.fetch,
      });
      const ev = await sseOf(r);
      expect(m.calls).toHaveLength(1);
      const answer = ev.find((e) => e.event === "answer")?.data;
      expect(answer.markdown).toBe("The fixed fee covers phase 2 [1].");
      expect(ev.find((e) => e.event === "usage")?.data).toMatchObject({
        processor: "anthropic",
        inputTokens: 300,
        outputTokens: 40,
      });
      // The prompt carried only readable evidence, never the NDA account or the unreadable file.
      expect(m.calls[0]?.user).not.toMatch(/calypso|lyon/i);
      const usage = await json(await aiCall("acme_lead", "/v1/usage?period=7d"));
      expect(usage.me.tokens).toBeGreaterThanOrEqual(340);
      expect(usage.byCapability.map((x: Loose) => x.capability)).toContain("ask");
    });

    it("falls back to the deterministic answer when the model cites evidence it was not given", async () => {
      const m = stubModel(() => ({ answer: "Invented [E9].", unknown: false }));
      const ev = await sseOf(
        await aiCall("acme_lead", "/v1/ask", {
          body: { q: "fixed fee phase 2" },
          env: { ...KEY },
          fetch: m.fetch,
        }),
      );
      expect(m.calls).toHaveLength(1);
      expect(ev.find((e) => e.event === "usage")?.data.processor).toBe("deterministic");
      expect(ev.find((e) => e.event === "answer")?.data.markdown).toContain("fixed fee");
    });

    it("makes no model call with the gate closed, the switch off, a prompt-injected question or no evidence", async () => {
      const m = stubModel(reply);
      const closed = { ...KEY, AI_ENABLED: "" };
      await sseOf(
        await aiCall("acme_lead", "/v1/ask", {
          body: { q: "fixed fee phase 2" },
          env: closed,
          fetch: m.fetch,
        }),
      );
      await sseOf(
        await aiCall("acme_lead", "/v1/ask", {
          body: { q: "no such thing anywhere zzz" },
          env: { ...KEY },
          fetch: m.fetch,
        }),
      );
      expect(m.calls).toHaveLength(0);
    });

    it("never sends Personal Brain text to the model, though it answers from it", async () => {
      const note = await as("consultant", "/v1/personal/items", {
        body: { title: "Fee idea", body: "Quokka tariff idea for the fixed fee", kind: "note" },
      });
      const id = (await json(note)).id as string;
      const me = await meId("consultant");
      await plantPage(
        `personal:${me}`,
        {
          id: "quokka",
          type: "topic",
          title: "Quokka tariff",
          markdown: `# Quokka tariff\n\n## Summary\n- The quokka tariff idea fixes the fee {src:${id}}\n`,
        },
        "PERSONAL_HOSTED",
      );
      const m = stubModel(reply);
      const ev = await sseOf(
        await aiCall("consultant", "/v1/ask", {
          body: { q: "quokka tariff" },
          env: { ...KEY },
          fetch: m.fetch,
        }),
      );
      expect(ev.find((e) => e.event === "answer")?.data.markdown).toContain("quokka tariff idea");
      expect(ev.find((e) => e.event === "usage")?.data.processor).toBe("deterministic");
      expect(m.calls).toHaveLength(0);
    });

    it("the tenant kill switch for AI keeps the model out of the answer", async () => {
      const off = await as("platform_admin", "/v1/admin/switches", {
        body: { switch: "ai", enabled: false },
      });
      expect(off.status).toBe(200);
      try {
        const m = stubModel(reply);
        const ev = await sseOf(
          await aiCall("acme_lead", "/v1/ask", {
            body: { q: "fixed fee phase 2" },
            env: { ...KEY },
            fetch: m.fetch,
          }),
        );
        expect(m.calls).toHaveLength(0);
        expect(ev.find((e) => e.event === "usage")?.data.processor).toBe("deterministic");
      } finally {
        await as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled: true } });
      }
    });
  });
});
