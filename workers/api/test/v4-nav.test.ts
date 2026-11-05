// v4: the sidebar (GET /v1/brains/nav) and the directory's scope=all. Only brains the caller can open
// appear in the nav; a brain they cannot read adds no name, count or placeholder.

import { beforeAll, describe, expect, it } from "vitest";
import { get } from "./brains-helpers.ts";
import { as, json, type Loose, seed } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const e = (p: string) => `v4n.${p}@example.invalid`;
const nav = async (persona: string) =>
  (await get<Loose>(persona, e(persona), "/nav")).items as Loose[];
const ids = (items: Loose[]) => items.map((i) => i.id);

// The nav order: Personal, governances, Global.
const ORDER = [
  "me",
  "c_bid",
  "c_sales",
  "accounts",
  "c_delivery",
  "d_af",
  "d_hr",
  "d_it",
  "d_mkt",
  "d_sia",
  "d_perf",
  "d_sus",
  "d_recruit",
  "d_amaris",
  "d_lbc",
  "d_eleven",
  "d_ci",
  "core",
];

beforeAll(async () => {
  await seed();
  await plantPage(
    "d_amaris",
    {
      id: "v4n-dept",
      type: "topic",
      title: "Amaris department note",
      markdown: "# Amaris department note\n\n## Summary\n- Only the Amaris department reads this\n",
    },
    "TEAM_RESTRICTED",
  );
});

describe("GET /v1/brains/nav", () => {
  it("lists the CEO's brains in the fixed order: Personal first, governances, Global last", async () => {
    const items = await nav("ceo");
    const got = ids(items);
    expect(got[0]).toBe("me");
    expect(got.at(-1)).toBe("core");
    // Every id is in the documented order, and the order is the documented one.
    const rank = (id: string) => ORDER.indexOf(id);
    expect(got.every((id) => rank(id) >= 0)).toBe(true);
    expect(got).toEqual([...got].sort((a, b) => rank(a) - rank(b)));
    // All twelve governance brains, accounts, and the business-line brains.
    for (const id of ORDER) expect(got, id).toContain(id);
    const groups = items.map((i) => i.group);
    expect(groups[0]).toBe("personal");
    expect(groups.at(-1)).toBe("global");
    expect(groups.slice(1, -1).every((g) => g === "governance")).toBe(true);
    expect(items.find((i) => i.id === "c_bid")).toMatchObject({
      name: "Bid & Pre-sales",
      governanceId: "c_bid",
      type: "team",
    });
    expect(items.find((i) => i.id === "d_af")).toMatchObject({
      name: "Finance (A&F)",
      governanceId: "g_af",
    });
  });

  it("the CEO never sees anyone's personal brain, and an NDA account without a grant is absent", async () => {
    const items = await nav("ceo");
    expect(items.filter((i) => i.type === "personal")).toHaveLength(1);
    expect(items.filter((i) => i.group === "personal")).toHaveLength(1);
    const accounts = items.find((i) => i.id === "accounts") as Loose;
    const childIds = accounts.children.map((c: Loose) => c.id);
    expect(childIds).toContain("a_acme");
    expect(childIds).not.toContain("a_calypso");
    expect(JSON.stringify(items)).not.toContain("personal:");
    expect(JSON.stringify(items)).not.toContain("Calypso");
  });

  it("Head of Bid sees Bid & Pre-sales and the account brains linked to bids, not Sales", async () => {
    const items = await nav("head_bid");
    const got = ids(items);
    expect(got).toContain("c_bid");
    expect(got).not.toContain("c_sales");
    const accounts = items.find((i) => i.id === "accounts") as Loose;
    expect(accounts.group).toBe("governance");
    expect(accounts.governanceId).toBe("accounts");
    const kids = accounts.children.map((c: Loose) => c.id);
    expect(kids).toEqual(expect.arrayContaining(["a_acme", "a_ibero"]));
    expect(kids).not.toContain("a_calypso");
    // The same set the directory admits, and nothing else.
    const dir = (await get<Loose>("head_bid", e("head_bid"), "")).brains.map((b: Loose) => b.id);
    for (const k of kids) expect(dir).toContain(k);
    const text = JSON.stringify(items);
    for (const hidden of ["c_sales", "Sales", "d_af", "Finance", "Calypso", "c_hr_pp"])
      expect(text, hidden).not.toContain(hidden);
  });

  it("a parent department visible only through an admitted circle is not a brain the caller can open", async () => {
    for (const persona of ["head_bid", "consultant", "acme_lead"]) {
      expect(ids(await nav(persona)), persona).not.toContain("d_amaris");
      const page = await as(persona, "/v1/wiki/d_amaris/pages/v4n-dept", { email: e(persona) });
      expect(page.status, persona).toBe(404);
      const dir = (await get<Loose>(persona, e(persona), "")).brains.map((b: Loose) => b.id);
      expect(dir, persona).not.toContain("d_amaris");
      const home = await as(persona, "/v1/brains/d_amaris", { email: e(persona) });
      expect(home.status, persona).toBe(404);
    }
  });

  it("a governance with no brain for the caller is omitted: Delivery consultant has no Accounts item", async () => {
    const items = await nav("consultant");
    expect(ids(items)).toEqual(["me", "c_delivery", "core"]);
    expect(items.find((i) => i.id === "c_delivery")).toMatchObject({
      name: "Delivery",
      role: "contributor",
    });
  });

  it("the Account lead has Sales and one account, the reviewer has the two circles they review", async () => {
    const acme = await nav("acme_lead");
    expect(ids(acme)).toEqual(["me", "c_sales", "accounts", "core"]);
    expect(
      (acme.find((i) => i.id === "accounts") as Loose).children.map((c: Loose) => c.id),
    ).toEqual(["a_acme"]);
    expect(ids(await nav("reviewer"))).toEqual(["me", "c_bid", "c_delivery", "core"]);
  });

  it("roles without content access (admin, auditor) get only their own Personal Brain", async () => {
    expect(ids(await nav("platform_admin"))).toEqual(["me"]);
    expect(ids(await nav("auditor"))).toEqual(["me"]);
  });

  it("each item is a BrainCard, and children are cards of brains the directory also admits", async () => {
    const items = await nav("acme_lead");
    for (const i of items)
      expect(i).toMatchObject({
        id: expect.any(String),
        type: expect.stringMatching(/^(personal|team|account|global)$/),
        name: expect.any(String),
        readers: expect.any(Number),
        manages: expect.any(Boolean),
        publication: expect.stringMatching(/^(review|direct)$/),
        role: expect.stringMatching(/^(reader|contributor|editor|steward|owner)$/),
        pages: expect.any(Number),
        health: { score: expect.any(Number) },
      });
    const child = (items.find((i) => i.id === "accounts") as Loose).children[0];
    expect(child).toMatchObject({ id: "a_acme", type: "account", restricted: true });
    expect(items[0]).toMatchObject({ id: "me", role: "owner", group: "personal" });
  });
});

describe("GET /v1/brains?scope=all", () => {
  it("adds brains the caller can see but not open, with canOpen:false and no counts", async () => {
    const all = (await get<Loose>("head_bid", e("head_bid"), "?scope=all")).brains as Loose[];
    const open = all.filter((b) => b.canOpen);
    const closed = all.filter((b) => !b.canOpen);
    expect(ids(open)).toContain("c_bid");
    expect(open.every((b) => typeof b.pages === "number")).toBe(true);
    expect(ids(closed)).toContain("d_af");
    const fin = closed.find((b) => b.id === "d_af") as Loose;
    expect(fin).toEqual({
      id: "d_af",
      type: "team",
      name: "A&F",
      canOpen: false,
      restricted: false,
      canRequestAccess: true,
    });
    // Nothing openable is listed as closed, and no other brain's content leaks into the entry.
    expect(ids(closed).filter((id) => ids(open).includes(id))).toEqual([]);
    expect(ids(closed)).not.toContain("a_calypso");
    expect(ids(closed)).not.toContain("me");
  });

  it("without scope the directory is unchanged: openable brains only", async () => {
    const plain = (await get<Loose>("head_bid", e("head_bid"), "")).brains as Loose[];
    expect(plain.every((b) => b.canOpen === undefined)).toBe(true);
    expect(ids(plain)).not.toContain("d_af");
    expect((await as("head_bid", "/v1/brains?scope=x", { email: e("head_bid") })).status).toBe(400);
  });

  it("type and q narrow both lists", async () => {
    const q = (await get<Loose>("head_bid", e("head_bid"), "?scope=all&q=a%26f")).brains as Loose[];
    expect(ids(q)).toEqual(["d_af"]);
    const t = (await get<Loose>("head_bid", e("head_bid"), "?scope=all&type=account")).brains;
    expect((t as Loose[]).every((b) => b.type === "account")).toBe(true);
  });

  it("a role with no request right sees names but canRequestAccess is false", async () => {
    const all = (await get<Loose>("platform_admin", e("admin"), "?scope=all")).brains as Loose[];
    const closed = all.filter((b) => !b.canOpen);
    expect(closed.length).toBeGreaterThan(5);
    expect(closed.every((b) => b.canRequestAccess === false)).toBe(true);
  });

  it("request access reuses the governance flow: POST /v1/admin/access-requests {nodeId, reason}", async () => {
    const res = await as("head_bid", "/v1/admin/access-requests", {
      email: e("head_bid"),
      body: { nodeId: "d_af", reason: "I price bids that use the rate cards" },
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  });

  // Last: a cohort that manages brains_v3 limits every later call to its members.
  it("nav answers no-store and follows the brains_v3 pilot flag like /v1/brains", async () => {
    const res = await as("consultant", "/v1/brains/nav", { email: e("consultant") });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const made = await as("platform_admin", "/v1/admin/pilot", {
      email: e("pilotadmin"),
      body: { name: "Nav pilot", members: [e("pilot.in")], flags: { brains_v3: true } },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const out = await as("consultant", "/v1/brains/nav", { email: e("pilot.out") });
    expect(out.status).toBe(403);
    expect(await json(out)).toEqual({ error: "not_in_pilot", flag: "brains_v3" });
    expect((await as("consultant", "/v1/brains/nav", { email: e("pilot.in") })).status).toBe(200);
  });
});
