// v8: page lens, Who knows, faceted search, saved searches and pulse. Nothing from a brain the caller
// cannot read appears in the graph, backlinks, people, search or pulse, and an opt-out is honoured.

import { beforeAll, describe, expect, it } from "vitest";
import { parseFresh, parseQuery } from "../src/search2/query.ts";
import { ALPHA, as, json, type Loose, plantLabel, seed, wsOf } from "./helpers.ts";
import { meId } from "./uxv2-helpers.ts";

const X = "c_delivery"; // the consultant reads it
const Y = "c_bid"; // the consultant does not; the Head of Bid does
const CONSULTANT = "v8l.consultant@example.invalid";
const HEADBID = "v8l.headbid@example.invalid";
const ACME = "v8l.acme@example.invalid";
const CEO = "v8l.ceo@example.invalid";

const SRC_HIDDEN = `src:abcdef:${"v8lh".padEnd(24, "0")}`;
const hiddenSource = {
  id: SRC_HIDDEN,
  sourceId: "abcdef",
  gateNodeId: "c_bid",
  plane: "TEAM_RESTRICTED",
  title: "V8L hidden file.md",
  body: "x",
  webUrl: null,
  mime: "text/markdown",
  size: 1,
  eTag: "e1",
  syncedAt: Date.now(),
};

type PageIn = { id: string; type: string; title: string; markdown: string };

/** Plants a published page written by `author` and approved by someone else. */
async function plantBy(scope: string, page: PageIn, author: string, plane = "TEAM_RESTRICTED") {
  const ws = wsOf(ALPHA, scope);
  await ws.wikiTouch(ALPHA, scope, Date.now());
  const made = await ws.wikiPropose(
    {
      kind: "wiki_ingest",
      title: `Plant ${page.title}`,
      rationale: "test",
      origin: "human",
      pages: [
        {
          pageId: page.id,
          type: page.type,
          title: page.title,
          baseRevision: null,
          markdown: page.markdown,
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
    author,
    Date.now(),
    { plane },
  );
  if (!made.ok || !made.created) throw new Error(`plant failed: ${JSON.stringify(made)}`);
  const view = await ws.wikiProposalView(made.id);
  const res = await ws.wikiDecide(made.id, "approve", "u_checker", Date.now(), {
    revisionHash: view?.revisionHash,
  });
  if (!res.ok) throw new Error(`plant approve failed: ${JSON.stringify(res)}`);
}

const get = (persona: string, email: string, path: string) => as(persona, path, { email });
const lens = (persona: string, email: string, brain: string, pid: string) =>
  get(persona, email, `/v1/brains/${brain}/pages/${pid}/lens`);
const find = (persona: string, email: string, q: string) =>
  get(persona, email, `/v1/search/pages?q=${encodeURIComponent(q)}`);
const listed = (persona: string, email: string, on: boolean) =>
  as(persona, "/v1/me/expert-listing", { email, method: "PUT", body: { listed: on } });

let consultantId = "";
let headBidId = "";
let acmeId = "";
const ids = (rows: Loose[]): string[] => rows.map((r) => r.id as string);

beforeAll(async () => {
  await seed();
  consultantId = await meId("consultant", { email: CONSULTANT });
  headBidId = await meId("head_bid", { email: HEADBID });
  acmeId = await meId("acme_lead", { email: ACME });

  await wsOf(ALPHA, X).wikiTouch(ALPHA, X, Date.now());
  await wsOf(ALPHA, X).sourceUpsert([hiddenSource]);
  await plantLabel(ALPHA, X, "v8-rec", "record", "TEAM_RESTRICTED", "V8 record");

  // A small web in the delivery brain: gates -> checklist -> playbook, retro <-> gates.
  await plantBy(
    X,
    {
      id: "v8-gates",
      type: "topic",
      title: "Gate reviews",
      markdown:
        "# Gate reviews\n\n## Summary\n- Gates run weekly, see [[v8-checklist]]\n- Retros feed back, see [[v8-retro-link]]\n",
    },
    headBidId,
  );
  await plantBy(
    X,
    {
      id: "v8-checklist",
      type: "method",
      title: "Delivery checklist",
      markdown:
        "# Delivery checklist\n\n## Summary\n- Check scope before a gate, then [[v8-playbook]]\n\n## Steps\n- One\n",
    },
    acmeId,
  );
  await plantBy(
    X,
    {
      id: "v8-playbook",
      type: "method",
      title: "Delivery playbook",
      markdown: "# Delivery playbook\n\n## Summary\n- The playbook\n\n## Steps\n- Two\n",
    },
    acmeId,
  );
  await plantBy(
    X,
    {
      id: "v8-retro-link",
      type: "topic",
      title: "Retro notes",
      markdown: "# Retro notes\n\n## Summary\n- Notes about [[v8-gates]]\n",
    },
    consultantId,
  );
  // A page that links to the gates page but rests only on a file the consultant cannot read.
  await plantBy(
    X,
    {
      id: "v8-secret-backlink",
      type: "topic",
      title: "V8SECRETLINK page",
      markdown: `# V8SECRETLINK page\n\n## Summary\n- Links [[v8-gates]] {src:${SRC_HIDDEN}}\n`,
    },
    headBidId,
  );
  // A visible page with one line that rests on the unreadable file.
  await plantBy(
    X,
    {
      id: "v8-mixed",
      type: "topic",
      title: "Mixed page",
      markdown: `# Mixed page\n\n## Summary\n- Visible line about pricing {src:v8-rec}\n- Hidden zebra links [[v8-playbook]] {src:${SRC_HIDDEN}}\n- Plain link [[v8-gates]] {src:v8-rec}\n`,
    },
    consultantId,
  );

  // The bid brain, which the consultant cannot read, and Company Global.
  await plantBy(
    Y,
    {
      id: "v8y-pricing",
      type: "topic",
      title: "V8YCANARY Pricing",
      markdown: "# V8YCANARY Pricing\n\n## Summary\n- V8YFEE pricing is fixed\n",
    },
    headBidId,
  );
  await plantBy(
    Y,
    {
      id: "v8y-link",
      type: "topic",
      title: "V8YCANARY global link",
      markdown:
        "# V8YCANARY global link\n\n## Summary\n- Uses [[global:v8-core-page]] for pricing\n",
    },
    headBidId,
  );
  await plantBy(
    "global",
    {
      id: "v8-core-page",
      type: "topic",
      title: "Core pricing principles",
      markdown:
        "# Core pricing principles\n\n## Summary\n- Principles for pricing and gates [[v8-core-other]]\n",
    },
    headBidId,
    "CORE",
  );
  await plantBy(
    "global",
    {
      id: "v8-core-other",
      type: "topic",
      title: "Core other",
      markdown: "# Core other\n\n## Summary\n- Other\n",
    },
    headBidId,
    "CORE",
  );
  await plantBy(
    X,
    {
      id: "v8-to-core",
      type: "topic",
      title: "Delivery pricing",
      markdown: "# Delivery pricing\n\n## Summary\n- Pricing sits on [[global:v8-core-page]]\n",
    },
    acmeId,
  );
});

describe("query language (pure)", () => {
  it("reads operators and leaves the words", () => {
    const p = parseQuery(
      "gate review brain:c_bid type:method fresh:<30d status:verified role:editor",
    );
    expect(p.text).toBe("gate review");
    expect(p.brain).toEqual(["c_bid"]);
    expect(p.type).toEqual(["method"]);
    expect(p.fresh).toEqual({ op: "lt", days: 30 });
    expect(p.status).toEqual(["verified"]);
    expect(p.role).toEqual(["editor"]);
  });

  it("keeps unknown or malformed operators as words", () => {
    const p = parseQuery("fresh:soon type:meth;od status:bogus colour:red brain:a/b");
    expect(p.fresh).toBeNull();
    expect(p.type).toEqual([]);
    expect(p.status).toEqual([]);
    expect(p.brain).toEqual([]);
    expect(p.ignored.length).toBe(4);
    expect(p.text).toContain("colour:red");
  });

  it("a quoted run stays one word", () => {
    const p = parseQuery('"gate review" type:method');
    expect(p.text).toBe("gate review");
    expect(p.type).toEqual(["method"]);
  });

  it("never throws, whatever the input, and caps what it reads", () => {
    for (const q of [
      "",
      "   ",
      ":",
      "brain:",
      "fresh:<",
      '"""',
      "\u0000brain:x",
      "a".repeat(5000),
      `type:${"x".repeat(500)}`,
      "brain:\u{1F642}",
    ]) {
      expect(typeof parseQuery(q).text).toBe("string");
    }
    const many = parseQuery(Array.from({ length: 40 }, (_, i) => `type:t${i}`).join(" "));
    expect(many.type.length).toBe(8);
  });

  it("the age grammar is bounded", () => {
    expect(parseFresh("<30d")).toEqual({ op: "lt", days: 30 });
    expect(parseFresh(">2w")).toEqual({ op: "gt", days: 14 });
    expect(parseFresh("1y")).toEqual({ op: "lt", days: 365 });
    expect(parseFresh("<0d")).toBeNull();
    expect(parseFresh("<99999d")).toBeNull();
    expect(parseFresh("<30x")).toBeNull();
    expect(parseFresh("<-3d")).toBeNull();
  });
});

describe("page lens", () => {
  it("answers the contract shape, no-store, for a reader", async () => {
    const res = await lens("consultant", CONSULTANT, X, "v8-gates");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await json<Loose>(res);
    expect(Object.keys(b).sort()).toEqual(
      [
        "backlinks",
        "contributors",
        "facts",
        "freshness",
        "graph",
        "page",
        "unnamed",
        "verified",
        "who",
      ].sort(),
    );
    expect(b.page).toMatchObject({ id: "v8-gates", brainId: X, status: "published" });
    expect(["fresh", "aging", "stale"]).toContain(b.freshness.state);
    expect(b.graph.nodes.find((n: Loose) => n.hop === 0).id).toBe("v8-gates");
  });

  it("draws one and two hops, with edges between known nodes only", async () => {
    const b = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-gates"));
    const hop = (n: number) =>
      b.graph.nodes.filter((x: Loose) => x.hop === n).map((x: Loose) => x.id);
    expect(hop(1)).toEqual(expect.arrayContaining(["v8-checklist", "v8-retro-link"]));
    expect(hop(2)).toContain("v8-playbook");
    const keys = new Set(b.graph.nodes.map((n: Loose) => n.key));
    expect(b.graph.edges.length).toBeGreaterThan(0);
    for (const e of b.graph.edges) {
      expect(keys.has(e.from)).toBe(true);
      expect(keys.has(e.to)).toBe(true);
    }
  });

  it("leaves out a page whose only source is unreadable, and a link on a line the caller cannot read", async () => {
    const b = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-gates"));
    const text = JSON.stringify(b);
    expect(text).not.toContain("V8SECRETLINK");
    expect(text).not.toContain("v8-secret-backlink");
    expect(ids(b.backlinks)).toContain("v8-mixed");
    // The hidden line of Mixed page links to the playbook; that link is not the consultant's to see.
    const mixed = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-mixed"));
    const keyOf = (id: string) => mixed.graph.nodes.find((n: Loose) => n.id === id)?.key;
    const direct = mixed.graph.edges.filter(
      (e: Loose) => e.from === keyOf("v8-mixed") && e.to === keyOf("v8-playbook"),
    );
    expect(direct).toEqual([]);
  });

  it("404 for a page the caller cannot read, in a brain they cannot read, or that does not exist", async () => {
    expect((await lens("consultant", CONSULTANT, X, "v8-secret-backlink")).status).toBe(404);
    expect((await lens("consultant", CONSULTANT, Y, "v8y-pricing")).status).toBe(404);
    expect((await lens("consultant", CONSULTANT, X, "v8-nope")).status).toBe(404);
    expect((await lens("consultant", CONSULTANT, X, "Bad%20Id")).status).toBe(404);
    expect((await lens("head_bid", HEADBID, Y, "v8y-pricing")).status).toBe(200);
  });

  it("a Company Global page lists backlinks from readable brains only", async () => {
    const asConsultant = await json<Loose>(
      await lens("consultant", CONSULTANT, "core", "v8-core-page"),
    );
    expect(ids(asConsultant.backlinks)).toContain("v8-to-core");
    expect(JSON.stringify(asConsultant)).not.toContain("V8YCANARY");
    expect(ids(asConsultant.backlinks)).not.toContain("v8y-link");
    expect(asConsultant.graph.nodes.map((n: Loose) => n.brainId)).not.toContain(Y);
    const asBid = await json<Loose>(await lens("head_bid", HEADBID, "core", "v8-core-page"));
    expect(ids(asBid.backlinks)).toContain("v8y-link");
    expect(asBid.graph.nodes.map((n: Loose) => `${n.brainId}:${n.id}`)).toContain(`${Y}:v8y-link`);
  });

  it("a link toward Company Global draws the global page for someone who reads it", async () => {
    const b = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-to-core"));
    expect(b.graph.nodes.map((n: Loose) => `${n.brainId}:${n.id}`)).toContain("core:v8-core-page");
  });

  it("names contributors with roles, and not a person who opted out", async () => {
    const before = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-checklist"));
    expect(ids(before.contributors)).toContain(acmeId);
    expect(before.contributors[0]).toHaveProperty("role");
    expect((await listed("acme_lead", ACME, false)).status).toBe(200);
    const after = await json<Loose>(await lens("consultant", CONSULTANT, X, "v8-checklist"));
    expect(ids(after.contributors)).not.toContain(acmeId);
    expect(JSON.stringify(after)).not.toContain(acmeId);
    expect(after.unnamed).toBeGreaterThanOrEqual(1);
    const on = await json<Loose>(await listed("acme_lead", ACME, true));
    expect(on.listed).toBe(true);
  });
});

describe("expert listing choice", () => {
  it("is private, validated and defaults to listed", async () => {
    const g = await json<Loose>(
      await get("reviewer", "v8l.reviewer@example.invalid", "/v1/me/expert-listing"),
    );
    expect(g.listed).toBe(true);
    const bad = await as("reviewer", "/v1/me/expert-listing", {
      email: "v8l.reviewer@example.invalid",
      method: "PUT",
      body: { listed: "no" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("Who knows", () => {
  it("ranks approved contributions inside a brain the caller reads", async () => {
    const res = await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?collection=method`);
    expect(res.status).toBe(200);
    const b = await json<Loose>(res);
    expect(b.scope.kind).toBe("collection");
    expect(ids(b.people)[0]).toBe(acmeId);
    expect(b.people[0]).toMatchObject({
      brainId: X,
      role: expect.any(String),
      contributions: 2,
      pages: 2,
    });
  });

  it("works for a page and its neighbours, and for a question", async () => {
    const byPage = await json<Loose>(
      await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?page=v8-gates`),
    );
    expect(byPage.scope.kind).toBe("page");
    expect(ids(byPage.people)).toEqual(expect.arrayContaining([headBidId, acmeId]));
    const byQ = await json<Loose>(
      await get(
        "consultant",
        CONSULTANT,
        `/v1/who-knows?q=${encodeURIComponent("delivery checklist")}`,
      ),
    );
    expect(ids(byQ.people)).toContain(acmeId);
  });

  it("never lists people from a brain the caller cannot read", async () => {
    expect(
      (await get("consultant", CONSULTANT, `/v1/brains/${Y}/who-knows?collection=topic`)).status,
    ).toBe(404);
    const across = await json<Loose>(
      await get("consultant", CONSULTANT, "/v1/who-knows?q=V8YFEE+pricing"),
    );
    expect(JSON.stringify(across.people)).not.toContain("V8Y");
    expect(across.people.map((p: Loose) => p.brainId)).not.toContain(Y);
    const bid = await json<Loose>(
      await get("head_bid", HEADBID, `/v1/who-knows?q=V8YFEE&brain=${Y}`),
    );
    expect(bid.people.map((p: Loose) => p.brainId)).toContain(Y);
  });

  it("does not let a page the caller cannot read stand in for a match", async () => {
    const q = await json<Loose>(
      await get("consultant", CONSULTANT, "/v1/who-knows?q=V8SECRETLINK"),
    );
    expect(q.people).toEqual([]);
  });

  it("drops anyone who opted out, whole, from every Who knows answer", async () => {
    await listed("acme_lead", ACME, false);
    const col = await json<Loose>(
      await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?collection=method`),
    );
    expect(JSON.stringify(col)).not.toContain(acmeId);
    const q = await json<Loose>(
      await get(
        "consultant",
        CONSULTANT,
        `/v1/who-knows?q=${encodeURIComponent("delivery checklist")}`,
      ),
    );
    expect(JSON.stringify(q)).not.toContain(acmeId);
    const pg = await json<Loose>(
      await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?page=v8-gates`),
    );
    expect(JSON.stringify(pg)).not.toContain(acmeId);
    await listed("acme_lead", ACME, true);
    const back = await json<Loose>(
      await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?collection=method`),
    );
    expect(ids(back.people)).toContain(acmeId);
  });

  it("never reads a Personal Brain, even the caller's own", async () => {
    await plantBy(
      `personal:${consultantId}`,
      {
        id: "v8-mine",
        type: "topic",
        title: "V8MINE personal note",
        markdown: "# V8MINE personal note\n\n## Summary\n- V8MINE text\n",
      },
      consultantId,
      "PERSONAL_HOSTED",
    );
    const res = await json<Loose>(await get("consultant", CONSULTANT, "/v1/who-knows?q=V8MINE"));
    expect(res.people).toEqual([]);
  });

  it("validates its input", async () => {
    expect((await get("consultant", CONSULTANT, "/v1/who-knows")).status).toBe(400);
    expect((await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?limit=99`)).status).toBe(
      400,
    );
    expect(
      (await get("consultant", CONSULTANT, `/v1/brains/${X}/who-knows?page=Bad%20Id`)).status,
    ).toBe(400);
  });
});

describe("faceted search", () => {
  it("finds readable pages with a preview and counts them in facets", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, "checklist"));
    expect(ids(b.results)).toContain("v8-checklist");
    const hit = b.results.find((r: Loose) => r.id === "v8-checklist");
    expect(hit).toMatchObject({ brainId: X, type: "method" });
    expect(hit.lines.length).toBeGreaterThan(0);
    expect(b.facets.brain.find((f: Loose) => f.id === X).n).toBeGreaterThan(0);
    expect(Object.keys(b.facets).sort()).toEqual(["brain", "fresh", "role", "status", "type"]);
  });

  it("applies operators, and facet counts leave their own filter out", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, "delivery type:method"));
    expect(b.results.length).toBeGreaterThan(0);
    expect(b.results.every((r: Loose) => r.type === "method")).toBe(true);
    expect(b.parsed.type).toEqual(["method"]);
    expect(ids(b.facets.type)).toEqual(expect.arrayContaining(["method", "topic"]));
    expect(b.facets.type.find((f: Loose) => f.id === "method").on).toBe(true);
    const fresh = await json<Loose>(await find("consultant", CONSULTANT, "delivery fresh:<30d"));
    expect(fresh.results.length).toBeGreaterThan(0);
    const old = await json<Loose>(await find("consultant", CONSULTANT, "delivery fresh:>30d"));
    expect(old.results).toEqual([]);
  });

  it("browses by operator alone, and answers nothing for no words and no operators", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, `brain:${X} type:method`));
    expect(ids(b.results)).toEqual(expect.arrayContaining(["v8-checklist", "v8-playbook"]));
    const none = await json<Loose>(await find("consultant", CONSULTANT, ""));
    expect(none.results).toEqual([]);
  });

  it("never returns or counts anything from a brain the caller cannot read", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, "V8YCANARY"));
    expect(b.results).toEqual([]);
    expect(JSON.stringify(b.facets)).not.toContain("V8Y");
    const viaOp = await json<Loose>(await find("consultant", CONSULTANT, `brain:${Y} pricing`));
    expect(viaOp.results).toEqual([]);
    expect(JSON.stringify(viaOp.facets)).not.toContain(Y);
    const browse = await json<Loose>(await find("consultant", CONSULTANT, `brain:${Y}`));
    expect(browse.results).toEqual([]);
    const secret = await json<Loose>(await find("consultant", CONSULTANT, "V8SECRETLINK"));
    expect(secret.results).toEqual([]);
    const all = await json<Loose>(await find("consultant", CONSULTANT, "pricing"));
    expect(ids(all.facets.brain)).not.toContain(Y);
    const bid = await json<Loose>(await find("head_bid", HEADBID, "V8YCANARY"));
    expect(ids(bid.results)).toContain("v8y-pricing");
  });

  it("does not match on a line the caller cannot read, and snippets carry no links or tokens", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, "zebra"));
    expect(ids(b.results)).not.toContain("v8-mixed");
    const g = await json<Loose>(await find("consultant", CONSULTANT, "gates run weekly"));
    const snippet = JSON.stringify(g.results);
    expect(snippet).not.toContain("[[");
    expect(snippet).not.toContain("{src:");
  });

  it("treats hostile operators as words and never fails on them", async () => {
    for (const q of [
      "brain:'; DROP TABLE wiki_pages;--",
      'type:" OR 1=1',
      "fresh:<9999999999999999d checklist",
      "role:../../etc",
      "status:verified status:unverified checklist",
      `${"a ".repeat(100)}type:method`,
      "NEAR( OR AND NOT ) *",
      '"unterminated checklist',
    ]) {
      const res = await find("consultant", CONSULTANT, q);
      expect(res.status, q).toBe(200);
    }
    expect((await find("consultant", CONSULTANT, "x".repeat(400))).status).toBe(400);
  });

  it("filters by author role and status, and carries them on each result", async () => {
    const b = await json<Loose>(await find("consultant", CONSULTANT, "delivery checklist"));
    const hit = b.results.find((r: Loose) => r.id === "v8-checklist");
    expect(["owner", "steward", "editor", "contributor", "reader"]).toContain(hit.role);
    expect(["verified", "unverified"]).toContain(hit.status);
    const byRole = await json<Loose>(
      await find("consultant", CONSULTANT, `delivery role:${hit.role}`),
    );
    expect(byRole.results.length).toBeGreaterThan(0);
    expect(byRole.results.every((r: Loose) => r.role === hit.role)).toBe(true);
    const ver = await json<Loose>(await find("consultant", CONSULTANT, "delivery status:verified"));
    expect(ver.results.every((r: Loose) => r.status === "verified")).toBe(true);
  });
});

describe("saved searches", () => {
  it("are the person's own, deduplicated, bounded and removable", async () => {
    const post = (persona: string, email: string, body: Loose) =>
      as(persona, "/v1/search/saved", { email, method: "POST", body });
    expect(
      (await post("consultant", CONSULTANT, { name: "My methods", q: "type:method delivery" }))
        .status,
    ).toBe(201);
    expect(
      (await post("consultant", CONSULTANT, { name: "Renamed", q: "type:method delivery" })).status,
    ).toBe(201);
    const list = await json<Loose>(await get("consultant", CONSULTANT, "/v1/search/saved"));
    expect(list.saved.length).toBe(1);
    expect(list.saved[0]).toMatchObject({ name: "Renamed", q: "type:method delivery" });
    const other = await json<Loose>(await get("head_bid", HEADBID, "/v1/search/saved"));
    expect(other.saved).toEqual([]);
    expect((await post("consultant", CONSULTANT, { name: "", q: "x" })).status).toBe(400);
    const id = list.saved[0].id as string;
    expect(
      (await as("head_bid", `/v1/search/saved/${id}`, { email: HEADBID, method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (await as("consultant", `/v1/search/saved/${id}`, { email: CONSULTANT, method: "DELETE" }))
        .status,
    ).toBe(200);
    expect(
      (await as("consultant", "/v1/search/saved/bad", { email: CONSULTANT, method: "DELETE" }))
        .status,
    ).toBe(404);
  });
});

describe("pulse", () => {
  const today = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    for (const scope of [X, Y]) await wsOf(ALPHA, scope).brainJournalRun(today, Date.now());
  });

  it("gives a brain its days as counts and links readable pages only", async () => {
    const res = await get("consultant", CONSULTANT, `/v1/brains/${X}/pulse?days=30`);
    expect(res.status).toBe(200);
    const b = await json<Loose>(res);
    expect(b.categories).toEqual(["published", "resolved", "sources", "gaps", "rules"]);
    const day = b.days.find((d: Loose) => d.date === today);
    expect(day.counts.published).toBeGreaterThan(0);
    expect(day.total).toBeGreaterThan(0);
    const pages = ids(day.pages);
    expect(pages).toContain("v8-gates");
    expect(pages).not.toContain("v8-secret-backlink");
    expect(JSON.stringify(b)).not.toContain("V8SECRETLINK");
  });

  it("refuses a brain the caller cannot read, and bad windows", async () => {
    expect((await get("consultant", CONSULTANT, `/v1/brains/${Y}/pulse`)).status).toBe(404);
    expect((await get("consultant", CONSULTANT, `/v1/brains/${X}/pulse?days=2`)).status).toBe(400);
    expect((await get("consultant", CONSULTANT, `/v1/brains/${X}/pulse?days=500`)).status).toBe(
      400,
    );
  });

  it("Home rows exist for readable brains only, each from its own journal", async () => {
    const b = await json<Loose>(await get("consultant", CONSULTANT, "/v1/pulse?days=30"));
    const rows = b.brains.map((r: Loose) => r.brainId);
    expect(rows).toContain(X);
    expect(rows).not.toContain(Y);
    expect(JSON.stringify(b)).not.toContain("V8Y");
    const row = b.brains.find((r: Loose) => r.brainId === X);
    expect(row.days[0].d.length).toBe(5);
    const bid = await json<Loose>(await get("head_bid", HEADBID, "/v1/pulse?days=30"));
    expect(bid.brains.map((r: Loose) => r.brainId)).toContain(Y);
  });
});

describe("the surface is closed to the signed-out", () => {
  it("needs a signed-in person", async () => {
    for (const p of [
      `/v1/brains/${X}/pages/v8-gates/lens`,
      "/v1/search/pages?q=x",
      "/v1/search/saved",
      "/v1/who-knows?q=x",
      "/v1/pulse",
      "/v1/me/expert-listing",
    ])
      expect((await as("consultant", p, { token: null })).status, p).toBe(401);
  });

  it("the CEO's view is their own: rights come from the policy", async () => {
    const b = await json<Loose>(await find("ceo", CEO, "V8YCANARY"));
    expect(Array.isArray(b.results)).toBe(true);
  });
});
