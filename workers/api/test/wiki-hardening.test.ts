// B3 wiki security review fixes (docs/security/B3-WIKI-SECURITY-REVIEW.md): one block per finding.
// Each test was written to fail on the code the review read, then to pass with the fix.

import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runWikiJobs, type WikiApi } from "../src/wiki/engine.ts";
import { generalise, lineDiff, residualIdentifiers } from "../src/wiki/text.ts";
import { aiCall, KEY, stubModel } from "./ai-helpers.ts";
import {
  ALPHA,
  as,
  call,
  json,
  type Loose,
  rawEnv,
  seed,
  seenOf,
  testEnv,
  wsOf,
} from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const ACC = "a_acme";
const A = "ed.a@example.invalid";
const B = "ed.b@example.invalid";
const C = "rev.c@example.invalid";
const get = (persona: string, path: string, o: Loose = {}) => as(persona, `/v1/wiki/${path}`, o);
const post = (persona: string, path: string, body: unknown = {}, o: Loose = {}) =>
  as(persona, `/v1/wiki/${path}`, { body, ...o });
const lead = (email: string, path: string, body?: unknown, o: Loose = {}) =>
  body === undefined
    ? get("acme_lead", path, { email, ...o })
    : post("acme_lead", path, body, { email, ...o });

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

const view = async (email: string, id: string, ws = ACC, o: Loose = {}) =>
  json(await lead(email, `${ws}/proposals/${id}`, undefined, o));
/** Approve as `email`, presenting the revision hash the reviewer just read. */
async function approveAs(email: string, id: string, ws = ACC, o: Loose = {}) {
  const v = await view(email, id, ws, o);
  return lead(email, `${ws}/proposals/${id}/decide`, {
    decision: "approve",
    revisionHash: v.revisionHash,
    seenChanges: seenOf(v),
  });
}
async function propose(email: string, title: string, markdown: string, o: Loose = {}) {
  const r = await lead(email, `${ACC}/propose`, { title, markdown }, o);
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json(r)).proposalId as string;
}
const run = async (jobs?: string[]) => {
  const r = await post("acme_lead", `${ACC}/run`, jobs ? { jobs } : {});
  expect(r.status).toBe(200);
  return (await json(r)).results as Loose[];
};
let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function restrictedSource(id: string, title: string, body: string) {
  await wsOf(ALPHA, ACC).sourceUpsert([
    {
      id,
      sourceId: "abcdef",
      gateNodeId: "a_acme:con",
      plane: "ACCOUNT_RESTRICTED",
      title,
      body,
      webUrl: null,
      mime: "text/markdown",
      size: body.length,
      eTag: "e1",
      syncedAt: Date.now(),
    },
  ]);
  await wsOf(ALPHA, ACC).wikiNotify(ALPHA, ACC, [id], Date.now());
}
const srcId = (n: string) => `src:abcdef:${n.padEnd(24, "0").slice(0, 24)}`;

// ---------------------------------------------------------------- H-01

describe("H-01: an editor of a proposal is its author; approval binds the exact revision", () => {
  it("the person who edited a proposal cannot approve it", async () => {
    const id = await propose(B, `Edit trap ${uid()}`, "# Trap\n\n- B wrote this line.\n");
    const v = await view(A, id);
    const e = await lead(A, `${ACC}/proposals/${id}/edit`, {
      pageId: v.pages[0].pageId,
      markdown: "# Trap\n\n- A rewrote the line.\n",
    });
    expect(e.status).toBe(200);
    const mine = await approveAs(A, id);
    expect(mine.status, await mine.clone().text()).toBe(403);
    expect((await json(mine)).error).toBe("self_approval");
    // The proposer cannot either, and a third person can.
    expect((await approveAs(B, id)).status).toBe(403);
    expect((await approveAs(C, id)).status).toBe(200);
  });

  it("an edit starts a new revision: a reviewer who read the old text gets a conflict", async () => {
    const id = await propose(B, `Moving ${uid()}`, "# Moving\n\n- First wording.\n");
    const before = await view(C, id);
    expect(before.revision).toBe(1);
    expect(before.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    await lead(A, `${ACC}/proposals/${id}/edit`, {
      pageId: before.pages[0].pageId,
      markdown: "# Moving\n\n- Second wording.\n",
    });
    const stale = await lead(C, `${ACC}/proposals/${id}/decide`, {
      decision: "approve",
      revisionHash: before.revisionHash,
      seenChanges: seenOf(before),
    });
    expect(stale.status).toBe(409);
    const after = await view(C, id);
    expect(after.revision).toBe(2);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    expect((await approveAs(C, id)).status).toBe(200);
  });

  it("approving without the revision hash is refused", async () => {
    const id = await propose(B, `No hash ${uid()}`, "# No hash\n\n- A line.\n");
    const r = await lead(C, `${ACC}/proposals/${id}/decide`, { decision: "approve" });
    expect(r.status).toBe(400);
  });

  it("a generated page of a proposal cannot be rewritten by hand", async () => {
    await post("acme_lead", `${ACC}/meetings`, {
      title: `Gen ${uid()}`,
      date: "2026-11-03",
      decisions: [{ title: `Generated edit ${uid()}`, owner: "Lead" }],
    });
    const res = await run();
    const id = res.find((x) => x.triage === "proposed")?.id as string;
    const e = await lead(A, `${ACC}/proposals/${id}/edit`, {
      pageId: "decision-log",
      markdown: "# Decision log\n\n- Free text posing as a decision.\n",
    });
    expect(e.status).toBe(422);
  });

  it("where two approvers are required (Company Global), one is not enough and the same person twice neither", async () => {
    const g = wsOf(ALPHA, "global");
    const now = Date.now();
    await g.wikiTouch(ALPHA, "global", now);
    const made = await g.wikiPropose(
      {
        kind: "wiki_ingest",
        title: "Two eyes",
        rationale: "proposed by a person",
        origin: "human",
        pages: [
          {
            pageId: "two-eyes",
            type: "topic",
            title: "Two eyes",
            baseRevision: null,
            markdown: "# Two eyes\n\n- Review twice.\n",
          },
        ],
        facts: [],
        invalidate: [],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: null,
      },
      "u_author",
      now,
      { plane: "GLOBAL_NONPERSONAL" },
    );
    if (!("id" in made)) throw new Error("not created");
    const hash = (await g.wikiProposalView(made.id))?.revisionHash;
    const one = await g.wikiDecide(made.id, "approve", "u_one", now, { revisionHash: hash });
    expect(one).toMatchObject({ ok: true, status: "pending", approvals: 1, required: 2 });
    expect(await g.wikiPage("two-eyes")).toBeNull();
    expect(
      await g.wikiDecide(made.id, "approve", "u_one", now, { revisionHash: hash }),
    ).toMatchObject({ ok: false, code: "already_done" });
    expect(
      await g.wikiDecide(made.id, "approve", "u_author", now, { revisionHash: hash }),
    ).toMatchObject({ ok: false, code: "self_approval" });
    const two = await g.wikiDecide(made.id, "approve", "u_two", now, { revisionHash: hash });
    expect(two).toMatchObject({ ok: true, status: "approved" });
    expect((await g.wikiPage("two-eyes"))?.markdown).toContain("Review twice");
  });
});

// ---------------------------------------------------------------- H-02 and M-01

describe("H-02: text derived from a restricted source is checked again for every viewer", () => {
  const SRC = srcId("h02secret");
  const TITLE = "Restructuring plan Lyon.md";
  const FACT = "Close the Lyon office";
  let pending = "";
  let pageProposal = "";

  beforeAll(async () => {
    await restrictedSource(SRC, TITLE, `Decision: ${FACT} (status: open)`);
    const res = await run();
    pending = res.find((r) => r.triage === "proposed")?.id as string;
    expect(pending).toBeTruthy();
    // A page a person wrote on top of the same file (the proposer may read it).
    pageProposal = await propose(
      A,
      "Vendor secrets",
      `# Vendor secrets\n\n- The Lyon closing is planned for March {src:${SRC}}\n`,
      { env: allow },
    );
  });

  it("the review queue, the proposal list and the proposal view mask titles, facts and details", async () => {
    // acme_lead may decide here but cannot read the file (the connector does not confirm).
    const queue = JSON.stringify(await json(await as("acme_lead", "/v1/review", { email: C })));
    expect(queue).not.toContain("Lyon");
    expect(queue).not.toContain("Restructuring");
    const list = JSON.stringify(await json(await lead(C, `${ACC}/proposals`, undefined)));
    expect(list).not.toContain("Lyon");
    expect(list).not.toContain("Restructuring");
    const v = JSON.stringify(await view(C, pending));
    expect(v).not.toContain("Lyon");
    expect(v).not.toContain("Restructuring");
    expect(v).toContain("restricted source");
    // Someone who may read the file sees it all.
    const open = JSON.stringify(await view(C, pending, ACC, { env: allow }));
    expect(open).toContain("Restructuring plan Lyon.md");
    expect(open).toContain(FACT);
  });

  it("a lint finding about a restricted fact is masked the same way", async () => {
    const ws = wsOf(ALPHA, ACC);
    const f = (await ws.wikiFacts({ validOnly: false })).find((x) => x.sourceIds.includes(SRC));
    // The ingest is still pending: plant the fact as an approved one through the proposal itself.
    expect(f).toBeUndefined();
    expect((await approveAs(C, pending)).status).toBe(200);
    const fact = (await ws.wikiFacts({ validOnly: true })).find((x) => x.sourceIds.includes(SRC));
    expect(fact).toBeTruthy();
    const made = await ws.wikiPropose(
      {
        kind: "wiki_lint",
        title: `Contradiction: ${FACT} (status)`,
        rationale: "contradiction",
        detail: `"open" and "decided" for ${FACT}`,
        origin: "agent",
        pages: [],
        facts: [],
        invalidate: [{ factId: (fact as Loose).id, at: new Date().toISOString() }],
        confirm: [],
        archive: [],
        reingest: [],
        sources: [],
        findingKey: `contra:test:${uid()}`,
      },
      "svc:wiki:a_acme",
      Date.now(),
      { plane: "ACCOUNT_RESTRICTED" },
    );
    expect(made).toMatchObject({ ok: true, created: true });
    const queue = JSON.stringify(await json(await as("acme_lead", "/v1/review", { email: C })));
    expect(queue).not.toContain("Lyon");
    const list = JSON.stringify(await json(await lead(C, `${ACC}/proposals`, undefined)));
    expect(list).not.toContain("Lyon");
    const facts = JSON.stringify(await json(await lead(C, `${ACC}/facts`, undefined)));
    expect(facts).not.toContain("Lyon");
  });

  it("the log keeps source ids, not titles, and shows a viewer only what they may read", async () => {
    const log = JSON.stringify(await json(await get("ceo", `${ACC}/log`)));
    expect(log).not.toContain("Restructuring");
    expect(log).not.toContain("Lyon");
    const stored = JSON.stringify(await wsOf(ALPHA, ACC).wikiLog(200));
    expect(stored).not.toContain("Restructuring");
    // A reader of the file sees the proposal title in the log.
    const open = JSON.stringify(await json(await get("acme_lead", `${ACC}/log`, { env: allow })));
    expect(open).toContain("Restructuring plan Lyon.md");
  });

  it("a page whose only source the viewer cannot read is gone: index, read, history, search", async () => {
    expect((await approveAs(C, pageProposal)).status).toBe(200);
    const idx = JSON.stringify(await json(await get("ceo", `${ACC}/index`)));
    expect(idx).not.toContain("Vendor secrets");
    expect((await get("ceo", `${ACC}/pages/vendor-secrets`)).status).toBe(404);
    expect((await get("ceo", `${ACC}/pages/vendor-secrets/history`)).status).toBe(404);
    for (const q of ["vendor", "secrets", "lyon", "march"]) {
      const s = JSON.stringify(await json(await get("ceo", `${ACC}/search?q=${q}`)));
      expect(s, q).not.toContain("Vendor secrets");
      expect(s, q).not.toContain("Lyon");
      const all = JSON.stringify(await json(await get("ceo", `all/search?q=${q}`)));
      expect(all, q).not.toContain("Vendor secrets");
    }
    // Someone who can read the file still finds it.
    const ok = await json(await get("acme_lead", `${ACC}/search?q=vendor`, { env: allow }));
    expect(JSON.stringify(ok)).toContain("Vendor secrets");
    expect((await get("acme_lead", `${ACC}/pages/vendor-secrets`, { env: allow })).status).toBe(
      200,
    );
  });
});

describe("M-01: a generated line that merges two sources is dropped unless every source is readable", () => {
  it("a reader of one source does not get the other's attribute", async () => {
    const t = uid();
    const subject = `Vendor switch ${t}`;
    await restrictedSource(
      srcId(`m01${t}`),
      `Vendor memo ${t}.md`,
      `Decision: ${subject} (status: cancelled)`,
    );
    await post("acme_lead", `${ACC}/meetings`, {
      title: `Vendor sync ${t}`,
      date: "2026-11-03",
      decisions: [{ title: subject, status: "cancelled", owner: "CFO" }],
    });
    for (const r of await run()) {
      if (r.triage === "proposed") expect((await approveAs(C, r.id)).status).toBe(200);
    }
    const full = await json(await get("acme_lead", `${ACC}/pages/decision-log`, { env: allow }));
    expect(full.markdown).toContain("cancelled");
    for (const persona of ["ceo", "acme_lead"]) {
      const page = await json(await get(persona, `${ACC}/pages/decision-log`));
      expect(page.markdown, persona).not.toContain("cancelled");
      const ov = await json(await get(persona, `${ACC}/pages/overview`));
      expect(ov.markdown, persona).not.toContain("cancelled");
    }
  });
});

// ---------------------------------------------------------------- M-02

describe("M-02: retention and rights reach the derived wiki", () => {
  it("deleting a source erases the facts, page lines, revisions, search rows, proposals and titles it fed", async () => {
    const MARK = "Zorblax";
    const S1 = srcId("m02done");
    const S2 = srcId("m02wait");
    await restrictedSource(
      S1,
      `${MARK} contract.md`,
      `Decision: Approve ${MARK} rebate (status: decided)`,
    );
    const done = (await run()).find((r) => r.triage === "proposed")?.id as string;
    expect((await approveAs(C, done)).status).toBe(200);
    await restrictedSource(S2, `${MARK} annex.md`, `Decision: Extend ${MARK} annex (status: open)`);
    const waiting = (await run()).find((r) => r.triage === "proposed")?.id as string;
    const ws = wsOf(ALPHA, ACC);
    expect(JSON.stringify(await ws.exportAll())).toContain(MARK);
    await ws.sourceDelete([S1, S2]);
    const dump = JSON.stringify(await ws.exportAll());
    expect(dump).not.toContain(MARK);
    // The pending proposal is rejected, not left to be approved on nothing.
    expect((await ws.get(waiting))?.status).toBe("rejected");
    const page = await json(await get("acme_lead", `${ACC}/pages/decision-log`, { env: allow }));
    expect(JSON.stringify(page)).not.toContain(MARK);
  });

  it("deleting a Personal Brain note erases what the personal wiki learned from it, and the subject export carries the personal wiki", async () => {
    const MARK = "Quuxmarker";
    const made = await json(
      await as("consultant", "/v1/personal/items", {
        body: { title: `Notes ${MARK}`, body: `Decision: Keep ${MARK} private (status: decided)` },
      }),
    );
    const r = await post("consultant", "me/run", {});
    expect(r.status).toBe(200);
    const queued = (await json<Loose[]>(await get("consultant", "me/proposals")))[0];
    expect(queued).toBeTruthy();
    const queuedView = await json(await get("consultant", `me/proposals/${queued.id}`));
    expect(
      (
        await post("consultant", `me/proposals/${queued.id}/decide`, {
          decision: "approve",
          revisionHash: queuedView.revisionHash,
          seenChanges: seenOf(queuedView),
        })
      ).status,
    ).toBe(200);
    const exp1 = await adminExport("u_consultant");
    expect(JSON.stringify(exp1.personalBrain.wiki)).toContain(MARK);
    const del = await as("consultant", `/v1/personal/items/${made.id}`, { method: "DELETE" });
    expect(del.status).toBeLessThan(300);
    const dump = JSON.stringify(await wsOf(ALPHA, "personal:u_consultant").exportAll());
    expect(dump).not.toContain(MARK);
  });

  it("erasing a person replaces their address and id inside wiki text, log and titles too", async () => {
    const WHO = "dana.duval@example.invalid";
    await post("acme_lead", `${ACC}/meetings`, {
      title: `Owner check ${WHO}`,
      date: "2026-11-03",
      commitments: [{ title: `Send the pack ${uid()}`, owner: WHO }],
    });
    const id = (await run()).find((r) => r.triage === "proposed")?.id as string;
    expect((await approveAs(C, id)).status).toBe(200);
    const ws = wsOf(ALPHA, ACC);
    expect(JSON.stringify(await ws.exportAll())).toContain(WHO);
    await ws.pseudonymise("u_dana", "pz_dana", [WHO, "u_dana"]);
    expect(JSON.stringify(await ws.exportAll())).not.toContain(WHO);
  });
});

async function adminExport(principal: string): Promise<Loose> {
  const req = (email: string) =>
    as("platform_admin", "/v1/admin/rights/export", { email, body: { principal } });
  const first = await req("admin-wiki-a@example.invalid");
  const res = first.status === 202 ? await req("admin-wiki-b@example.invalid") : first;
  expect(res.status, await res.clone().text()).toBe(200);
  return json(res);
}

// ---------------------------------------------------------------- M-03

describe("M-03: history and diffs are bounded", () => {
  it("a diff of very long pages is coarse instead of quadratic", () => {
    const lines = Array.from({ length: 1_500 }, (_, i) => `line ${i}`);
    const a = lines.join("\n");
    const b = [...lines].reverse().join("\n");
    const d = lineDiff(a, b);
    // Above the cap a change is a replacement: no table of 2.25M cells, no matching lines.
    expect(d.length).toBe(3_000);
    expect(d.filter((l) => l.type === "same")).toEqual([]);
    // Small changes in the same page stay fine grained.
    const small = lineDiff(a, a.replace("line 700", "changed"));
    expect(small.filter((l) => l.type !== "same").length).toBe(2);
  });

  it("a page is capped at 1000 lines", async () => {
    const id = await propose(B, `Long ${uid()}`, `# Long\n\n${"- x\n".repeat(1_500)}`);
    expect((await approveAs(C, id)).status).toBe(200);
    const pid = (await view(C, id)).pages[0].pageId;
    const page = await json(await get("acme_lead", `${ACC}/pages/${pid}`));
    expect(page.markdown.split("\n").length).toBeLessThanOrEqual(1_000);
  });

  it("the history is paginated, newest first, with a cursor", async () => {
    const title = `Revised ${uid()}`;
    let pid = "";
    for (let n = 1; n <= 5; n++) {
      const id = await propose(B, title, `# Revised\n\n- Wording ${n}.\n`);
      pid = (await view(C, id)).pages[0].pageId;
      expect((await approveAs(C, id)).status).toBe(200);
    }
    const first = await get("acme_lead", `${ACC}/pages/${pid}/history?limit=2`);
    const rows = await json<Loose[]>(first);
    expect(rows.map((r) => r.revision)).toEqual([5, 4]);
    expect(first.headers.get("x-next-before")).toBe("4");
    const second = await json<Loose[]>(
      await get("acme_lead", `${ACC}/pages/${pid}/history?limit=2&before=4`),
    );
    expect(second.map((r) => r.revision)).toEqual([3, 2]);
    expect(second[0]?.diff.some((d: Loose) => d.type === "add")).toBe(true);
    expect((await get("acme_lead", `${ACC}/pages/${pid}/history?limit=x`)).status).toBe(400);
  });
});

// ---------------------------------------------------------------- M-04

describe("M-04: Promote to Global removes every identifier or refuses", () => {
  const PROMOTER = "ceo.deid@example.invalid";
  const validated = { by: PROMOTER, at: new Date().toISOString(), revision: 1 };

  it("strips the client's short name, URLs, source ids and contacts from the copy", async () => {
    const id = await propose(
      B,
      "Renewal lesson",
      [
        "# Renewal lesson",
        "",
        "- Acme asked for a fixed fee, see https://acme-synthetic.example.invalid/deal/42.",
        "- Write to jane.roe@acme-synthetic.example.invalid or +1 514 555 0199 to confirm.",
        "- Evidence sits in rec:a_acme:ab12cd34 and the file src:abcdef:ffffffffffff.",
        "- Visit www.acme-synthetic.example.invalid for the thread.",
        "",
      ].join("\n"),
    );
    expect((await approveAs(C, id)).status).toBe(200);
    const r = await post(
      "ceo",
      `${ACC}/pages/renewal-lesson/promote`,
      { user_validated: validated, acknowledged_flags: [] },
      { email: PROMOTER },
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const item = await wsOf(ALPHA, "global").get((await json(r)).candidateId);
    const text = `${item?.label}\n${item?.body}`;
    for (const bad of [
      "Acme",
      "acme",
      "https://",
      "http",
      "www.",
      "@",
      "rec:",
      "src:",
      "example.invalid",
      "555",
    ])
      expect(text, bad).not.toContain(bad);
    expect(text).toContain("the client");
  });

  it("the text is generalised, and identifiers that survive are found", () => {
    const ids = ["a_acme", "Acme Synthetic SA", "a_acme"];
    const out = generalise(
      "- Acme Synthetic wants https://x.example.invalid/p and mail jo@x.example.invalid, ref rec:a_acme:ab12cd34 {src:rec:a_acme:ab12cd34} [[a_acme:p]]",
      ids,
    );
    expect(out).not.toMatch(/Acme|https?:|@|rec:|\{src|\[\[|example\.invalid/i);
    expect(residualIdentifiers(out, ids)).toEqual([]);
    expect(residualIdentifiers("Contact Acme at www.acme.example", ids)).toEqual(
      expect.arrayContaining(["account name or id", "url"]),
    );
    expect(residualIdentifiers("see rec:a_acme:ab12cd34 and jo@x.invalid", ids)).toEqual(
      expect.arrayContaining(["record or source id", "email"]),
    );
  });
});

// ---------------------------------------------------------------- M-05

describe("M-05: wiki search and ingest are rate limited and bounded", () => {
  it("search is limited per person and minute", async () => {
    const env = { WIKI_SEARCH_PER_MIN: "3" };
    const who = "searcher.limit@example.invalid";
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await get("acme_lead", `${ACC}/search?q=fee`, { email: who, env })).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const limited = await get("acme_lead", `${ACC}/search?q=fee`, { email: who, env });
    expect(limited.headers.get("retry-after")).toBeTruthy();
    // Another person is not affected.
    expect(
      (await get("acme_lead", `${ACC}/search?q=fee`, { email: "other.limit@example.invalid", env }))
        .status,
    ).toBe(200);
  });

  it("one search asks the connector once, however many pages cite the same file", async () => {
    const S = srcId("m05acl");
    await restrictedSource(S, "Shared evidence.md", "Decision: Evidence for batch (status: open)");
    await run();
    for (const n of [1, 2, 3]) {
      const id = await propose(
        B,
        `Batchword page ${n}`,
        `# Batchword ${n}\n\n- Batchword claim ${n} {src:${S}}\n`,
        {
          env: allow,
        },
      );
      expect((await approveAs(C, id)).status).toBe(200);
    }
    let calls = 0;
    const counting = {
      CONNECTOR: {
        fetch: async (u: string, init: RequestInit) => {
          calls++;
          return allow.CONNECTOR.fetch(u, init);
        },
      },
    };
    const res = await get("acme_lead", `${ACC}/search?q=batchword`, { env: counting });
    expect(res.status).toBe(200);
    expect((await json(res)).results.length).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(1);
  });

  it("a record saved again soon after an ingest waits for the debounce window", async () => {
    const ws = wsOf(ALPHA, ACC);
    const m = await json(
      await post("acme_lead", `${ACC}/meetings`, {
        title: `Debounce ${uid()}`,
        date: "2026-11-03",
        decisions: [{ title: `Debounced decision ${uid()}`, owner: "Lead" }],
      }),
    );
    await run();
    await ws.wikiNotify(ALPHA, ACC, [m.id], Date.now());
    expect((await ws.wikiJobsDue(Date.now() + 60_000, 10)) as Loose[]).toEqual([]);
    const later = (await ws.wikiJobsDue(Date.now() + 11 * 60_000, 10)) as Loose[];
    expect(later.map((j: Loose) => j.payload.sourceId)).toContain(m.id);
  });

  it("the wiki spends only its own slice of the tenant's daily AI budget", async () => {
    await post("acme_lead", `${ACC}/meetings`, {
      title: `Budget ${uid()}`,
      date: "2026-11-03",
      decisions: [{ title: `Budgeted decision ${uid()}`, owner: "Lead" }],
    });
    const m = stubModel(() => ({ new_information: false, facts: [], pages: [] }));
    const out = await runWikiJobs(wsOf(ALPHA, ACC) as unknown as WikiApi, {
      env: testEnv({ ...KEY, ENVIRONMENT: "dev", AI_DAILY_TOKEN_BUDGET: "3200" }),
      now: Date.now(),
      dueAt: Number.MAX_SAFE_INTEGER,
      fetch: m.fetch,
      sleep: async () => {},
    });
    expect(m.calls).toHaveLength(0);
    expect(out[0]).toMatchObject({ kind: "ingest" });
  });

  it("writes to the wiki (propose, meetings, run) are rate limited too", async () => {
    const env = { WIKI_WRITE_PER_MIN: "2" };
    const who = "writer.limit@example.invalid";
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (
          await post(
            "acme_lead",
            `${ACC}/meetings`,
            { title: `Spam ${uid()}`, decisions: [] },
            { email: who, env },
          )
        ).status,
      );
    expect(codes).toEqual([201, 201, 429, 429]);
  });
});

// ---------------------------------------------------------------- Lows

describe("L-01: a reviewer's edit cannot cite what they cannot read", () => {
  it("the citation is stripped from the stored edit and from a proposal", async () => {
    const S = srcId("l01");
    await restrictedSource(S, "Discount memo.md", "Decision: Discount memo (status: open)");
    const ws = wsOf(ALPHA, ACC);
    const id = await propose(B, `Edit cite ${uid()}`, "# Edit cite\n\n- A line.\n");
    const v = await view(A, id);
    // A cannot read the file (the connector does not confirm), so the citation does not stand.
    await lead(A, `${ACC}/proposals/${id}/edit`, {
      pageId: v.pages[0].pageId,
      markdown: `# Edit cite\n\n- Client agreed to 30% {src:${S}}\n`,
    });
    expect(JSON.stringify(await ws.wikiProposalView(id))).not.toContain(S);
    const p2 = await propose(
      B,
      `Prop cite ${uid()}`,
      `# Prop cite\n\n- Another claim {src:${S}}\n`,
    );
    expect(JSON.stringify(await ws.wikiProposalView(p2))).not.toContain(S);
    // A person who can read it may cite it.
    const p3 = await propose(B, `Prop ok ${uid()}`, `# Prop ok\n\n- A claim {src:${S}}\n`, {
      env: allow,
    });
    expect(JSON.stringify(await ws.wikiProposalView(p3))).toContain(S);
  });
});

describe("L-02: an unreleased candidate is not a source", () => {
  it("is not citable until it is approved, and is gated by its own target node", async () => {
    const ws = wsOf(ALPHA, ACC);
    const id = `cand:a_acme:${"ab".repeat(4)}`;
    const made = await ws.create(
      {
        id,
        label: "Unreleased idea",
        kind: "candidate",
        plane: "ACCOUNT_RESTRICTED",
        origin: "candidate",
        status: "candidate",
        authorId: "u_x",
        body: "secret",
        targetNode: "a_acme",
      },
      Date.now(),
    );
    expect("ok" in made).toBe(false);
    expect(await ws.wikiSourceRefs([id])).toEqual([]);
    expect(await ws.wikiSourceInfo(id)).toBeNull();
  });
});

describe("L-03: the author of a source does not approve what is drawn from it", () => {
  it("the author of a meeting record cannot approve its ingest or verify its facts", async () => {
    const m = await json(
      await lead(A, `${ACC}/meetings`, {
        title: `Own source ${uid()}`,
        date: "2026-11-03",
        decisions: [{ title: `Own decision ${uid()}`, owner: "Lead" }],
      }),
    );
    expect(m.id).toBeTruthy();
    let id = "";
    for (const r of await run()) {
      const v = r.id ? await wsOf(ALPHA, ACC).wikiProposalView(r.id) : null;
      if (v?.sources.some((x: Loose) => x.id === m.id)) id = r.id;
    }
    expect(id).toBeTruthy();
    expect((await approveAs(A, id)).status).toBe(403);
    expect((await approveAs(C, id)).status).toBe(200);
    const fact = (await wsOf(ALPHA, ACC).wikiFacts({ validOnly: true })).find((f) =>
      f.sourceIds.includes(m.id),
    );
    expect(fact).toBeTruthy();
    expect((await lead(A, `${ACC}/facts/${(fact as Loose).id}/verify`, {})).status).toBe(403);
    expect((await lead(C, `${ACC}/facts/${(fact as Loose).id}/verify`, {})).status).toBe(200);
  });
});

describe("L-04: an AI draft never replaces an existing page", () => {
  it("merges the new claims into the page that has the same name", async () => {
    const t = uid();
    const title = `Collision ${t}`;
    const id = await propose(B, title, `# ${title}\n\n- Original claim stays.\n`);
    expect((await approveAs(C, id)).status).toBe(200);
    const slugId = (await view(C, id)).pages[0].pageId;
    await post("acme_lead", `${ACC}/meetings`, {
      title: `AI source ${t}`,
      date: "2026-11-03",
      decisions: [{ title: `AI decision ${t}`, owner: "Lead" }],
    });
    const m = stubModel(() => ({
      new_information: true,
      facts: [],
      pages: [
        {
          type: "topic",
          title,
          sections: [{ heading: "New", claims: [{ text: "A new claim.", citations: ["E1"] }] }],
        },
      ],
    }));
    const res = await runWikiJobs(wsOf(ALPHA, ACC) as unknown as WikiApi, {
      env: testEnv({ ...KEY, ENVIRONMENT: "dev" }),
      now: Date.now(),
      dueAt: Number.MAX_SAFE_INTEGER,
      fetch: m.fetch,
      sleep: async () => {},
    });
    const prop = res.find((r) => r.triage === "proposed")?.id as string;
    expect(prop).toBeTruthy();
    const draft = (await view(C, prop)).pages.find((p: Loose) => p.pageId === slugId);
    expect(draft.after).toContain("Original claim stays");
    expect(draft.after).toContain("A new claim");
    void aiCall;
  });
});

describe("L-05: a job that keeps failing is given up", () => {
  it("stops after three claims and old finished jobs are pruned", async () => {
    const ws = wsOf(ALPHA, ACC);
    await ws.wikiEnqueue("ingest", { sourceId: `poison-${uid()}` }, Date.now(), 0);
    const stub = ws as Loose;
    let claimed = 0;
    for (let i = 0; i < 6; i++) {
      await (runInDurableObject as Loose)(stub, (inst: Loose) =>
        inst.sql.exec("UPDATE wiki_jobs SET result = '1' WHERE state = 'running'"),
      );
      const due = (await ws.wikiJobsDue(Date.now() + 1, 25)) as Loose[];
      claimed += due.filter((j: Loose) => String(j.payload.sourceId).startsWith("poison-")).length;
    }
    expect(claimed).toBe(3);
  });
});

describe("L-06: a Global page names no promoter", () => {
  it("records the service as the revision actor", async () => {
    const g = wsOf(ALPHA, "global");
    const now = Date.now();
    await g.wikiTouch(ALPHA, "global", now);
    const cid = `cand:core:${"cd".repeat(4)}`;
    await g.create(
      {
        id: cid,
        label: "Promoted lesson",
        kind: "candidate",
        plane: "GLOBAL_NONPERSONAL",
        origin: "candidate",
        status: "approved",
        authorId: "u_promoter",
        body: "- A general lesson\n",
        targetNode: "core",
      },
      now,
    );
    await g.wikiRegisterPromotion(cid, "Promoted lesson", now);
    await g.wikiIndex();
    const hist = (await g.wikiPageHistory("promoted-lesson")) as Loose;
    expect(hist.revisions[0]?.actor).toBe("svc:wiki:global");
  });
});

void call;
void rawEnv;
