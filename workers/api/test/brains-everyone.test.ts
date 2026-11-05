// Everyone at Mantu really widens reading: the admitted view, the wiki and the directory follow the
// stored level, for team and Global brains only, and never past view_content.

import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { get, put } from "./brains-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const LEAD = "ev.lead@example.invalid";
const BID = "ev.bid@example.invalid";
const BID2 = "ev.bid2@example.invalid";
const CONS = "ev.cons@example.invalid";
const ACC = "a_acme";
const NDA = "a_calypso";

const tenant = () =>
  (env as unknown as { TENANT_POLICY: DurableObjectNamespace }).TENANT_POLICY.get(
    (env as unknown as { TENANT_POLICY: DurableObjectNamespace }).TENANT_POLICY.idFromName(ALPHA),
  ) as unknown as { openBrainSet(n: string, l: string): Promise<void> };

const ids = async (persona: string, email: string): Promise<string[]> =>
  (await get<Loose>(persona, email, "")).brains.map((b: Loose) => b.id);
const wikiGet = (persona: string, email: string, path: string) =>
  as(persona, `/v1/wiki/c_bid${path}`, { email });

/** Opening takes two people (M-8): the first asks, a different one confirms. Closing is one. */
const setEveryone = async (level: "none" | "reader") => {
  if (level === "none") return put("head_bid", BID, "/c_bid/access", { everyone: level });
  const first = await put("head_bid", BID, "/c_bid/access", { everyone: level });
  if (first.status === 200) return first; // already at that level
  expect(first.status).toBe(202);
  return put("head_bid", BID2, "/c_bid/access", { everyone: level });
};

beforeAll(async () => {
  await seed();
  await plantPage("c_bid", {
    id: "ev-method",
    type: "topic",
    title: "Bid method",
    markdown: "# Bid method\n\n## Summary\n- We staff a red team before submission\n",
  });
  await wsOf(ALPHA, "c_bid").wikiTouch(ALPHA, "c_bid", Date.now());
});

describe("Everyone at Mantu, team brain", () => {
  it("is closed to the consultant until the steward opens it to everyone", async () => {
    expect(await ids("consultant", CONS)).not.toContain("c_bid");
    expect((await wikiGet("consultant", CONS, "/index")).status).toBe(404);
    const set = await setEveryone("reader");
    expect(set.status).toBe(200);
    expect(await ids("consultant", CONS)).toContain("c_bid");
    const idx = await wikiGet("consultant", CONS, "/index");
    expect(idx.status).toBe(200);
    const page = await wikiGet("consultant", CONS, "/pages/ev-method");
    expect(page.status).toBe(200);
    expect((await json<Loose>(page)).title).toBe("Bid method");
  });

  it("stays read-only: no comment path, no proposal, no access change, no decision", async () => {
    // "contributor" is not offered: Everyone at Mantu lifts reading only.
    expect((await put("head_bid", BID, "/c_bid/access", { everyone: "contributor" })).status).toBe(
      422,
    );
    await setEveryone("reader");
    expect((await get<Loose>("consultant", CONS, "/c_bid/access")).canManage).toBe(false);
    const propose = await as("consultant", "/v1/wiki/c_bid/propose", {
      email: CONS,
      body: { title: "Mine", markdown: "# Mine\n\n## Summary\n- Not allowed\n" },
    });
    expect(propose.status).toBe(403);
    expect((await put("consultant", CONS, "/c_bid/access", { everyone: "none" })).status).toBe(403);
    expect((await put("consultant", CONS, "/c_bid/access", { publication: "direct" })).status).toBe(
      403,
    );
  });

  it("closing it again takes the access away at the next request", async () => {
    await setEveryone("reader");
    expect((await wikiGet("consultant", CONS, "/index")).status).toBe(200);
    await setEveryone("none");
    expect((await wikiGet("consultant", CONS, "/index")).status).toBe(404);
    expect(await ids("consultant", CONS)).not.toContain("c_bid");
  });
});

describe("Everyone at Mantu never reaches account, NDA or Personal brains", () => {
  it("the API refuses it for them (policy_bound) and nothing is written", async () => {
    const r = await put("acme_lead", LEAD, `/${ACC}/access`, { everyone: "reader" });
    expect(r.status).toBe(422);
    expect((await put("consultant", CONS, "/me/access", { everyone: "reader" })).status).toBe(422);
    expect(await ids("consultant", CONS)).not.toContain(ACC);
  });

  it("a row written past the API (account, NDA, another person's Personal Brain) opens nothing", async () => {
    const t = tenant();
    await t.openBrainSet(ACC, "reader");
    await t.openBrainSet(NDA, "reader");
    await t.openBrainSet("pb:u_acme_lead", "reader");
    const mine = await ids("consultant", CONS);
    expect(mine).not.toContain(ACC);
    expect(mine).not.toContain(NDA);
    for (const id of [ACC, NDA]) {
      expect(
        (await get<Loose>("consultant", CONS, `/${id}`).catch(() => ({}))).error ?? "x",
      ).toBeDefined();
      const r = await as("consultant", `/v1/wiki/${id}/index`, { email: CONS });
      expect(r.status, id).toBe(404);
    }
    const pb = await as("consultant", "/v1/wiki/pb:u_acme_lead/index", { email: CONS });
    expect(pb.status).toBe(404);
    await t.openBrainSet(ACC, "none");
    await t.openBrainSet(NDA, "none");
    await t.openBrainSet("pb:u_acme_lead", "none");
  });
});

describe("M-8: opening a brain to everyone at Mantu takes a second person", () => {
  beforeAll(async () => {
    await setEveryone("none");
  });
  it("the first request only asks; nothing opens until a different person confirms the same level", async () => {
    const first = await put("head_bid", BID, "/c_bid/access", { everyone: "reader" });
    expect(first.status).toBe(202);
    expect(await json<Loose>(first)).toMatchObject({ status: "pending", needs: "second_person" });
    expect(await ids("consultant", CONS)).not.toContain("c_bid");
    expect((await wikiGet("consultant", CONS, "/index")).status).toBe(404);
    // The same person again changes nothing.
    expect((await put("head_bid", BID, "/c_bid/access", { everyone: "reader" })).status).toBe(409);
    expect(await ids("consultant", CONS)).not.toContain("c_bid");
    // A different person confirms: now it is open, and closing it again takes one person.
    expect((await put("head_bid", BID2, "/c_bid/access", { everyone: "reader" })).status).toBe(200);
    expect(await ids("consultant", CONS)).toContain("c_bid");
    expect((await put("head_bid", BID, "/c_bid/access", { everyone: "none" })).status).toBe(200);
    expect(await ids("consultant", CONS)).not.toContain("c_bid");
  });
});
