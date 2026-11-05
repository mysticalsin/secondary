// The dev wiki seed: pages per workspace, plane isolation, idempotent reruns, versioning, "never in
// staging or prod", role-aware suggestions and the index-first deterministic answer. The seed is off in
// the shared test configuration (WIKI_SEED=off), so these tests switch it on per call.

import { buildOrg, ROLE_ORDER } from "@secondary/policy";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureWikiSeed, wikiSeedEnabled } from "../src/wiki/seed.ts";
import { WIKI_SEED_VERSION } from "../src/wiki/seed-content.ts";
import {
  ALPHA,
  as,
  call,
  json,
  type Loose,
  SEED_TOKEN,
  tenantDo,
  testEnv,
  wsOf,
} from "./helpers.ts";
import { plantPage, sseOf, unzip } from "./uxv2-helpers.ts";

const ON = { WIKI_SEED: "on" };
const DAY = 86_400_000;

async function seedOn() {
  const res = await call("/v1/admin/seed", {
    email: "seeder@example.invalid",
    body: {},
    headers: { "X-Seed-Token": SEED_TOKEN },
    env: ON,
  });
  expect(res.status).toBe(200);
  return (await json(res)) as Loose;
}

const pagesOf = (scope: string): Promise<Loose[]> => wsOf(ALPHA, scope).wikiPages();

async function ask(persona: string, q: string) {
  const ev = await sseOf(await as(persona, "/v1/ask", { body: { q }, env: ON }));
  return {
    answer: ev.find((e) => e.event === "answer")?.data as Loose,
    cites: ev.filter((e) => e.event === "citation").map((e) => e.data as Loose),
  };
}

let summary: Loose;
beforeAll(async () => {
  summary = (await seedOn()).wiki;
}, 300_000);

describe("seed content", () => {
  it("builds pages in every wiki workspace through the ordinary ingest, marked as seed", async () => {
    expect(summary.status).toBe("seeded");
    expect(summary.version).toBe(WIKI_SEED_VERSION);
    const org = buildOrg({});
    const scopes = new Set(
      [...org.nodes.values()]
        .filter((n) => ["core", "department", "circle", "account"].includes(n.kind))
        .map((n) => (n.kind === "core" ? "global" : ((n.account ?? n.circle ?? n.dept) as string))),
    );
    expect(scopes.size).toBeGreaterThan(50);
    for (const scope of scopes) {
      const pages = await pagesOf(scope);
      expect(pages.length, scope).toBeGreaterThanOrEqual(5);
      for (const p of pages) expect(p.origin, `${scope}/${p.id}`).toBe("seed");
    }
    const names = (await pagesOf("global")).map((p) => p.id);
    for (const id of [
      "bid-playbook",
      "pricing-method",
      "go-or-no-go-criteria",
      "delivery-quality-gates",
      "ai-usage-policy",
      "onboarding-handbook",
    ])
      expect(names, id).toContain(id);
  });

  it("an account holds a client overview, projects, an opportunity, stories, interactions and logs", async () => {
    const pages = await pagesOf("a_acme");
    const types = new Set(pages.map((p) => p.type));
    for (const t of [
      "client",
      "project",
      "opportunity",
      "bid",
      "success_story",
      "interaction",
      "contacts",
      "decision_log",
      "commitments",
      "risk_register",
    ])
      expect(types.has(t), t).toBe(true);
    expect(pages.filter((p) => p.type === "project").length).toBeGreaterThanOrEqual(2);
    // Facts carry a validity time and cite seeded raw records of the same workspace.
    const facts = await wsOf(ALPHA, "a_acme").wikiFacts({ validOnly: true, limit: 500 });
    expect(facts.length).toBeGreaterThan(5);
    for (const f of facts) {
      expect(f.origin).toBe("seed");
      expect(Date.parse(f.validAt)).toBeGreaterThan(0);
      expect(f.sourceIds.every((i: string) => i.startsWith("seed:a_acme:"))).toBe(true);
    }
    const refs = await wsOf(ALPHA, "a_acme").wikiSourceRefs(
      pages.flatMap((p) =>
        [...String(p.markdown).matchAll(/\{src:([^}]+)\}/g)].map((m) => m[1] as string),
      ),
    );
    expect(refs.length).toBeGreaterThan(10);
  });

  it("an account's wiki never mentions another account", async () => {
    const org = buildOrg({});
    const accounts = [...org.nodes.values()].filter((n) => n.kind === "account");
    for (const a of accounts.slice(0, 8)) {
      const text = (await pagesOf(a.id)).map((p) => p.markdown).join("\n");
      for (const other of accounts)
        if (other.id !== a.id) expect(text, `${a.id} vs ${other.id}`).not.toContain(other.label);
    }
  });

  it("each persona's Personal Brain holds a few notes of its own", async () => {
    for (const role of ROLE_ORDER) {
      const pages = await pagesOf(`personal:u_${role}`);
      expect(pages.filter((p) => p.type === "topic").length, role).toBe(3);
    }
  });
});

describe("planes and rights", () => {
  const treeText = async (persona: string, root?: string) =>
    JSON.stringify(
      (await json(await as(persona, `/v1/brain/tree${root ? `?root=${root}` : ""}`))).roots,
    );

  it("the NDA account stays hidden from everyone without a grant (tree, ask, suggestions, export)", async () => {
    for (const persona of ROLE_ORDER) {
      expect(await treeText(persona), persona).not.toContain("Calypso");
      const { answer } = await ask(persona, "What is Calypso Demo Srl about?");
      expect(String(answer.markdown), persona).not.toContain("Calypso");
      const sug = await json(await as(persona, "/v1/ask/suggestions"));
      expect(JSON.stringify(sug), persona).not.toContain("Calypso");
    }
    const exp = await as("ceo", "/v1/brain/export?workspaceId=a_calypso");
    expect(exp.status).toBe(404);
  });

  it("contacts stay with the account's members", async () => {
    const lead = await treeText("acme_lead");
    expect(lead).toContain("Contact references");
    // The head of bid reads the bid-linked Acme account, but is not one of its members.
    const bid = await treeText("head_bid");
    expect(bid).toContain("Acme Synthetic SA");
    expect(bid).not.toContain("Contact references");
    const { answer } = await ask("head_bid", "Contact references CT");
    expect(String(answer.markdown)).not.toContain("last contact");
  });

  it("a Personal Brain shows only to its owner", async () => {
    const ceoOwn = await treeText("ceo", "personal");
    expect(ceoOwn).toContain("Weekly focus");
    // The CEO's own note names the pipeline; nobody else's tree or answers carry it.
    for (const persona of ROLE_ORDER.filter((r) => r !== "ceo")) {
      const { answer } = await ask(persona, "Review the pipeline and the accounts at risk");
      expect(String(answer.markdown), persona).not.toContain("accounts at risk");
    }
    const bid = await as("head_bid", "/v1/brain/tree?root=personal");
    const text = JSON.stringify((await json(bid)).roots);
    expect(text).toContain("Weekly focus");
    const own = await as("head_bid", "/v1/wiki/me/pages/weekly-focus");
    expect(own.status).toBe(200);
    expect((await json(own)).markdown).toContain("red team");
  });

  it("a page read says it is synthetic seed, and the export carries it in the frontmatter", async () => {
    const page = await json(await as("head_bid", "/v1/wiki/core/pages/bid-playbook"));
    expect(page.origin).toBe("seed");
    const res = await as("head_bid", "/v1/brain/export?workspaceId=core");
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    const md = files.get("method/bid-playbook.md") ?? "";
    expect(md).toContain('origin: "seed"');
    expect(md).toContain('synthetic: "Synthetic seed (dev data)"');
  });
});

describe("suggested questions and the index-first answer", () => {
  it("every persona's suggestions answer, with citations", async () => {
    let withSuggestions = 0;
    for (const persona of ROLE_ORDER) {
      const res = await as(persona, "/v1/ask/suggestions");
      expect(res.status, persona).toBe(200);
      const { questions } = (await json(res)) as { questions: { q: string }[] };
      if (["ceo", "head_bid", "acme_lead", "consultant", "reviewer"].includes(persona))
        expect(questions.length, persona).toBeGreaterThanOrEqual(3);
      if (questions.length) withSuggestions++;
      for (const { q } of questions) {
        const { answer, cites } = await ask(persona, q);
        expect(answer.unknown, `${persona}: ${q}`).toBe(false);
        expect(cites.length, `${persona}: ${q}`).toBeGreaterThan(0);
        expect(String(answer.markdown), `${persona}: ${q}`).toMatch(/\[\d+\]/);
      }
    }
    expect(withSuggestions).toBeGreaterThanOrEqual(5);
  }, 240_000);

  it("suggestions differ by role and come only from what the caller can read", async () => {
    const q = async (p: string) =>
      (
        (await json(await as(p, "/v1/ask/suggestions"))) as { questions: { q: string }[] }
      ).questions.map((x) => x.q);
    const lead = await q("acme_lead");
    const consultant = await q("consultant");
    expect(lead.join("|")).not.toBe(consultant.join("|"));
    expect(consultant.join(" ")).not.toContain("Acme");
  });

  it("the bid playbook question gets a summary of the best pages, with one line and a citation each", async () => {
    const { answer, cites } = await ask("head_bid", "What is in the bid playbook?");
    expect(answer.unknown).toBe(false);
    const md = String(answer.markdown);
    expect(md).toContain("**Bid playbook**");
    expect(md).toMatch(/\*\*Bid playbook\*\*: .+ \[1\]/);
    expect(cites.some((c) => c.pageId === "bid-playbook")).toBe(true);
  });

  it("still says unknown when nothing matches", async () => {
    const { answer, cites } = await ask("head_bid", "Zebra quantum xylophone");
    expect(answer.unknown).toBe(true);
    expect(cites).toEqual([]);
  });
});

describe("rerun, versions and environments", () => {
  it("a rerun adds nothing and keeps what people wrote", async () => {
    await plantPage(
      "a_acme",
      {
        id: "my-own-page",
        type: "topic",
        title: "My own page",
        markdown: "# My own page\n\n## Summary\n- A person wrote this.\n",
      },
      "ACCOUNT_RESTRICTED",
    );
    const before = await Promise.all(["global", "a_acme", "c_bid", "personal:u_ceo"].map(pagesOf));
    const factsBefore = (await wsOf(ALPHA, "a_acme").wikiFacts({ limit: 5000 })).length;
    // The stored version drops back, as when the constant has gone up.
    await tenantDo(ALPHA).seedDone(WIKI_SEED_VERSION - 1);
    const again = await ensureWikiSeed(testEnv(ON), ALPHA, Date.now() + DAY);
    expect(again.status).toBe("seeded");
    const after = await Promise.all(["global", "a_acme", "c_bid", "personal:u_ceo"].map(pagesOf));
    expect(after.map((p) => p.length)).toEqual(before.map((p) => p.length));
    expect((await wsOf(ALPHA, "a_acme").wikiFacts({ limit: 5000 })).length).toBe(factsBefore);
    const own = after[1]?.find((p) => p.id === "my-own-page");
    expect(own?.origin).toBe("human");
    expect(own?.markdown).toContain("A person wrote this");
    // Pages are unchanged revisions: the rerun redrafted nothing.
    expect(after[1]?.map((p) => p.revision)).toEqual(before[1]?.map((p) => p.revision));
  }, 120_000);

  it("a person's page is never redrafted by the seed", async () => {
    await plantPage(
      "c_eng",
      {
        id: "human-owned",
        type: "topic",
        title: "Human owned",
        markdown: "# Human owned\n\n## Summary\n- Written by a person.\n",
      },
      "TEAM_RESTRICTED",
    );
    const ws = wsOf(ALPHA, "c_eng");
    const r = await ws.wikiSeedRun(
      ALPHA,
      "c_eng",
      "TEAM_RESTRICTED",
      {},
      [
        {
          id: "seed:c_eng:doc:human-owned",
          label: "Human owned",
          kind: "record",
          status: "published",
          tags: ["page:topic"],
          body: "# Human owned\n\n## Summary\n- The seed would write this.\n",
          ageDays: 1,
        },
      ],
      Date.now(),
    );
    expect("refused" in r).toBe(false);
    const page = (await pagesOf("c_eng")).find((p) => p.id === "human-owned");
    expect(page?.markdown).toContain("Written by a person");
    expect(page?.markdown).not.toContain("The seed would write this");
  });

  it("the version is stored, current runs skip, and a held claim means busy", async () => {
    const tenant = tenantDo(ALPHA);
    await tenant.seedDone(WIKI_SEED_VERSION);
    expect(await tenant.seedVersion()).toBe(WIKI_SEED_VERSION);
    expect((await ensureWikiSeed(testEnv(ON), ALPHA, Date.now())).status).toBe("current");
    await tenant.seedDone(0);
    expect(await tenant.seedClaim(WIKI_SEED_VERSION, 1_000)).toBe(true);
    expect(await tenant.seedClaim(WIKI_SEED_VERSION, 2_000)).toBe(false);
    // An expired claim can be taken again.
    expect(await tenant.seedClaim(WIKI_SEED_VERSION, 1_000 + 121_000)).toBe(true);
    await tenant.seedDone(WIKI_SEED_VERSION);
  });

  it("the next request in dev seeds a tenant whose stored version is old", async () => {
    await tenantDo(ALPHA).seedDone(0);
    const t0 = await tenantDo(ALPHA).seedVersion();
    expect(t0).toBe(0);
    const res = await as("ceo", "/v1/me", { env: ON });
    expect(res.status).toBe(200);
    expect(await tenantDo(ALPHA).seedVersion()).toBe(WIKI_SEED_VERSION);
  }, 120_000);

  it("never seeds in staging or prod, nor when switched off", async () => {
    for (const environment of ["staging", "prod"]) {
      expect(wikiSeedEnabled(testEnv({ ENVIRONMENT: environment, ...ON })), environment).toBe(
        false,
      );
      await tenantDo(ALPHA).seedDone(0);
      const r = await ensureWikiSeed(
        testEnv({ ENVIRONMENT: environment, ...ON }),
        ALPHA,
        Date.now(),
      );
      expect(r.status, environment).toBe("off");
      expect(await tenantDo(ALPHA).seedVersion(), environment).toBe(0);
      // A request in that environment does not seed either.
      await as("ceo", "/v1/me", { env: { ENVIRONMENT: environment, ...ON } });
      expect(await tenantDo(ALPHA).seedVersion(), environment).toBe(0);
    }
    expect(wikiSeedEnabled(testEnv({ ENVIRONMENT: "dev", WIKI_SEED: "off" }))).toBe(false);
    expect(wikiSeedEnabled(testEnv({ ENVIRONMENT: "dev", ...ON }))).toBe(true);
    await tenantDo(ALPHA).seedDone(WIKI_SEED_VERSION);
  });

  it("the dev seed endpoint is not available in prod, so a prod tenant stays empty", async () => {
    const res = await call("/v1/admin/seed", {
      email: "seeder@example.invalid",
      body: { tenantId: "tenant_prodcheck" },
      headers: { "X-Seed-Token": SEED_TOKEN },
      env: { ENVIRONMENT: "prod", ...ON },
    });
    expect(res.status).toBe(404);
    expect(await wsOf("tenant_prodcheck", "global").wikiPages()).toEqual([]);
  });
});
