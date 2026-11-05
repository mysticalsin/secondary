import { beforeAll, describe, expect, it } from "vitest";
import {
  ALPHA,
  as,
  BETA,
  call,
  json,
  jurisdictionCalls,
  mapIds,
  PERSONAS,
  plantLabel,
  seed,
  tenantDo,
  withBeta,
  wsOf,
} from "./helpers.ts";

const LENSES = ["departments", "accounts", "topics", "governances"] as const;

beforeAll(async () => {
  await seed();
  await seed({ tenantId: BETA, emailDomain: "beta.example.invalid", seed: 99 });
});

const asBeta = (persona: string, path: string) =>
  call(path, { email: `${persona}@beta.example.invalid`, persona, env: withBeta });

describe("personas see different things", () => {
  it("map, me and scope hash differ between roles", async () => {
    const hashes = new Set<string>();
    const sizes: Record<string, number> = {};
    for (const p of PERSONAS) {
      const m = await json(await as(p, "/v1/map?lens=departments"));
      hashes.add(m.viewerScopeHash);
      sizes[p] = mapIds(m).length;
    }
    expect(hashes.size).toBeGreaterThan(3);
    expect(sizes.ceo).toBeGreaterThan(sizes.acme_lead as number);
    const ceo = mapIds(await json(await as("ceo", "/v1/map?lens=departments")));
    const acme = mapIds(await json(await as("acme_lead", "/v1/map?lens=departments")));
    expect(ceo).toContain("c_escal");
    expect(acme).not.toContain("c_escal");
    const meCeo = await json(await as("ceo", "/v1/me"));
    const meAudit = await json(await as("auditor", "/v1/me"));
    expect(meCeo.describe).not.toEqual(meAudit.describe);
  });

  it("platform admin sees structure with no counts", async () => {
    const m = await json(await as("platform_admin", "/v1/map?lens=departments"));
    const hub = m.hubs.find((h: { id: string }) => h.id === "d_amaris");
    expect(hub.counts).toBeNull();
    // Topics under a circle are hidden at structure level; the circle itself shows by name only.
    expect((await as("platform_admin", "/v1/nodes/c_bid:pricing-models")).status).toBe(404);
    const d = await json(await as("platform_admin", "/v1/nodes/c_bid"));
    expect(d.items).toEqual([]);
    expect(d.node.counts).toBeNull();
  });

  it("governances: ceo sees 12 with 433 use cases", async () => {
    const g = await json(await as("ceo", "/v1/governances"));
    expect(g).toHaveLength(12);
    expect(g.reduce((n: number, x: { useCases: number }) => n + x.useCases, 0)).toBe(433);
  });

  it("rejects an unknown lens and a bad node id", async () => {
    expect((await as("ceo", "/v1/map?lens=nope")).status).toBe(400);
    expect((await as("ceo", "/v1/nodes/..%2Fetc")).status).toBe(404);
    expect((await as("ceo", "/v1/nodes/does-not-exist")).status).toBe(404);
  });
});

describe("cross-tenant canaries", () => {
  const CANARY = "CANARY-BETA-9d41";

  it("tenant-beta canaries never appear in tenant-alpha responses (and the reverse)", async () => {
    // Re-label rows that exist in both orgs, so a wrong-tenant fan-out would return real ids.
    await plantLabel(BETA, "global", "core", "core", "GLOBAL_NONPERSONAL", `${CANARY} company`);
    await plantLabel(
      BETA,
      "c_bid",
      "c_bid:pricing-models",
      "topic",
      "TEAM_RESTRICTED",
      `${CANARY} pricing`,
    );
    await wsOf(BETA, "c_bid").comment(
      "c_bid:pricing-models",
      "u_ceo",
      `${CANARY} comment`,
      Date.now(),
    );
    await plantLabel(
      ALPHA,
      "global",
      "core",
      "core",
      "GLOBAL_NONPERSONAL",
      "CANARY-ALPHA-5c02 company",
    );

    // Positive control: beta users do find their own canary.
    const own = await json(await asBeta("ceo", `/v1/search?q=${CANARY}`));
    expect(own.results.map((r: { id: string }) => r.id)).toContain("core");

    const paths = [
      "/v1/me",
      ...LENSES.map((l) => `/v1/map?lens=${l}`),
      `/v1/search?q=${CANARY}`,
      "/v1/search?q=canary",
      "/v1/search?q=pricing",
      "/v1/accounts",
      "/v1/accounts/a_acme",
      "/v1/governances",
      "/v1/review",
      "/v1/nodes/core",
      "/v1/nodes/c_bid",
      "/v1/nodes/c_bid:pricing-models",
      "/v1/personal/items",
    ];
    for (const p of PERSONAS) {
      for (const path of paths) {
        const res = await as(p, path);
        const text = await res.text();
        expect(text, `${p} ${path}`).not.toContain("CANARY-BETA");
      }
      const plan = await as(p, "/v1/genui/plan", { body: { prompt: CANARY } });
      expect(await plan.text()).not.toContain("CANARY-BETA");
    }
    // And alpha's canary does not reach beta.
    for (const path of [`/v1/search?q=CANARY-ALPHA`, "/v1/nodes/core"]) {
      expect(await (await asBeta("ceo", path)).text()).not.toContain("CANARY-ALPHA");
    }
    const alphaSearch = await json(await as("ceo", "/v1/search?q=CANARY-ALPHA"));
    expect(alphaSearch.results.map((r: { id: string }) => r.id)).toEqual(["core"]);
    const detail = await json(await as("ceo", "/v1/nodes/c_bid:pricing-models"));
    expect(detail.comments).toEqual([]);
    const betaDetail = await json(await asBeta("ceo", "/v1/nodes/c_bid:pricing-models"));
    expect(betaDetail.comments.map((c: { text: string }) => c.text)).toEqual([`${CANARY} comment`]);
  });

  it("a user is bound to the tenant of their email domain, whatever persona they ask for", async () => {
    const me = await json(await asBeta("ceo", "/v1/me"));
    expect(me.tenantId).toBe(BETA);
    expect((await json(await as("ceo", "/v1/me"))).tenantId).toBe(ALPHA);
  });

  it("every Durable Object is requested in the EU jurisdiction", async () => {
    expect(jurisdictionCalls.length).toBeGreaterThan(0);
    expect(new Set(jurisdictionCalls)).toEqual(new Set(["eu"]));
  });
});

describe("cross-account canaries", () => {
  it("one account's canary is not reachable through search, node detail or lists", async () => {
    await plantLabel(
      ALPHA,
      "a_ember",
      "a_ember:eng:0",
      "accleaf",
      "ACCOUNT_RESTRICTED",
      "CANARY-EMBER-7731 engagement",
    );
    await wsOf(ALPHA, "a_ember").comment(
      "a_ember:eng:0",
      "u_ceo",
      "CANARY-EMBER-7731 note",
      Date.now(),
    );

    // Positive control: the CEO sees every non-NDA account.
    const ceoSearch = await json(await as("ceo", "/v1/search?q=CANARY-EMBER-7731"));
    expect(ceoSearch.results.map((r: { id: string }) => r.id)).toEqual(["a_ember:eng:0"]);
    const ceoNode = await json(await as("ceo", "/v1/nodes/a_ember:eng:0"));
    expect(ceoNode.comments.map((c: { text: string }) => c.text)).toEqual([
      "CANARY-EMBER-7731 note",
    ]);

    // The Acme lead has Acme only.
    const search = await as("acme_lead", "/v1/search?q=CANARY-EMBER-7731");
    expect((await json(search)).results).toEqual([]);
    for (const id of ["a_ember", "a_ember:eng:0", "a_ember:con:0"]) {
      expect((await as("acme_lead", `/v1/nodes/${id}`)).status, id).toBe(404);
      expect((await as("consultant", `/v1/nodes/${id}`)).status, id).toBe(404);
    }
    expect((await as("acme_lead", "/v1/accounts/a_ember")).status).toBe(404);
    const list = await json(await as("acme_lead", "/v1/accounts"));
    expect(list.map((a: { id: string }) => a.id)).toEqual(["a_acme"]);
    for (const l of LENSES) {
      const m = await as("acme_lead", `/v1/map?lens=${l}`);
      expect(await m.text()).not.toContain("a_ember");
    }
    // An action on a hidden node is refused like a missing one.
    const act = await as("acme_lead", "/v1/actions", {
      body: { nodeId: "a_ember:eng:0", action: "comment", payload: { text: "hi" } },
    });
    expect(act.status).toBe(403);
    expect((await json(act)).reason).toBe("Not in your view");
    expect(
      await (await as("acme_lead", "/v1/genui/plan", { body: { nodeId: "a_ember" } })).status,
    ).toBe(404);
  });

  it("NDA account is absent without a named grant, present with one", async () => {
    await plantLabel(
      ALPHA,
      "a_calypso",
      "a_calypso:eng:0",
      "accleaf",
      "ACCOUNT_RESTRICTED",
      "CANARY-CALYPSO-1180 engagement",
    );
    for (const p of PERSONAS) {
      const s = await as(p, "/v1/search?q=CANARY-CALYPSO-1180");
      expect((await json(s)).results, p).toEqual([]);
      expect((await as(p, "/v1/nodes/a_calypso")).status, p).toBe(404);
      expect((await as(p, "/v1/nodes/a_calypso:eng:0")).status, p).toBe(404);
      const accounts = await json(await as(p, "/v1/accounts"));
      expect(
        accounts.map((a: { id: string }) => a.id),
        p,
      ).not.toContain("a_calypso");
      for (const l of LENSES)
        expect(await (await as(p, `/v1/map?lens=${l}`)).text(), `${p} ${l}`).not.toContain(
          "a_calypso",
        );
    }
    // With the named grant the CEO sees it; the grant belongs to that person only.
    await tenantDo(ALPHA).grantNda("u_ceo", "a_calypso");
    const withGrant = await json(await as("ceo", "/v1/search?q=CANARY-CALYPSO-1180"));
    expect(withGrant.results.map((r: { id: string }) => r.id)).toEqual(["a_calypso:eng:0"]);
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(200);
    expect((await as("head_bid", "/v1/nodes/a_calypso")).status).toBe(404);
    await tenantDo(ALPHA).revokeNda("u_ceo", "a_calypso");
    expect((await as("ceo", "/v1/nodes/a_calypso")).status).toBe(404);
  });

  it("contacts are for account members only", async () => {
    expect((await as("acme_lead", "/v1/nodes/a_acme:con:0")).status).toBe(200);
    expect((await as("ceo", "/v1/nodes/a_acme:con:0")).status).toBe(404);
    expect((await as("head_bid", "/v1/nodes/a_acme:con:0")).status).toBe(404);
  });
});

describe("Personal Brain", () => {
  it("is visible to its owner only, to no role, never on the map or in search", async () => {
    const mine = await json(await as("consultant", "/v1/personal/items"));
    expect(mine.length).toBe(3);
    const token = encodeURIComponent(mine[0].title);

    for (const p of ["ceo", "platform_admin", "auditor", "head_bid", "acme_lead", "reviewer"]) {
      expect((await as(p, "/v1/nodes/pb:u_consultant")).status, p).toBe(404);
      expect((await as(p, "/v1/nodes/pb:u_consultant:1")).status, p).toBe(404);
      expect((await as(p, `/v1/nodes/pb:u_${p}`)).status, `${p} own`).toBe(200);
      const items = await json(await as(p, "/v1/personal/items"));
      expect(
        items.every((i: { id: string }) => i.id.startsWith(`pb:u_${p}:`)),
        p,
      ).toBe(true);
      const s = await json(await as(p, `/v1/search?q=${token}`));
      expect(
        s.results.filter((r: { id: string }) => r.id.startsWith("pb:u_consultant")),
        p,
      ).toEqual([]);
      for (const l of LENSES) {
        const ids = mapIds(await json(await as(p, `/v1/map?lens=${l}`)));
        expect(
          ids.filter((i) => i.startsWith("pb:")),
          `${p} ${l}`,
        ).toEqual([]);
      }
      const act = await as(p, "/v1/actions", {
        body: { nodeId: "pb:u_consultant:1", action: "comment", payload: { text: "x" } },
      });
      expect(act.status, p).toBe(403);
      expect(
        (
          await as(p, "/v1/personal/items/pb:u_consultant:1/contribute", {
            body: { targetScopeId: "c_bid" },
          })
        ).status,
        p,
      ).toBe(404);
      expect(
        (await as(p, "/v1/genui/plan", { body: { nodeId: "pb:u_consultant" } })).status,
        p,
      ).toBe(404);
    }
    // The owner sees it, and only the owner.
    expect((await as("consultant", "/v1/nodes/pb:u_consultant")).status).toBe(200);
    const own = await json(await as("consultant", `/v1/search?q=${token}`));
    expect(own.results.some((r: { id: string }) => r.id.startsWith("pb:u_consultant"))).toBe(true);
  });

  it("a real user (not a persona) gets a private brain keyed by their own id", async () => {
    const a = await call("/v1/personal/items", {
      email: "alice@example.invalid",
      body: { title: "Zq-unique-title-8812", body: "Plain note" },
    });
    expect(a.status).toBe(201);
    const aliceItems = await json(
      await call("/v1/personal/items", { email: "alice@example.invalid" }),
    );
    expect(aliceItems.map((i: { title: string }) => i.title)).toEqual(["Zq-unique-title-8812"]);
    const bobItems = await json(await call("/v1/personal/items", { email: "bob@example.invalid" }));
    expect(bobItems).toEqual([]);
    const ceoItems = await json(await as("ceo", "/v1/personal/items"));
    expect(JSON.stringify(ceoItems)).not.toContain("Zq-unique-title-8812");
  });
});
