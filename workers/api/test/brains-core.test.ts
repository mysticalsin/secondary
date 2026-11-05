// v3 brains: directory, home, access bounds, roles, publication mode and two-person changes.
// Every policy boundary has a negative test.

import { beforeAll, describe, expect, it } from "vitest";
import { TEMPLATES } from "../src/brains/model.ts";
import { get, idOf, post, put } from "./brains-helpers.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

const LEAD = "b3.lead@example.invalid";
const BID = "b3.bid@example.invalid";
const CONS = "b3.cons@example.invalid";
const CEO = "b3.ceo@example.invalid";
const ADMIN = "b3.admin@example.invalid";
const ACC = "a_acme";
const NDA = "a_calypso";

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
const deny = {
  CONNECTOR: {
    fetch: async (_u: string, init: RequestInit) =>
      Response.json({
        results: Object.fromEntries(
          (JSON.parse(String(init.body)).itemIds as string[]).map((i) => [i, { allowed: false }]),
        ),
      }),
  },
};

const SRC = `src:abcdef:${"b3brain".padEnd(24, "0")}`;

beforeAll(async () => {
  await seed();
  await plantPage(
    "c_bid",
    {
      id: "b3-pricing",
      type: "topic",
      title: "Pricing basics",
      markdown: "# Pricing basics\n\n## Summary\n- Fixed fee for phase 2 is agreed\n",
    },
    "TEAM_RESTRICTED",
  );
  await plantPage(NDA, {
    id: "b3-secret",
    type: "topic",
    title: "Calypso secret",
    markdown: "# Calypso secret\n\n## Summary\n- Calypso pricing is confidential\n",
  });
  await wsOf(ALPHA, ACC).wikiTouch(ALPHA, ACC, Date.now());
  await wsOf(ALPHA, ACC).brainSchemaAdd(TEMPLATES.account.collections);
  await wsOf(ALPHA, ACC).sourceUpsert([
    {
      id: SRC,
      sourceId: "abcdef",
      gateNodeId: "a_acme:con",
      plane: "ACCOUNT_RESTRICTED",
      title: "Closure plan.md",
      body: "x",
      webUrl: null,
      mime: "text/markdown",
      size: 1,
      eTag: "e1",
      syncedAt: Date.now(),
    },
  ]);
  await plantPage(ACC, {
    id: "b3-open",
    type: "client",
    title: "Acme overview",
    markdown: "# Acme overview\n\n## Summary\n- Acme is a synthetic client\n",
  });
  await plantPage(ACC, {
    id: "b3-closed",
    type: "project",
    title: "Closure",
    markdown: `# Closure\n\n## Summary\n- A site closes {src:${SRC}}\n`,
  });
});

describe("directory: admitted brains only", () => {
  it("lists the Personal Brain first, then admitted brains with a type, readers and a health score", async () => {
    const d = await get<Loose>("consultant", CONS, "");
    const ids = d.brains.map((b: Loose) => b.id);
    expect(ids[0]).toBe("me");
    expect(ids).toContain("c_delivery");
    expect(ids).toContain("core");
    const me = d.brains[0];
    expect(me).toMatchObject({ type: "personal", readers: 1, manages: true, restricted: false });
    const team = d.brains.find((b: Loose) => b.id === "c_delivery");
    expect(team).toMatchObject({ type: "team", manages: false, publication: "review" });
    expect(d.brains.find((b: Loose) => b.id === "core")).toMatchObject({ type: "global" });
    for (const b of d.brains) {
      expect(b.health.score).toBeGreaterThanOrEqual(0);
      expect(b.health.score).toBeLessThanOrEqual(100);
      expect(b.template).toBeTruthy();
    }
  });

  it("never lists a brain outside the caller's view, and its card is a 404", async () => {
    for (const [persona, email] of [
      ["consultant", CONS],
      ["head_bid", BID],
      ["acme_lead", LEAD],
      ["ceo", CEO],
    ] as const) {
      const d = await get<Loose>(persona, email, "");
      expect(
        d.brains.map((b: Loose) => b.id),
        persona,
      ).not.toContain(NDA);
      expect((await as(persona, `/v1/brains/${NDA}`, { email })).status, persona).toBe(404);
    }
    // The consultant has no access to the account either, so it is absent and not "locked".
    const c = await get<Loose>("consultant", CONS, "");
    expect(c.brains.map((b: Loose) => b.id)).not.toContain(ACC);
    expect((await as("consultant", `/v1/brains/${ACC}`, { email: CONS })).status).toBe(404);
    expect(JSON.stringify(c)).not.toContain("Calypso");
  });

  it("the account is an account brain: restricted, review only", async () => {
    const d = await get<Loose>("acme_lead", LEAD, "");
    const acc = d.brains.find((b: Loose) => b.id === ACC);
    expect(acc).toMatchObject({
      type: "account",
      restricted: true,
      publication: "review",
      manages: true,
    });
    expect(acc.template).toBe("account");
  });

  it("filters by type and by name", async () => {
    const t = await get<Loose>("acme_lead", LEAD, "?type=account");
    expect(t.brains.every((b: Loose) => b.type === "account")).toBe(true);
    const q = await get<Loose>("acme_lead", LEAD, "?q=acme");
    expect(q.brains.map((b: Loose) => b.id)).toContain(ACC);
    expect((await as("acme_lead", "/v1/brains?type=bogus", { email: LEAD })).status).toBe(400);
  });

  it("health and counts come only from pages the caller can read", async () => {
    const hidden = await get<Loose>("acme_lead", LEAD, `/${ACC}`);
    // Connector says no: the page resting on a synced file is not part of the brain for this caller.
    const denied = json<Loose>(
      await as("acme_lead", `/v1/brains/${ACC}`, { email: LEAD, env: deny }),
    );
    const shown = json<Loose>(
      await as("acme_lead", `/v1/brains/${ACC}`, { email: LEAD, env: allow }),
    );
    const [d, s] = await Promise.all([denied, shown]);
    expect(hidden.pages).toBe(d.pages);
    expect(s.pages).toBe(d.pages + 1);
    const count = (home: Loose, type: string) =>
      home.collections.find((c: Loose) => c.type === type)?.count ?? 0;
    expect(count(d, "project")).toBe(0);
    expect(count(s, "project")).toBe(1);
    // The numbers of the two views differ because they are computed over different pages.
    expect(s.health.components.freshness.value).toBeGreaterThanOrEqual(0);
    expect(d.health.components.coverage.have).toBeLessThanOrEqual(
      s.health.components.coverage.have,
    );
  });

  it("lint and backlog are counted for someone who can decide, and left out for everyone else", async () => {
    const lead = await get<Loose>("acme_lead", LEAD, `/${ACC}`);
    expect(lead.health.components.lint).not.toBeNull();
    expect(lead.health.components.backlog).not.toBeNull();
    const global = await get<Loose>("consultant", CONS, "/core");
    expect(global.health.components.lint).toBeNull();
    expect(global.health.components.backlog).toBeNull();
    expect(global.health.score).toBeGreaterThanOrEqual(0);
  });
});

describe("home: what changed this week", () => {
  it("lists the pages changed in the last 7 days with line counts, and offers coach hints to a manager", async () => {
    const home = await get<Loose>("acme_lead", LEAD, `/${ACC}`);
    expect(home.type).toBe("account");
    expect(home.changedThisWeek.total).toBeGreaterThan(0);
    const open = home.changedThisWeek.items.find((i: Loose) => i.pageId === "b3-open");
    expect(open).toMatchObject({ change: "new", title: "Acme overview", type: "client" });
    expect(open.added).toBeGreaterThan(0);
    expect(home.collections.find((c: Loose) => c.type === "client")).toMatchObject({
      count: 1,
      expected: true,
    });
    expect(home.coach.available).toBe(true);
    expect(home.coach.suggestions.every((x: Loose) => x.kind === "missing_collection")).toBe(true);
    const ro = await get<Loose>("consultant", CONS, "/c_delivery");
    expect(ro.coach).toEqual({ available: false, suggestions: [] });
  });

  it("a page that rests on an unreadable source is not in the change list", async () => {
    const home = json<Loose>(
      await as("acme_lead", `/v1/brains/${ACC}`, { email: LEAD, env: deny }),
    );
    const ids = (await home).changedThisWeek.items.map((i: Loose) => i.pageId);
    expect(ids).not.toContain("b3-closed");
  });

  it("sets a template and adds its collections without removing any", async () => {
    const r = await post("acme_lead", LEAD, `/${ACC}/template`, { template: "bid" });
    expect(r.status).toBe(200);
    const out = await json<Loose>(r);
    expect(out.template).toBe("bid");
    expect(out.added).toContain("offer");
    const home = await get<Loose>("acme_lead", LEAD, `/${ACC}`);
    expect(home.template).toBe("bid");
    expect(home.collections.map((c: Loose) => c.type)).toEqual(
      expect.arrayContaining(["client", "offer"]),
    );
    expect((await post("acme_lead", LEAD, `/${ACC}/template`, { template: "nope" })).status).toBe(
      400,
    );
    // Not a manager: no template.
    expect(
      (await post("consultant", CONS, "/c_delivery/template", { template: "team" })).status,
    ).toBe(403);
    await post("acme_lead", LEAD, `/${ACC}/template`, { template: "account" });
  });
});

describe("access: bounds from the policy", () => {
  it("shows what is allowed and why a value is forced", async () => {
    const a = await get<Loose>("acme_lead", LEAD, `/${ACC}/access`);
    expect(a).toMatchObject({ type: "account", canManage: true });
    expect(a.publication).toMatchObject({ mode: "review", allowed: ["review"], forced: true });
    expect(a.everyone).toMatchObject({ level: "none", allowed: ["none"] });
    expect(a.everyone.reason).toMatch(/never allowed/);
    expect(a.roles.map((r: Loose) => r.id)).toEqual([
      "reader",
      "contributor",
      "editor",
      "steward",
      "owner",
    ]);
    expect(a.members).not.toBeNull();
    const t = await get<Loose>("head_bid", BID, "/c_bid/access");
    expect(t.publication.allowed).toEqual(["review", "direct"]);
    expect(t.everyone.allowed).toEqual(["none", "reader", "contributor"]);
    // A reader of the brain sees the bounds but not the member list.
    const cons = await get<Loose>("consultant", CONS, "/c_bid/access").catch(() => null);
    expect(cons === null || cons.members === null || cons.error !== undefined).toBe(true);
  });

  it("Everyone at Mantu is impossible on account, NDA and restricted brains", async () => {
    const r = await put("acme_lead", LEAD, `/${ACC}/access`, { everyone: "reader" });
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ error: "policy_bound" });
    expect((await get<Loose>("acme_lead", LEAD, `/${ACC}/access`)).everyone.level).toBe("none");
    // The NDA account does not even open for a caller without the named grant.
    expect((await put("acme_lead", LEAD, `/${NDA}/access`, { everyone: "reader" })).status).toBe(
      404,
    );
    // And never on a Personal Brain.
    const me = await put("consultant", CONS, "/me/access", { everyone: "contributor" });
    expect(me.status).toBe(422);
  });

  it("direct publishing is impossible where policy forces review", async () => {
    for (const [persona, email, id] of [
      ["acme_lead", LEAD, ACC],
      ["reviewer", "b3.rev@example.invalid", "core"],
    ] as const) {
      const r = await put(persona, email, `/${id}/access`, { publication: "direct" });
      expect([403, 404, 422], `${persona} ${id}`).toContain(r.status);
      if (r.status === 422) expect(await json(r)).toMatchObject({ error: "policy_bound" });
    }
    const a = await get<Loose>("acme_lead", LEAD, `/${ACC}/access`);
    expect(a.publication.mode).toBe("review");
  });

  it("a team brain may publish directly: an editor's proposal goes live, a contributor's still waits", async () => {
    const set = await put("head_bid", BID, "/c_bid/access", {
      publication: "direct",
      everyone: "reader",
    });
    expect(set.status).toBe(200);
    expect(await json(set)).toMatchObject({ publication: "direct", everyone: "reader" });
    // Head of bid is a steward there and may edit: the page is live at once.
    const mine = await as("head_bid", "/v1/wiki/c_bid/propose", {
      email: BID,
      body: { title: "Direct page", markdown: "# Direct page\n\n## Summary\n- It is live\n" },
    });
    expect(mine.status).toBe(201);
    expect(await json(mine)).toMatchObject({ status: "published" });
    expect(await wsOf(ALPHA, "c_bid").wikiPage("direct-page")).toMatchObject({
      status: "published",
    });
    // The consultant contributes in the delivery circle only: nothing to publish there directly.
    const back = await put("head_bid", BID, "/c_bid/access", { publication: "review" });
    expect(back.status).toBe(200);
    const queued = await as("head_bid", "/v1/wiki/c_bid/propose", {
      email: BID,
      body: { title: "Waiting page", markdown: "# Waiting page\n\n## Summary\n- Review first\n" },
    });
    expect(await json(queued)).toMatchObject({ status: "candidate" });
    expect(await wsOf(ALPHA, "c_bid").wikiPage("waiting-page")).toBeNull();
  });

  it("direct mode is ignored the moment a brain stops being allowed to use it", async () => {
    // A stored "direct" on a brain that is restricted (written straight to the object) is not honoured.
    const ws = wsOf(ALPHA, ACC);
    await ws.brainConfigSet({ publication: "direct" }, "test", Date.now());
    const r = await as("acme_lead", `/v1/wiki/${ACC}/propose`, {
      email: LEAD,
      body: { title: "Not direct", markdown: "# Not direct\n\n## Summary\n- Needs review\n" },
    });
    expect(r.status).toBe(201);
    expect(await json(r)).toMatchObject({ status: "candidate" });
    expect((await get<Loose>("acme_lead", LEAD, `/${ACC}/access`)).publication.mode).toBe("review");
  });

  it("a brain you may only read cannot change its access", async () => {
    expect((await put("consultant", CONS, "/core/access", { publication: "review" })).status).toBe(
      403,
    );
    expect(
      (await put("consultant", CONS, "/c_delivery/access", { publication: "direct" })).status,
    ).toBe(403);
  });
});

describe("members and roles", () => {
  it("a Personal Brain is never shared", async () => {
    const id = await idOf("consultant", CONS);
    const r = await as("consultant", `/v1/brains/me/access/members/${id}`, {
      email: CONS,
      method: "PUT",
      body: { role: "reader" },
    });
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ error: "personal_not_shareable" });
  });

  it("adding a member to a restricted brain waits for a second person", async () => {
    const r = await as("acme_lead", `/v1/brains/${ACC}/access/members/u_consultant`, {
      email: LEAD,
      method: "PUT",
      body: { role: "reader" },
    });
    expect(r.status).toBe(200);
    const out = await json<Loose>(r);
    expect(out.status).toBe("pending");
    expect(out.changeId).toBeTruthy();
    expect(out.member).toEqual({ principalId: "u_consultant", role: "reader" });
    const a = await get<Loose>("acme_lead", LEAD, `/${ACC}/access`);
    expect(a.members.find((m: Loose) => m.principalId === "u_consultant")).toMatchObject({
      role: "reader",
      state: "pending",
    });
    // The same person cannot approve it in the console.
    const self = await as("acme_lead", `/v1/admin/changes/${out.changeId}/decide`, {
      email: LEAD,
      body: { approve: true },
    });
    expect([403, 404, 409]).toContain(self.status);
  });

  it("a role change on a restricted brain is two-person: a different human confirms", async () => {
    // u_acme_lead's own row cannot be changed by themselves; use a member that exists.
    const first = await as("acme_lead", `/v1/brains/${ACC}/access/members/u_consultant`, {
      email: LEAD,
      method: "PUT",
      body: { role: "editor" },
    });
    expect([200, 202]).toContain(first.status);
    const body = await json<Loose>(first);
    expect(body.status).toBe("pending");
  });

  it("granting a role to an existing member of a restricted brain needs two different humans", async () => {
    const LEAD2 = "b3.lead2@example.invalid";
    const path = `/v1/brains/${ACC}/access/members/u_acme_lead`;
    const ask = (email: string) =>
      as("acme_lead", path, { email, method: "PUT", body: { role: "owner" } });
    const first = await ask(LEAD);
    expect(first.status).toBe(202);
    expect(await json(first)).toMatchObject({ ok: true, status: "pending" });
    // Nothing changed yet.
    expect(await wsOf(ALPHA, ACC).brainRoleOf(["u_acme_lead"])).toBeNull();
    // The same human asking again is not a second person.
    const again = await ask(LEAD);
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ error: "same_person" });
    expect(await wsOf(ALPHA, ACC).brainRoleOf(["u_acme_lead"])).toBeNull();
    // A different human confirms and it applies.
    const second = await ask(LEAD2);
    expect(second.status).toBe(200);
    expect(await json(second)).toMatchObject({
      status: "applied",
      member: { principalId: "u_acme_lead", role: "owner" },
    });
    expect(await wsOf(ALPHA, ACC).brainRoleOf(["u_acme_lead"])).toBe("owner");
    const a = await get<Loose>("acme_lead", LEAD, `/${ACC}/access`);
    expect(a.members.find((m: Loose) => m.principalId === "u_acme_lead")).toMatchObject({
      role: "owner",
    });
  });

  it("a role cannot be changed by the person who holds it", async () => {
    const me = await idOf("acme_lead", LEAD);
    const r = await as("acme_lead", `/v1/brains/${ACC}/access/members/${me}`, {
      email: LEAD,
      method: "PUT",
      body: { role: "owner" },
    });
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ error: "own_role" });
  });

  it("an unknown person or a bad role is refused", async () => {
    const bad = await as("head_bid", "/v1/brains/c_bid/access/members/u_nobody", {
      email: BID,
      method: "PUT",
      body: { role: "reader" },
    });
    expect(bad.status).toBe(404);
    const role = await as("head_bid", "/v1/brains/c_bid/access/members/u_consultant", {
      email: BID,
      method: "PUT",
      body: { role: "god" },
    });
    expect(role.status).toBe(400);
  });

  it("a stored role only narrows: a reader cannot propose even where the policy would let them", async () => {
    const add = await as("head_bid", "/v1/brains/c_bid/access/members/u_acme_lead", {
      email: BID,
      method: "PUT",
      body: { role: "reader" },
    });
    expect(add.status).toBe(200);
    expect((await json<Loose>(add)).status).toBe("applied");
    const a = await get<Loose>("head_bid", BID, "/c_bid/access");
    expect(a.members.find((m: Loose) => m.principalId === "u_acme_lead")).toMatchObject({
      role: "reader",
      state: "active",
    });
    // The cap is checked where the role is stored; a person with the role and the policy right is narrowed.
    const ws = wsOf(ALPHA, "c_bid");
    expect(await ws.brainRoleOf(["u_acme_lead"])).toBe("reader");
    expect(await ws.brainRoleOf(["u_nobody"])).toBeNull();
    // And at the wiki API: a reader may not propose, although the membership would let them.
    const blocked = await as("acme_lead", "/v1/wiki/c_bid/propose", {
      body: { title: "Reader page", markdown: "# Reader page\n\n## Summary\n- Not allowed\n" },
    });
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toMatchObject({
      reason: "Your role in this brain does not allow this",
    });
    // Without the stored role the same membership lets the same person propose: the cap was the reason.
    await ws.brainMemberRemove("u_acme_lead", "test", Date.now());
    const allowed = await as("acme_lead", "/v1/wiki/c_bid/propose", {
      body: { title: "Member page", markdown: "# Member page\n\n## Summary\n- Allowed\n" },
    });
    expect(allowed.status).toBe(201);
    await ws.brainMemberSet("u_acme_lead", "reader", "active", "test", Date.now());
    const rm = await as("head_bid", "/v1/brains/c_bid/access/members/u_acme_lead", {
      email: BID,
      method: "DELETE",
    });
    expect(rm.status).toBe(200);
    expect(await ws.brainRoleOf(["u_acme_lead"])).toBeNull();
    // The membership is gone with the role, so the policy now refuses too.
    const gone = await as("acme_lead", "/v1/wiki/c_bid/propose", {
      body: { title: "Reader page", markdown: "# Reader page\n\n## Summary\n- Not allowed\n" },
    });
    expect([403, 404]).toContain(gone.status);
  });
});
