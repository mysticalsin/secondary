// v4 isolation: two brains, one reader of X who cannot read Y (and the reverse). Whatever surface the
// reader uses (search, ask, citations, page links, backlinks, tree, recent changes, Waiting for you,
// nav, export), nothing from the other brain comes back: no text, title, id, count or existence.
// Company Global is the only path between brains.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, plantLabel, seed, wsOf } from "./helpers.ts";
import { plantPage, sseOf, unzip } from "./uxv2-helpers.ts";

const X = "c_delivery"; // the consultant reads it
const Y = "c_bid"; // the consultant does not; the Head of Bid does
const A = "iso.consultant@example.invalid";
const B = "iso.headbid@example.invalid";

// Words only the other brain's content carries.
const Y_CANARIES = ["QZYFEE", "QZY Pricing", "QZY proposal", "QZY confidential", "QZY Source"];
const X_CANARIES = ["DLVFEE", "DLV Gates", "DLV proposal", "DLV Hidden"];

const SRC_Y = `src:abcdef:${"isoy".padEnd(24, "0")}`;
const SRC_X = `src:abcdef:${"isox".padEnd(24, "0")}`;
const src = (id: string, title: string, gate: string) => ({
  id,
  sourceId: "abcdef",
  gateNodeId: gate,
  plane: "TEAM_RESTRICTED",
  title,
  body: "x",
  webUrl: null,
  mime: "text/markdown",
  size: 1,
  eTag: "e1",
  syncedAt: Date.now(),
});
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
  // ---- Y: the bid circle ----
  await wsOf(ALPHA, Y).wikiTouch(ALPHA, Y, Date.now());
  await wsOf(ALPHA, Y).sourceUpsert([
    src(SRC_Y, "QZY confidential file.md", "c_bid:pricing-models"),
  ]);
  await plantPage(
    Y,
    {
      id: "qzy-pricing",
      type: "topic",
      title: "QZY Pricing",
      markdown: "# QZY Pricing\n\n## Summary\n- QZYFEE is the fixed fee for the bid\n",
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(
    Y,
    {
      id: "qzy-source-page",
      type: "topic",
      title: "QZY Source page",
      markdown: `# QZY Source page\n\n## Summary\n- QZYFEE rests on a file {src:${SRC_Y}}\n`,
    },
    "TEAM_RESTRICTED",
  );
  const py = await as("head_bid", `/v1/wiki/${Y}/propose`, {
    email: B,
    body: {
      title: "QZY proposal",
      markdown: "# QZY proposal\n\n## Summary\n- QZYFEE may change\n",
    },
  });
  expect(py.status, await py.clone().text()).toBe(201);

  // ---- X: the delivery circle ----
  await wsOf(ALPHA, X).wikiTouch(ALPHA, X, Date.now());
  // A file whose gate is outside the consultant's view (in the bid circle).
  await wsOf(ALPHA, X).sourceUpsert([src(SRC_X, "DLV file.md", "c_bid:pricing-models")]);
  await plantPage(
    X,
    {
      id: "dlv-hidden",
      type: "topic",
      title: "DLV Hidden note",
      markdown: `# DLV Hidden note\n\n## Summary\n- DLVFEE rests on a file {src:${SRC_X}}\n`,
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(
    X,
    {
      id: "dlv-gates",
      type: "topic",
      title: "DLV Gates",
      markdown: [
        "# DLV Gates",
        "",
        "## Summary",
        // Links toward the other brain (same id, brain-qualified), a hidden page of this brain, a Global link.
        "- DLVFEE gate review is weekly [[qzy-pricing]] and [[c_bid:qzy-pricing]] and [[dlv-hidden]] and [[global:company-method-iso]]",
        "- The owner signs the checklist",
        "",
      ].join("\n"),
    },
    "TEAM_RESTRICTED",
  );
  // A claim that rests on a record of this brain (an item every member of X can read).
  await plantLabel(ALPHA, X, "iso-rec-dlv", "record", "TEAM_RESTRICTED", "DLV record");
  await plantPage(
    X,
    {
      id: "dlv-cited",
      type: "topic",
      title: "DLV Cited",
      markdown: `# DLV Cited\n\n## Summary\n- DLVFEE cited gate review [[dlv-hidden]] [[qzy-pricing]] {src:iso-rec-dlv}\n`,
    },
    "TEAM_RESTRICTED",
  );
  const px = await as("consultant", `/v1/wiki/${X}/propose`, {
    email: "iso.cons2@example.invalid",
    body: {
      title: "DLV proposal",
      markdown: "# DLV proposal\n\n## Summary\n- DLVFEE may change\n",
    },
  });
  expect(px.status, await px.clone().text()).toBe(201);

  // ---- Company Global: the one shared path (two distinct approvers) ----
  const core = wsOf(ALPHA, "global");
  await core.wikiTouch(ALPHA, "global", Date.now());
  const made = await core.wikiPropose(
    {
      kind: "wiki_ingest",
      title: "Plant Company method ISO",
      rationale: "test",
      origin: "human",
      pages: [
        {
          pageId: "company-method-iso",
          type: "method",
          title: "Company method ISO",
          baseRevision: null,
          markdown:
            "# Company method ISO\n\n## Summary\n- QZGLOBAL every brain follows this method [[dlv-gates]] [[qzy-pricing]]\n",
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
    "u_planter",
    Date.now(),
    { plane: "GLOBAL_NONPERSONAL" },
  );
  if (!made.ok || !made.created) throw new Error(JSON.stringify(made));
  const hash = (await core.wikiProposalView(made.id))?.revisionHash;
  for (const who of ["u_check1", "u_check2"]) {
    const d = await core.wikiDecide(made.id, "approve", who, Date.now(), { revisionHash: hash });
    if (!d.ok) throw new Error(JSON.stringify(d));
  }
});

const get = (persona: string, email: string, path: string, o: Loose = {}) =>
  as(persona, path, { email, ...o });

/** Every read surface a reader has, as text. `ws` is the other brain's id. */
async function surfaces(persona: string, email: string, other: string, token: string) {
  const out: Record<string, string> = {};
  const grab = async (name: string, path: string, o: Loose = {}) => {
    out[name] = await (await get(persona, email, path, o)).text();
  };
  await grab("search all", `/v1/wiki/all/search?q=${token}`);
  await grab("ask all (wiki)", `/v1/wiki/all/ask?q=${token}%20fee`);
  await grab("nodes search", `/v1/search?q=${token}`);
  await grab("tree", "/v1/brain/tree");
  await grab("tree company", "/v1/brain/tree?root=company");
  await grab("activity", "/v1/activity");
  await grab("questions", "/v1/questions");
  await grab("review", "/v1/review");
  await grab("health", "/v1/wiki/health");
  await grab("directory", "/v1/brains");
  await grab("directory all", "/v1/brains?scope=all");
  await grab("nav", "/v1/brains/nav");
  await grab("map", "/v1/map?lens=departments");
  await grab("node", `/v1/nodes/${other}`);
  await grab("usage", "/v1/usage");
  await grab("asksuggestions", "/v1/ask/suggestions");
  out["ask stream"] = await (
    await get(persona, email, "/v1/ask", { body: { q: `${token} fee` } })
  ).text();
  return out;
}

describe("a reader of X, not of Y", () => {
  it("nothing from Y comes back on any surface, and the Y brain is 404 like a brain that is not there", async () => {
    const s = await surfaces("consultant", A, Y, "QZYFEE");
    for (const [name, body] of Object.entries(s))
      for (const word of Y_CANARIES) expect(body, `${name}: ${word}`).not.toContain(word);
    // The brain itself: every route answers exactly as for an id that does not exist.
    for (const path of [
      "index",
      "pages/qzy-pricing",
      "pages/qzy-pricing/history",
      "search?q=QZYFEE",
      "ask?q=QZYFEE",
      "facts",
      "log",
      "proposals",
      "proposals/cand:c_bid:00000000",
    ]) {
      const real = await get("consultant", A, `/v1/wiki/${Y}/${path}`);
      const none = await get("consultant", A, `/v1/wiki/c_nonexistent/${path}`);
      expect(real.status, path).toBe(404);
      expect(await real.text(), path).toBe(await none.text());
    }
    for (const path of [
      "",
      "/access",
      "/guide",
      "/fields",
      "/journal",
      "/pages/qzy-pricing/versions",
    ]) {
      const real = await get("consultant", A, `/v1/brains/${Y}${path}`);
      const none = await get("consultant", A, `/v1/brains/c_nonexistent${path}`);
      expect(real.status, path).toBe(404);
      expect(await real.text(), path).toBe(await none.text());
    }
    const real = await get("consultant", A, `/v1/brain/export?workspaceId=${Y}`);
    const none = await get("consultant", A, "/v1/brain/export?workspaceId=c_nonexistent");
    expect(real.status).toBe(404);
    expect(await real.text()).toBe(await none.text());
  });

  it("the reader's own brain answers: the control that makes the sweep above meaningful", async () => {
    const hits = (await json<Loose>(await get("consultant", A, "/v1/wiki/all/search?q=DLVFEE")))
      .results as Loose[];
    expect(hits.map((h) => h.pageId)).toContain("dlv-gates");
    expect(hits.every((h) => h.ws === X || h.ws === "core")).toBe(true);
    const ev = await sseOf(
      await get("consultant", A, "/v1/ask", { body: { q: "DLVFEE cited gate review" } }),
    );
    expect(ev.find((e) => e.event === "citation")?.data).toMatchObject({
      pageId: "dlv-cited",
      workspaceId: X,
    });
  });

  it("citations: a page resting on a file whose gate is outside the view is gone, with its claims", async () => {
    const page = await get("consultant", A, `/v1/wiki/${X}/pages/dlv-hidden`);
    expect(page.status).toBe(404);
    const all = JSON.stringify(
      await json(await get("consultant", A, "/v1/wiki/all/search?q=DLVFEE")),
    );
    expect(all).not.toContain("dlv-hidden");
    expect(all).not.toContain("DLV file");
    // The file is not even named in the page the reader can read (its citation is dropped).
    expect(
      JSON.stringify(await json(await get("consultant", A, `/v1/wiki/${X}/pages/dlv-gates`))),
    ).not.toContain("DLV file");
    // Even a connector that says yes cannot widen it: the gate is not in the view.
    const yes = await get("consultant", A, `/v1/wiki/${X}/pages/dlv-hidden`, { env: allow });
    expect(yes.status).toBe(404);
  });

  it("page links: toward Y or a hidden page, nothing is named; toward Global, the link stays", async () => {
    const page = await json<Loose>(await get("consultant", A, `/v1/wiki/${X}/pages/dlv-gates`));
    // Brain-qualified link toward another brain: removed. A hidden page of this brain: removed.
    expect(page.markdown).not.toContain("c_bid");
    expect(page.markdown).not.toContain("dlv-hidden");
    expect(page.links.map((l: Loose) => l.id)).not.toContain("c_bid:qzy-pricing");
    expect(page.links.map((l: Loose) => l.id)).not.toContain("dlv-hidden");
    // The id the author typed for a page that is not in this brain is a broken link, never Y's title.
    const stub = page.links.find((l: Loose) => l.id === "qzy-pricing");
    expect(stub).toMatchObject({ broken: true, title: "qzy-pricing" });
    expect(JSON.stringify(page)).not.toContain("QZY Pricing");
    // Company Global is the one way across.
    expect(page.links).toContainEqual(
      expect.objectContaining({ id: "global:company-method-iso", local: false }),
    );
    expect(page.markdown).toContain("[[global:company-method-iso]]");
  });

  it("page links in search lines, ask answers and index summaries show no hidden page or other brain", async () => {
    const search = JSON.stringify(
      await json(await get("consultant", A, "/v1/wiki/all/search?q=DLVFEE")),
    );
    const ask = await (
      await get("consultant", A, "/v1/ask", { body: { q: "DLVFEE cited gate review" } })
    ).text();
    const idx = JSON.stringify(await json(await get("consultant", A, `/v1/wiki/${X}/index`)));
    for (const [name, body] of [
      ["search", search],
      ["ask", ask],
      ["index", idx],
    ] as const) {
      expect(body, name).not.toContain("c_bid:");
      expect(body, name).not.toContain("dlv-hidden");
      expect(body, name).not.toContain("DLV Hidden");
    }
  });

  it("recent changes and Waiting for you list only X: the Y proposal and pages are not there", async () => {
    const home = await json<Loose>(await get("consultant", A, `/v1/brains/${X}`));
    const titles = home.changedThisWeek.items.map((i: Loose) => i.title);
    expect(titles).toContain("DLV Gates");
    expect(titles).not.toContain("DLV Hidden note");
    expect(JSON.stringify(home)).not.toMatch(/QZY/);
    const qs = JSON.stringify(await json(await get("consultant", A, "/v1/questions")));
    expect(qs).not.toContain("QZY");
    const act = JSON.stringify(await json(await get("consultant", A, "/v1/activity")));
    expect(act).not.toContain("QZY");
  });

  it("the nav, directory and scope=all name no brain the reader cannot open or see", async () => {
    const nav = await json<Loose>(await get("consultant", A, "/v1/brains/nav"));
    expect(nav.items.map((i: Loose) => i.id)).toEqual(["me", X, "core"]);
    for (const path of ["/v1/brains", "/v1/brains?scope=all"]) {
      const d = JSON.stringify(await json(await get("consultant", A, path)));
      expect(d, path).not.toContain(`"${Y}"`);
      expect(d, path).not.toContain("Bid & Pre-sales");
    }
  });

  it("the export of an admitted brain carries nothing from another", async () => {
    const r = await get("consultant", A, `/v1/brain/export?workspaceId=${X}`);
    expect(r.status).toBe(200);
    const files = unzip(new Uint8Array(await r.arrayBuffer()));
    const all = [...files.values()].join("\n");
    for (const word of Y_CANARIES) expect(all).not.toContain(word);
    expect(all).not.toContain("DLV Hidden");
    expect(all).not.toContain("dlv-hidden");
    expect(all).not.toContain("c_bid:");
  });

  it("a reviewer's proposal view and Waiting-for-you diff do not name a hidden page by its link", async () => {
    const md = [
      "# DLV Gates",
      "",
      "## Summary",
      "- DLVFEE gate review is weekly [[qzy-pricing]] and [[dlv-hidden]] and [[global:company-method-iso]]",
      "- The owner and the lead sign the checklist",
      "",
    ].join("\n");
    const made = await as("consultant", `/v1/wiki/${X}/propose`, {
      email: "iso.cons4@example.invalid",
      body: { title: "DLV Gates", pageId: "dlv-gates", markdown: md },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const id = ((await made.json()) as Loose).proposalId;
    const view = await as("reviewer", `/v1/wiki/${X}/proposals/${id}`, {
      email: "iso.rev@example.invalid",
    });
    expect(view.status).toBe(200);
    const text = await view.text();
    expect(text).not.toContain("dlv-hidden");
    expect(text).toContain("The owner and the lead sign");
    const qs = JSON.stringify(
      await json(await as("reviewer", "/v1/questions", { email: "iso.rev@example.invalid" })),
    );
    expect(qs).toContain("DLV Gates");
    expect(qs).not.toContain("dlv-hidden");
  });

  it("history diffs of a readable page do not name a hidden page by its link", async () => {
    const hist = await get("consultant", A, `/v1/wiki/${X}/pages/dlv-gates/history`);
    expect(hist.status).toBe(200);
    const text = await hist.text();
    expect(text).not.toContain("dlv-hidden");
    expect(text).not.toContain("c_bid:");
  });
});

describe("the reverse: a reader of Y, not of X", () => {
  it("nothing from X comes back, and Y answers", async () => {
    const s = await surfaces("head_bid", B, X, "DLVFEE");
    for (const [name, body] of Object.entries(s))
      for (const word of X_CANARIES) expect(body, `${name}: ${word}`).not.toContain(word);
    const hits = (await json<Loose>(await get("head_bid", B, "/v1/wiki/all/search?q=QZYFEE")))
      .results as Loose[];
    expect(hits.map((h) => h.pageId)).toContain("qzy-pricing");
    expect(hits.map((h) => h.pageId)).not.toContain("qzy-source-page");
    expect((await get("head_bid", B, `/v1/wiki/${X}/pages/dlv-gates`)).status).toBe(404);
    const ask = await (
      await get("head_bid", B, "/v1/ask", { body: { q: "DLVFEE gate review" } })
    ).text();
    expect(ask).not.toContain("DLV");
  });

  it("the Global page is the same for both, and its links toward either brain name nothing", async () => {
    for (const [p, e] of [
      ["consultant", A],
      ["head_bid", B],
    ] as const) {
      const hits = (await json<Loose>(await get(p, e, "/v1/wiki/all/search?q=QZGLOBAL")))
        .results as Loose[];
      expect(
        hits.map((h) => h.ws),
        p,
      ).toContain("core");
      const page = await json<Loose>(await get(p, e, "/v1/wiki/core/pages/company-method-iso"));
      const text = JSON.stringify(page);
      // An id of another brain in a Global page is a broken link, never the other brain's title.
      expect(text, p).not.toContain("DLV Gates");
      expect(text, p).not.toContain("QZY Pricing");
    }
  });
});
