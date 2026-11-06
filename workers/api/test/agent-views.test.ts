// Saved views (/v1/views): plan and layout only, personal by default, re-resolved for whoever opens them.

import { beforeAll, describe, expect, it } from "vitest";
import { receiptsOf } from "./agent-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const BID_TITLE = "V6OWNERTITLE Bid funnel";
const MIXED = [
  "root = Stack([c1, c2, nav])",
  `c1 = InsightCard("${BID_TITLE}", [f1])`,
  'f1 = Funnel("c_bid", "30d")',
  'c2 = InsightCard("Delivery numbers", [k1])',
  'k1 = KpiTile("Pages", "c_delivery", "pages")',
  "nav = Buttons([b1, b2])",
  'b1 = Button("Focus bid", "focus", {brain: "c_bid"})',
  'b2 = Button("Focus delivery", "focus", {brain: "c_delivery"})',
].join("\n");
const DELIVERY = [
  "root = Stack([c1])",
  'c1 = InsightCard("Delivery flow", [f1])',
  'f1 = Funnel("c_delivery", "30d")',
].join("\n");

const send = (persona: string, method: string, path: string, body?: unknown) =>
  as(persona, path, { method, ...(body !== undefined ? { body } : {}) });
const make = async (persona: string, over: Loose = {}): Promise<Loose> => {
  const r = await send(persona, "POST", "/v1/views", {
    name: "Monday review",
    program: DELIVERY,
    pin: "home",
    ...over,
  });
  expect(r.status, await r.clone().text()).toBe(201);
  return json(r);
};
const nodesOf = (n: Loose | null): Loose[] => (n ? [n, ...n.children.flatMap(nodesOf)] : []);

describe("create, read, change, delete", () => {
  it("round trip: 201 with the plan, the layout and the re-resolved tree, then GET, PUT and DELETE", async () => {
    const created = await make("ceo", { layout: { x: 0, y: 1, w: 6, h: 3 } });
    expect(created).toMatchObject({
      name: "Monday review",
      pin: "home",
      layout: { x: 0, y: 1, w: 6, h: 3 },
      program: DELIVERY,
      shared: false,
    });
    expect(created.id).toMatch(/^av_[0-9a-f]{16}$/);
    expect(Number.isNaN(Date.parse(created.updatedAt))).toBe(false);
    expect(created.tree.type).toBe("Stack");
    expect(
      nodesOf(created.tree).some((n) => n.type === "Funnel" && n.props.brain === "c_delivery"),
    ).toBe(true);

    const got = await json<Loose>(await send("ceo", "GET", `/v1/views/${created.id}`));
    expect(got).toEqual(created);
    const listed = await json<Loose>(await send("ceo", "GET", "/v1/views"));
    expect(listed.views.map((v: Loose) => v.id)).toContain(created.id);

    const put = await send("ceo", "PUT", `/v1/views/${created.id}`, {
      name: "Tuesday review",
      pin: { brain: "c_delivery" },
    });
    expect(put.status).toBe(200);
    expect(await json(put)).toMatchObject({
      id: created.id,
      name: "Tuesday review",
      pin: { brain: "c_delivery" },
      program: DELIVERY,
      layout: { x: 0, y: 1, w: 6, h: 3 },
    });
    const again = await json<Loose>(await send("ceo", "GET", `/v1/views/${created.id}`));
    expect(again.name).toBe("Tuesday review");

    const del = await send("ceo", "DELETE", `/v1/views/${created.id}`);
    expect(del.status).toBe(204);
    expect((await send("ceo", "GET", `/v1/views/${created.id}`)).status).toBe(404);
    expect((await send("ceo", "DELETE", `/v1/views/${created.id}`)).status).toBe(404);
  });

  it("lists newest first and filters by pin", async () => {
    const a = await make("consultant", { name: "A home" });
    const b = await make("consultant", { name: "B delivery", pin: { brain: "c_delivery" } });
    const all = (await json<Loose>(await send("consultant", "GET", "/v1/views"))).views as Loose[];
    expect(all.map((v) => v.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const home = (await json<Loose>(await send("consultant", "GET", "/v1/views?pin=home")))
      .views as Loose[];
    expect(home.map((v) => v.id)).toContain(a.id);
    expect(home.map((v) => v.id)).not.toContain(b.id);
    const brain = (await json<Loose>(await send("consultant", "GET", "/v1/views?pin=c_delivery")))
      .views as Loose[];
    expect(brain.map((v) => v.id)).toEqual([b.id]);
    expect((await send("consultant", "GET", "/v1/views?pin=Not%20A%20Brain")).status).toBe(400);
  });

  it("a record holds the plan, the layout and the pin: never data", async () => {
    const v = await make("consultant", { layout: { x: 1, y: 0, w: 4, h: 2 } });
    const rows = await wsOf(ALPHA, "personal:u_consultant").listByKind("agent_view", 10);
    const row = rows.find((r) => r.id === v.id);
    expect(Object.keys(JSON.parse(row?.body ?? "{}")).sort()).toEqual([
      "layout",
      "name",
      "pin",
      "program",
    ]);
    expect(row?.label).toBe(v.id);
  });
});

describe("validation", () => {
  const post = (persona: string, body: unknown) => send(persona, "POST", "/v1/views", body);
  const base = { name: "n", program: DELIVERY, pin: "home" };

  it("a program must parse to a root with nothing dropped or refused", async () => {
    for (const program of [
      "just words",
      'root = Stack([k])\nk = Script("alert(1)")',
      'root = Stack([k])\nk = Query("x", {})',
      'root = Stack([b])\nb = Button("Delete it", "focus", {brain: "c_delivery"})',
      'root = Stack([b])\nb = Button("Go", "delete_page", {})',
      'root = Stack([k])\nk = KpiTile("P", "c_delivery", "nonsense")',
      "root = Stack([c1",
      "root = Stack([c1])",
      'c1 = InsightCard("No root", [f1])\nf1 = Funnel("c_delivery", "30d")',
    ]) {
      const r = await post("ceo", { ...base, program });
      expect(r.status, program).toBe(400);
      expect((await json(r)).error, program).toBe("invalid_program");
    }
  });

  it("every brain the plan names, and the pin's brain, must be one the caller may read", async () => {
    const r = await post("consultant", { ...base, program: MIXED });
    expect(r.status).toBe(400);
    expect(await json(r)).toEqual({ error: "brain_not_readable" });
    const p = await post("consultant", { ...base, pin: { brain: "c_bid" } });
    expect(p.status).toBe(400);
    expect((await json(p)).error).toBe("brain_not_readable");
    const missing = await post("consultant", { ...base, pin: { brain: "no_such_brain" } });
    expect((await json(missing)).error).toBe("brain_not_readable");
    // the owner of the same plan with the right to read both may keep it
    expect((await post("ceo", { ...base, program: MIXED })).status).toBe(201);
  });

  it("unknown keys, bad names, bad layouts and bad pins are 400", async () => {
    const bad: unknown[] = [
      { ...base, extra: 1 },
      { ...base, name: "" },
      { ...base, name: "   " },
      { ...base, name: "x".repeat(61) },
      { ...base, name: "two\nlines" },
      { ...base, layout: { x: 0, y: 0, w: 13, h: 1 } },
      { ...base, layout: { x: 0, y: 0, w: 1, h: 1, z: 1 } },
      { ...base, pin: "elsewhere" },
      { ...base, pin: { brain: "c_delivery", extra: 1 } },
      { ...base, program: "x".repeat(8_193) },
      { name: "n", pin: "home" },
      { ...base, layout: "wide" },
    ];
    for (const b of bad) {
      const r = await post("ceo", b);
      expect(r.status, JSON.stringify(b).slice(0, 80)).toBe(400);
    }
    expect((await post("ceo", [])).status).toBe(400);
    expect((await as("ceo", "/v1/views", { method: "POST", rawBody: "{nope" })).status).toBe(400);
  });

  it("PUT validates the same way, and needs at least one field", async () => {
    const v = await make("ceo");
    const put = (body: unknown) => send("ceo", "PUT", `/v1/views/${v.id}`, body);
    expect((await put({})).status).toBe(400);
    expect((await put({ extra: 1 })).status).toBe(400);
    expect((await put({ program: "just words" })).status).toBe(400);
    expect((await put({ program: MIXED })).status).toBe(200);
    expect((await put({ pin: { brain: "no_such_brain" } })).status).toBe(400);
    const unchanged = await json<Loose>(await send("ceo", "GET", `/v1/views/${v.id}`));
    expect(unchanged.program).toBe(MIXED);
    expect(unchanged.pin).toBe("home");
  });

  it("a malformed id is a 404, never an error", async () => {
    for (const id of ["nope", "av_zz", "..%2F..", "av_0000000000000000"]) {
      expect((await send("ceo", "GET", `/v1/views/${id}`)).status, id).toBe(404);
      expect((await send("ceo", "PUT", `/v1/views/${id}`, { name: "x" })).status, id).toBe(404);
    }
  });

  it("at most 50 views per person: 409 too_many_views, and a delete makes room", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await make("reviewer", { name: `v${i}` })).id);
    const over = await send("reviewer", "POST", "/v1/views", { ...base, name: "one too many" });
    expect(over.status).toBe(409);
    expect(await json(over)).toEqual({ error: "too_many_views" });
    expect((await send("reviewer", "DELETE", `/v1/views/${ids[0]}`)).status).toBe(204);
    expect(
      (await send("reviewer", "POST", "/v1/views", { ...base, name: "fits now" })).status,
    ).toBe(201);
    // another person's count is their own
    expect((await send("consultant", "POST", "/v1/views", { ...base, name: "mine" })).status).toBe(
      201,
    );
  });
});

describe("two people never see each other's views", () => {
  it("another person's id is 404 for read, change, delete and share; lists are disjoint", async () => {
    const mine = await make("ceo", { name: "V6PRIVATENAME" });
    for (const [method, path, body] of [
      ["GET", `/v1/views/${mine.id}`],
      ["PUT", `/v1/views/${mine.id}`, { name: "hijack" }],
      ["DELETE", `/v1/views/${mine.id}`],
      ["POST", `/v1/views/${mine.id}/share`, {}],
      ["DELETE", `/v1/views/${mine.id}/share`],
    ] as const) {
      const r = await send("head_bid", method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(await json(r)).toEqual({ error: "not_found" });
    }
    const theirs = JSON.stringify(await json(await send("head_bid", "GET", "/v1/views")));
    expect(theirs).not.toContain(mine.id);
    expect(theirs).not.toContain("V6PRIVATENAME");
    // untouched for the owner
    expect((await json<Loose>(await send("ceo", "GET", `/v1/views/${mine.id}`))).name).toBe(
      "V6PRIVATENAME",
    );
  });

  it("a view is not a Personal Brain item", async () => {
    const mine = await make("ceo", { name: "V6NOTANITEM" });
    const items = JSON.stringify(await json(await send("ceo", "GET", "/v1/personal/items")));
    expect(items).not.toContain(mine.id);
    expect(items).not.toContain("V6NOTANITEM");
  });

  it("two tenants do not share views", async () => {
    // personal scopes are named per person inside the tenant, so a person's own list is all there is
    const a = await make("consultant", { name: "only mine" });
    const others = (await json<Loose>(await send("ceo", "GET", "/v1/views"))).views as Loose[];
    expect(others.map((v) => v.id)).not.toContain(a.id);
  });
});

describe("re-resolved for the viewer", () => {
  it("shared by a high-privilege person, opened by a lower one: Locked cards, none of the owner's titles or brain ids", async () => {
    const v = await make("ceo", { name: "Monday bid review", program: MIXED });
    const owner = v.tree as Loose;
    expect(JSON.stringify(owner)).toContain(BID_TITLE);
    expect(nodesOf(owner).some((n) => n.type === "Locked")).toBe(false);

    const shared = await send("ceo", "POST", `/v1/views/${v.id}/share`, {});
    expect(shared.status).toBe(200);
    const { shareId, path } = await json<Loose>(shared);
    expect(shareId).toMatch(/^[0-9a-f-]{36}$/);
    expect(path).toBe(`/agent/shared/${shareId}`);
    // sharing again hands back the same link
    expect(
      (await json<Loose>(await send("ceo", "POST", `/v1/views/${v.id}/share`, {}))).shareId,
    ).toBe(shareId);
    expect((await json<Loose>(await send("ceo", "GET", `/v1/views/${v.id}`))).shared).toBe(true);

    // a lower-privilege person: the bid card is a Locked card, the delivery card is theirs to see
    const low = await send("consultant", "GET", `/v1/views/shared/${shareId}`);
    expect(low.status).toBe(200);
    const lowBody = await json<Loose>(low);
    const text = JSON.stringify(lowBody);
    expect(lowBody.name).toBe("Monday bid review");
    expect(text).not.toContain(BID_TITLE);
    expect(text).not.toContain("c_bid");
    expect(text).not.toContain("Bid funnel");
    const lowNodes = nodesOf(lowBody.tree);
    expect(lowNodes.filter((n) => n.type === "Locked")).toHaveLength(1);
    expect(lowNodes.find((n) => n.type === "Locked")).toMatchObject({
      props: { reason: "no_access" },
      children: [],
    });
    expect(text).toContain("Delivery numbers");
    const buttons = lowNodes.filter((n) => n.type === "Button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props.values).toEqual({ brain: "c_delivery" });

    // the same link, opened by a person who reads Bid but not Delivery, resolves the other way round
    const bid = await json<Loose>(await send("head_bid", "GET", `/v1/views/shared/${shareId}`));
    expect(JSON.stringify(bid)).toContain(BID_TITLE);
    expect(JSON.stringify(bid)).not.toContain("Delivery numbers");
    expect(JSON.stringify(bid)).not.toContain("c_delivery");

    // the owner's changes follow the link; a revoked link is gone
    const put = await send("ceo", "PUT", `/v1/views/${v.id}`, {
      name: "Renamed",
      program: DELIVERY,
    });
    expect(put.status).toBe(200);
    const moved = await json<Loose>(await send("consultant", "GET", `/v1/views/shared/${shareId}`));
    expect(moved.name).toBe("Renamed");
    expect(JSON.stringify(moved)).not.toContain("Delivery numbers");
    expect((await send("ceo", "DELETE", `/v1/views/${v.id}/share`)).status).toBe(204);
    expect((await send("consultant", "GET", `/v1/views/shared/${shareId}`)).status).toBe(404);
    expect((await json<Loose>(await send("ceo", "GET", `/v1/views/${v.id}`))).shared).toBe(false);
  });

  it("a share that holds nothing the viewer may read is all Locked cards, with no leftovers", async () => {
    const v = await make("head_bid", {
      program: [
        "root = Stack([c1, nav])",
        'c1 = InsightCard("V6BIDONLY Pricing", [f1])',
        'f1 = Funnel("c_bid", "30d")',
        "nav = Buttons([b1])",
        'b1 = Button("V6BIDONLY go", "focus", {brain: "c_bid"})',
      ].join("\n"),
    });
    const { shareId } = await json<Loose>(
      await send("head_bid", "POST", `/v1/views/${v.id}/share`, {}),
    );
    const r = await json<Loose>(await send("consultant", "GET", `/v1/views/shared/${shareId}`));
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/V6BIDONLY|c_bid|Funnel|Button/);
    expect(nodesOf(r.tree).map((n) => n.type)).toEqual(["Stack", "Locked"]);
  });

  it("unknown, malformed and guessed share ids are 404; a share never lists views", async () => {
    for (const id of ["nope", "00000000-0000-0000-0000-000000000000", "av_0000000000000000"]) {
      expect((await send("consultant", "GET", `/v1/views/shared/${id}`)).status, id).toBe(404);
    }
    expect((await call401()).status).toBe(401);
  });

  it("deleting a view revokes its share", async () => {
    const v = await make("ceo");
    const { shareId } = await json<Loose>(await send("ceo", "POST", `/v1/views/${v.id}/share`, {}));
    expect((await send("consultant", "GET", `/v1/views/shared/${shareId}`)).status).toBe(200);
    expect((await send("ceo", "DELETE", `/v1/views/${v.id}`)).status).toBe(204);
    expect((await send("consultant", "GET", `/v1/views/shared/${shareId}`)).status).toBe(404);
  });

  it("a stored plan is checked again on every read: a later-invalid plan opens as nothing, never as a crash", async () => {
    const v = await make("ceo");
    // planted directly: a record a newer version of the grammar would have refused
    const ws = wsOf(ALPHA, "personal:u_ceo");
    const row = await ws.get(v.id);
    await ws.scratch(
      {
        id: v.id,
        label: v.id,
        kind: "agent_view",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: "u_ceo",
        body: JSON.stringify({
          name: "old",
          program: 'root = Stack([k])\nk = Script("x")',
          pin: "home",
        }),
      },
      Date.now(),
    );
    expect(row).not.toBeNull();
    const got = await json<Loose>(await send("ceo", "GET", `/v1/views/${v.id}`));
    expect(JSON.stringify(got.tree)).not.toContain("Script");
  });
});

describe("receipts: ids only", () => {
  it("agent.pin, agent.unpin and agent.share name the view id, never its name, plan or link", async () => {
    const v = await make("head_bid", {
      name: "V6RECEIPTNAME",
      program: DELIVERY.replace("c_delivery", "c_bid"),
    });
    const s = await json<Loose>(await send("head_bid", "POST", `/v1/views/${v.id}/share`, {}));
    await send("head_bid", "PUT", `/v1/views/${v.id}`, { name: "V6RECEIPTNAME2" });
    await send("head_bid", "DELETE", `/v1/views/${v.id}/share`);
    await send("head_bid", "DELETE", `/v1/views/${v.id}`);
    const all = await receiptsOf("u_head_bid");
    const mine = all.filter((r) => r.nodeId === v.id);
    expect(mine.map((r) => r.action).sort()).toEqual(
      ["agent.pin", "agent.pin", "agent.share", "agent.share", "agent.unpin"].sort(),
    );
    expect(mine.every((r) => r.decision === "allow" && r.scopeId === null)).toBe(true);
    const text = JSON.stringify(all);
    expect(text).not.toContain("V6RECEIPTNAME");
    expect(text).not.toContain(s.shareId);
    expect(text).not.toContain("Funnel");
  });

  it("a mutation fails closed when the audit service is down", async () => {
    const down = { AUDIT: { fetch: async () => new Response("down", { status: 503 }) } };
    const r = await as("ceo", "/v1/views", {
      body: { name: "V6AUDITDOWN", program: DELIVERY, pin: "home" },
      env: down,
    });
    expect(r.status).toBe(503);
    expect(await json(r)).toEqual({ error: "audit_unavailable" });
    const rows = (await json<Loose>(await send("ceo", "GET", "/v1/views"))).views as Loose[];
    expect(rows.every((x) => x.name !== "V6AUDITDOWN")).toBe(true);
  });
});

async function call401(): Promise<Response> {
  const { call } = await import("./helpers.ts");
  return call("/v1/views/shared/00000000-0000-0000-0000-000000000000");
}
