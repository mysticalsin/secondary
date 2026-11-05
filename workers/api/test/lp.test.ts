// Landing Page Studio (docs/DESIGN-LP-STUDIO.md section 4): every acceptance item, and the negatives.
// Author is the CEO persona, the reviewer is the Knowledge reviewer persona (the one who may release on
// Company Global). Pages of the brain are planted through the wiki store, never read from a real vault.

import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index.ts";
import { expireLandingPages } from "../src/lp/retention.ts";
import { ALPHA, as, json, type Loose, publicJwk, rawEnv, sign, testEnv, wsOf } from "./helpers.ts";
import {
  BODY,
  CLOUD_ACME,
  compose,
  inReview,
  lp,
  PERMITTED,
  PROSPECT,
  planted,
  plantLpBrain,
  put,
  questions,
  TINY_PNG,
} from "./lp-helpers.ts";

beforeAll(plantLpBrain);

describe("compose", () => {
  it("for a known account shows past projects: named only with a permission for the channel, else generalised", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    expect(d).toMatchObject({
      status: "draft",
      brand: "amaris",
      lang: "en",
      revision: 1,
      composedBy: "deterministic",
    });
    expect(d.revisionHash).toMatch(/^[0-9a-f]{32}$/);
    expect(d.references.length).toBeGreaterThan(0);
    expect(d.references.length).toBeLessThanOrEqual(6);
    const named = d.references.find((r: Loose) => r.pageId === "a_acme/cloud-at-acme");
    expect(named).toMatchObject({ permission: "named", title: CLOUD_ACME, summary: PERMITTED });
    // The same client's other page has no permission: it is generalised, ranked after the named one.
    const gen = d.references.find((r: Loose) => r.pageId === "a_acme/data-at-acme");
    expect(gen).toMatchObject({ permission: "generalised-only" });
    expect(gen.generalisedTitle).toBe(gen.title);
    expect(gen.title).toMatch(/^A European retail client/);
    const text = JSON.stringify(gen);
    for (const leak of ["Acme", "Synthetic", "40%", "35%", "jane@", "example.invalid"])
      expect(text).not.toContain(leak);
    expect(d.references.indexOf(named)).toBeLessThan(d.references.indexOf(gen));
    expect(d.expiresAt.slice(0, 7)).toMatch(/^20\d\d-\d\d$/);
  });

  it("generalisation removes names, logos, metrics and quotes of every other client", async () => {
    const d = await compose();
    const solana = d.references.find((r: Loose) => r.pageId === "a_solana/cloud-at-solana");
    expect(solana.permission).toBe("generalised-only");
    const text = JSON.stringify(d);
    for (const leak of ["Solana", "35%", "2025", "could not have done"])
      expect(text).not.toContain(leak);
    expect(solana.title).toMatch(/European retail client/);
    // Company Global has no client: its page is generalised too and keeps its words.
    expect(d.references.find((r: Loose) => r.pageId === "core/cloud-method")).toMatchObject({
      permission: "generalised-only",
    });
  });

  it("never leaks another account's name, and an NDA account's pages are absent", async () => {
    for (const persona of ["ceo", "head_bid", "reviewer"]) {
      const res = await lp(persona, "/compose", { body: BODY });
      if (res.status !== 201) continue;
      const d = await json(res);
      const text = JSON.stringify(d);
      expect(text, persona).not.toContain("Calypso");
      expect(d.references.map((r: Loose) => r.pageId)).not.toContain("a_calypso/cloud-at-calypso");
      expect(text, persona).not.toContain("Solana Demo");
      // Acme appears only where its permission names it.
      for (const r of d.references)
        if (r.permission === "generalised-only")
          expect(JSON.stringify(r), persona).not.toContain("Acme");
    }
    // A person who cannot read Acme at all sees nothing of it.
    const c = await compose("consultant");
    expect(JSON.stringify(c)).not.toMatch(/Acme|Solana|Calypso/);
    expect(c.references.every((r: Loose) => !r.pageId.startsWith("a_"))).toBe(true);
  });

  it("is a draft for the author only", async () => {
    const d = await compose();
    expect((await lp("ceo", `/${d.id}`)).status).toBe(200);
    expect((await lp("head_bid", `/${d.id}`)).status).toBe(404);
    expect((await lp("reviewer", `/${d.id}/stats`)).status).toBe(404);
    expect(
      (
        await lp("head_bid", `/${d.id}`, {
          method: "PUT",
          body: { slots: d.slots, references: [], contact: d.contact, revision: 1 },
        })
      ).status,
    ).toBe(404);
    const mine = await json<Loose[]>(await lp("ceo"));
    expect(mine.some((x) => x.id === d.id)).toBe(true);
    expect((await json<Loose[]>(await lp("head_bid"))).some((x) => x.id === d.id)).toBe(false);
  });

  it("writes good French copy too, and rejects bad input", async () => {
    const d = await compose("ceo", { lang: "fr", angle: "sécurité et conformité DORA" });
    expect(d.lang).toBe("fr");
    expect(d.slots.intro).toContain("En tant que CIO chez Globex Holdings");
    expect(d.slots.intro).toContain("Bonjour Jo");
    for (const bad of [
      { prospect: { role: "x", company: "Globex" } },
      { angle: "" },
      { brand: "other" },
      { lang: "de" },
    ])
      expect((await lp("ceo", "/compose", { body: { ...BODY, ...bad } })).status).toBe(400);
  });

  it("the deterministic composer is stable and gives each angle its own copy", async () => {
    const a = await compose("ceo", { angle: "AI use cases" });
    const b = await compose("ceo", { angle: "AI use cases" });
    const c = await compose("ceo", { angle: "cost savings" });
    expect(a.slots).toEqual(b.slots);
    expect(a.slots.hero).not.toBe(c.slots.hero);
    expect(a.slots.hero).toContain("Globex Holdings");
  });
});

describe("AI composer", () => {
  const on = {
    AI_ENABLED: "true",
    AI_PROCESSOR_CONTRACT: "approved",
    ANTHROPIC_API_KEY: "test-key-not-real",
  };
  const reply = {
    hero: "AI that reaches daily work at Globex Holdings",
    intro: "A short, concrete intro for a CIO.",
    whyUs: "We reached 99% accuracy.",
    caseStudyIntro: "Work that looks like yours.",
    cta: "Talk to us",
  };
  async function viaApp(body: Loose, env: Loose, answer: Loose = reply) {
    const sent: string[] = [];
    const app = createApp({
      jwks: () => createLocalJWKSet({ keys: [publicJwk] }),
      fetch: async (_url, init) => {
        sent.push(String(init?.body));
        return Response.json({
          stop_reason: "end_turn",
          model: "m",
          content: [{ type: "text", text: JSON.stringify(answer) }],
          usage: { input_tokens: 100, output_tokens: 80 },
        });
      },
    });
    const res = await app.fetch(
      new Request("https://secondary.example.test/v1/lp/compose", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": await sign("ceo@example.invalid"),
          "X-Demo-Persona": "ceo",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      testEnv(env),
    );
    return { res, sent };
  }

  it("goes through the gate, never sends the first name or a client's text, and keeps only safe slots", async () => {
    const { res, sent } = await viaApp(BODY, on);
    expect(res.status).toBe(201);
    const d = await json(res);
    expect(d.composedBy).toBe("ai");
    expect(d.slots.hero).toBe(reply.hero);
    expect(d.slots.cta).toBe("Talk to us");
    // A figure the model made up is never shown: that slot is the deterministic one.
    expect(d.slots.whyUs).not.toContain("99%");
    expect(d.slots.whyUs).toMatch(/^Why Amaris/);
    // The greeting comes from the page's own data, after the model.
    expect(d.slots.intro).toBe(`Hello Jo. ${reply.intro}`);
    expect(sent).toHaveLength(1);
    const prompt = sent[0] as string;
    expect(prompt).toContain("Globex Holdings");
    for (const never of ["Jo", "Solana", "Lumen", "35%", "jane@"])
      expect(prompt, never).not.toMatch(new RegExp(`\\b${never}`));
    // References from an account whose contract does not allow AI stay out of the prompt.
    expect(prompt).not.toContain("Lumen");
  });

  it("falls back to the deterministic composer when AI is off, switched off, or the account refuses", async () => {
    expect((await viaApp(BODY, {})).sent).toHaveLength(0);
    expect((await json((await viaApp(BODY, {})).res)).composedBy).toBe("deterministic");
    // The customer's contract for the known account: unknown means nothing is sent.
    const ember = await viaApp(
      { ...BODY, prospect: { ...PROSPECT, company: "Ember Sample SAS" } },
      on,
    );
    expect(ember.sent).toHaveLength(0);
    expect((await json(ember.res)).composedBy).toBe("deterministic");
    // The ai kill switch.
    await as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled: false } });
    try {
      const off = await viaApp(BODY, on);
      expect(off.sent).toHaveLength(0);
      expect(off.res.status).toBe(201);
    } finally {
      await as("platform_admin", "/v1/admin/switches", { body: { switch: "ai", enabled: true } });
    }
  });

  it("a model answer that is not usable gives the deterministic page", async () => {
    const { res } = await viaApp(BODY, on, { hero: 1, intro: "", whyUs: null });
    expect(res.status).toBe(201);
    expect((await json(res)).composedBy).toBe("deterministic");
  });
});

describe("references", () => {
  it("lists candidates with permission, enforces six, and recomputes them on the server", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    const cands = await json<Loose[]>(await lp("ceo", `/${d.id}/references?q=cloud`));
    expect(cands.length).toBeGreaterThan(0);
    for (const r of cands) expect(["named", "generalised-only"]).toContain(r.permission);
    // The client cannot claim a permission: it only names pages.
    const forged = await put("ceo", d, {
      references: [
        {
          pageId: "a_acme/data-at-acme",
          permission: "named",
          title: "Acme Synthetic SA",
          summary: "x",
        },
      ],
    });
    expect(forged.status).toBe(200);
    expect((await json(forged)).references[0]).toMatchObject({ permission: "generalised-only" });
    const seven = Array.from({ length: 7 }, () => ({ pageId: "core/cloud-method" }));
    const many = await lp("ceo", `/${d.id}`, {
      method: "PUT",
      body: { slots: d.slots, references: seven, contact: d.contact, revision: d.revision },
    });
    expect(many.status).toBe(422);
    expect((await json(many)).error).toBe("too_many_references");
    for (const pageId of ["a_calypso/cloud-at-calypso", "nowhere/page", "bad id"]) {
      const r = await lp("ceo", `/${d.id}`, {
        method: "PUT",
        body: {
          slots: d.slots,
          references: [{ pageId }],
          contact: d.contact,
          revision: d.revision,
        },
      });
      expect([400, 422], pageId).toContain(r.status);
    }
  });

  it("returns 409 on a stale revision", async () => {
    const d = await compose();
    expect((await put("ceo", d)).status).toBe(200);
    const stale = await put("ceo", d);
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ error: "revision_conflict", currentRevision: 2 });
  });
});

describe("checks", () => {
  it("a fresh draft passes", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    const res = await json(await lp("ceo", `/${d.id}/check`, { body: {} }));
    expect(res, JSON.stringify(res)).toEqual({ ok: true, issues: [] });
  });

  it("flags a client name without permission, in a slot and in the references", async () => {
    const d = await compose();
    const slots = { ...d.slots, whyUs: "We did the same for Solana Demo SL last year." };
    const upd = await json(await put("ceo", d, { slots }));
    const res = await json(await lp("ceo", `/${upd.id}/check`, { body: {} }));
    expect(res.ok).toBe(false);
    expect(res.issues).toContainEqual(
      expect.objectContaining({ slot: "whyUs", kind: "customer-permission" }),
    );
    // The prospect's own name is the subject of the page and is fine.
    const own = await json(
      await put("ceo", upd, { slots: { ...d.slots, intro: "For Globex Holdings." } }),
    );
    expect((await json(await lp("ceo", `/${own.id}/check`, { body: {} }))).ok).toBe(true);
  });

  it("catches a permission withdrawn after the draft, and blocks submit and publish", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    const ws = wsOf(ALPHA, "a_acme");
    const rec = await ws.get("rec:acme-cloud-story");
    const body = JSON.parse(rec?.body ?? "{}");
    const withdrawn = {
      ...body,
      story: { ...body.story, permission: { ...body.story.permission, channels: ["press"] } },
    };
    await ws.edit(
      "rec:acme-cloud-story",
      rec?.revision ?? 0,
      { body: JSON.stringify(withdrawn) },
      Date.now(),
      "u_lead",
    );
    try {
      const res = await json(await lp("ceo", `/${d.id}/check`, { body: {} }));
      expect(res.ok).toBe(false);
      expect(res.issues).toContainEqual(
        expect.objectContaining({
          kind: "customer-permission",
          slot: expect.stringMatching(/^reference:a_acme\//),
          fix: expect.objectContaining({ removeReference: expect.stringMatching(/^a_acme\//) }),
        }),
      );
      const sub = await lp("ceo", `/${d.id}/submit`, { body: {} });
      expect(sub.status).toBe(422);
      expect((await json(sub)).error).toBe("checks_failed");
    } finally {
      const cur = await ws.get("rec:acme-cloud-story");
      await ws.edit(
        "rec:acme-cloud-story",
        cur?.revision ?? 0,
        { body: rec?.body ?? "" },
        Date.now(),
        "u_lead",
      );
    }
  });

  it("sensitivity flags (contact detail, personal wording) and length block submission", async () => {
    const d = await compose();
    for (const [slot, text, kind] of [
      ["hero", "Write to bob@client.example.invalid today", "sensitivity"],
      ["intro", "Call +33 1 23 45 67 89 now", "sensitivity"],
      ["whyUs", "My family and my divorce taught me this", "sensitivity"],
      ["hero", "x".repeat(200), "length"],
    ] as const) {
      const cur = await json(await lp("ceo", `/${d.id}`));
      const upd = await json(await put("ceo", cur, { slots: { ...cur.slots, [slot]: text } }));
      const res = await json(await lp("ceo", `/${upd.id}/check`, { body: {} }));
      expect(res.issues, text).toContainEqual(expect.objectContaining({ slot, kind }));
      const sub = await lp("ceo", `/${upd.id}/submit`, { body: {} });
      expect(sub.status, text).toBe(422);
      expect((await json(sub)).issues.length).toBeGreaterThan(0);
      expect((await json(await lp("ceo", `/${upd.id}`))).status).toBe("draft");
    }
  });
});

describe("review and publication", () => {
  it("no public URL before approval; author and editor cannot approve; the reviewer approves the exact hash", async () => {
    const d = await compose();
    // Publish before approval is refused, whether or not it was submitted.
    expect((await lp("ceo", `/${d.id}/publish`, { body: {} })).status).toBe(403);
    const sub = await json(await lp("ceo", `/${d.id}/submit`, { body: {} }));
    expect(sub.status).toBe("in_review");
    expect((await lp("ceo", `/${d.id}/publish`, { body: {} })).status).toBe(403);
    expect((await rawEnv.PAGES.list({ prefix: "p/" })).objects.length).toBe(0);

    // The author cannot approve (a person with no right, and an author who has the right).
    expect(
      (await lp("ceo", `/${d.id}/approve`, { body: { revisionHash: sub.revisionHash } })).status,
    ).toBe(403);
    expect(
      (await lp("head_bid", `/${d.id}/approve`, { body: { revisionHash: sub.revisionHash } }))
        .status,
    ).toBe(404);
    const own = await json(await lp("reviewer", "/compose", { body: BODY }));
    await lp("reviewer", `/${own.id}/submit`, { body: {} });
    const mine = await json(await lp("reviewer", `/${own.id}`));
    const self = await lp("reviewer", `/${own.id}/approve`, {
      body: { revisionHash: mine.revisionHash },
    });
    expect(self.status).toBe(403);

    // Hash required and checked.
    expect((await lp("reviewer", `/${d.id}/approve`, { body: {} })).status).toBe(400);
    const wrong = await lp("reviewer", `/${d.id}/approve`, {
      body: { revisionHash: "0".repeat(32) },
    });
    expect(wrong.status).toBe(409);
    const ok = await lp("reviewer", `/${d.id}/approve`, {
      body: { revisionHash: sub.revisionHash },
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ ok: true, status: "approved", required: 1 });
    expect((await json(await lp("ceo", `/${d.id}`))).status).toBe("approved");
  });

  it("an editor cannot approve, nor the same person under another id or address", async () => {
    const d = await compose();
    const store = rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA));
    // The reviewer edited the page (store level: pages are single-owner in the API).
    expect(
      (
        await store.update(
          d.id,
          d.revision,
          { slots: d.slots, references: d.references, contact: d.contact },
          { id: "u_reviewer", email: "reviewer@example.invalid" },
          Date.now(),
        )
      ).ok,
    ).toBe(true);
    const sub = await json(await lp("ceo", `/${d.id}/submit`, { body: {} }));
    const res = await lp("reviewer", `/${d.id}/approve`, {
      body: { revisionHash: sub.revisionHash },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("self_approval");
    // Not an item in this reviewer's Questions either.
    expect((await questions("reviewer")).some((q) => q.id === `lp:${d.id.slice(3)}`)).toBe(false);
    // The author's address under another principal id is the same human.
    const e = await store.approve(
      d.id,
      sub.revisionHash,
      { id: "other-id", email: "CEO@example.invalid" },
      ["other-id"],
      Date.now(),
    );
    expect(e).toMatchObject({ ok: false, code: "self_approval" });
  });

  it("an edit after approval takes the page back to draft: the old approval does not carry", async () => {
    const sub = await inReview();
    const approve = await lp("reviewer", `/${sub.id}/approve`, {
      body: { revisionHash: sub.revisionHash },
    });
    expect(approve.status).toBe(200);
    const edited = await json(
      await put("ceo", sub, { slots: { ...sub.slots, cta: "Another call to action" } }),
    );
    expect(edited.status).toBe("draft");
    expect((await lp("ceo", `/${sub.id}/publish`, { body: {} })).status).toBe(403);
    expect(
      (await lp("reviewer", `/${sub.id}/approve`, { body: { revisionHash: sub.revisionHash } }))
        .status,
    ).toBe(409);
  });

  it("Questions: a release question with the stored preview, a diff and the hash; request changes returns the page", async () => {
    const sub = await inReview();
    const qs = await questions("reviewer");
    const q = qs.find((x) => x.id === `lp:${sub.id.slice(3)}`);
    expect(q).toMatchObject({ kind: "release", workspaceId: "core" });
    expect(q?.options.map((o: Loose) => o.action)).toEqual(["approve", "request_changes"]);
    expect(q?.detail.revisionHash).toBe(sub.revisionHash);
    expect(q?.detail.previewHtml).toContain("<h1>");
    expect(q?.detail.previewHtml).toContain(sub.slots.hero.slice(0, 20));
    expect(q?.detail.previewHtml).not.toContain("<script");
    expect(q?.detail.diff.length).toBeGreaterThan(0);
    // Not for the author, nor for someone who cannot release.
    expect((await questions("ceo")).some((x) => x.id === q?.id)).toBe(false);
    expect((await questions("head_bid")).some((x) => x.id === q?.id)).toBe(false);
    const resolve = (persona: string, body: Loose) =>
      as(persona, `/v1/questions/${encodeURIComponent(q?.id)}`, { body });
    expect(
      (await resolve("ceo", { action: "approve", revisionHash: sub.revisionHash })).status,
    ).toBe(403);
    expect(
      (await resolve("head_bid", { action: "approve", revisionHash: sub.revisionHash })).status,
    ).toBe(404);
    expect((await resolve("reviewer", { action: "approve" })).status).toBe(400);
    expect(
      (await resolve("reviewer", { action: "approve", revisionHash: "f".repeat(32) })).status,
    ).toBe(409);
    const back = await resolve("reviewer", { action: "request_changes", note: "Tone it down" });
    expect(back.status).toBe(200);
    const after = await json(await lp("ceo", `/${sub.id}`));
    expect(after).toMatchObject({ status: "draft", note: "Tone it down" });
    const again = await json(await lp("ceo", `/${sub.id}/submit`, { body: {} }));
    const approve = await as(
      "reviewer",
      `/v1/questions/${encodeURIComponent(`lp:${sub.id.slice(3)}`)}`,
      { body: { action: "approve", revisionHash: again.revisionHash } },
    );
    expect(approve.status).toBe(200);
    expect((await json(await lp("ceo", `/${sub.id}`))).status).toBe("approved");
  });

  it("publish renders static HTML into R2 under a 128-bit slug with an expiry, and unpublish deletes it", async () => {
    const sub = await inReview({ prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    // A visual on the named reference is kept; on a generalised one it is dropped.
    const withImage = await json(
      await put("ceo", sub, {
        references: [
          { pageId: "a_acme/cloud-at-acme", image: TINY_PNG },
          { pageId: "a_acme/data-at-acme", image: TINY_PNG },
        ],
      }),
    );
    expect(withImage.references[0].image).toBe(TINY_PNG);
    expect(withImage.references[1].image).toBeUndefined();
    const sub2 = await json(await lp("ceo", `/${withImage.id}/submit`, { body: {} }));
    await lp("reviewer", `/${sub2.id}/approve`, { body: { revisionHash: sub2.revisionHash } });

    const pub = await lp("ceo", `/${sub2.id}/publish`, {
      body: { utm: { source: "email", medium: "outreach", campaign: "q4 cloud" }, days: 30 },
    });
    expect(pub.status, await pub.clone().text()).toBe(200);
    const out = await json(pub);
    const m =
      /^https:\/\/[^/]+\/p\/([0-9a-f]{32})\?utm_source=email&utm_medium=outreach&utm_campaign=q4\+cloud$/.exec(
        out.url,
      );
    expect(m, out.url).not.toBeNull();
    const slug = m?.[1] as string;
    const days = (Date.parse(out.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    const obj = await rawEnv.PAGES.get(`p/${slug}.html`);
    expect(Number(obj?.customMetadata?.expiresAt)).toBe(Date.parse(out.expiresAt));
    const html = (await obj?.text()) as string;
    expect(html).toContain("Carlito");
    expect(html).toContain("#6600AE");
    expect(html).toContain("#F8F060");
    expect(html).toContain("noindex");
    expect(html).toContain(`/p/${slug}/i/0`);
    expect(html).not.toContain("data:image");
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    // The copied visual is in the bucket, served by the pages worker from there.
    const img = await rawEnv.PAGES.get(`p/${slug}/i/0`);
    expect(img?.httpMetadata?.contentType).toBe("image/png");
    expect(await rawEnv.PAGES.head(`p/${slug}/i/1`)).toBeNull();
    expect((await json(await lp("ceo", `/${sub2.id}`))).status).toBe("published");
    // A published page is not editable.
    expect((await put("ceo", await json(await lp("ceo", `/${sub2.id}`)))).status).toBe(409);

    // Stats come from the counts the pages worker wrote beside the page.
    await rawEnv.PAGES.put(
      `stats/${slug}.json`,
      JSON.stringify({
        loads: 10,
        views: 4,
        ctaClicks: 1,
        byDay: [{ day: "2026-11-05", loads: 10, views: 4, ctaClicks: 1 }],
      }),
    );
    expect(await json(await lp("ceo", `/${sub2.id}/stats`))).toEqual({
      views: 4,
      ctaClicks: 1,
      consentRate: 0.4,
      byDay: [{ day: "2026-11-05", views: 4, ctaClicks: 1 }],
    });
    const listed = (await json<Loose[]>(await lp("ceo"))).find((x) => x.id === sub2.id);
    expect(listed?.stats.views).toBe(4);
    // The weekly digest carries the page.
    const digest = await json(await as("ceo", "/v1/digest/preview"));
    expect(
      digest.sections.find((s: Loose) => s.title === "Landing pages")?.items[0].label,
    ).toContain("Acme Synthetic SA");

    expect((await lp("head_bid", `/${sub2.id}/unpublish`, { body: {} })).status).toBe(404);
    expect((await lp("ceo", `/${sub2.id}/unpublish`, { body: {} })).status).toBe(200);
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).toBeNull();
    expect(await rawEnv.PAGES.head(`p/${slug}/i/0`)).toBeNull();
    expect((await json(await lp("ceo", `/${sub2.id}`))).status).toBe("unpublished");
    expect((await json(await lp("ceo", `/${sub2.id}/stats`))).views).toBe(4);
    expect((await lp("ceo", `/${sub2.id}/unpublish`, { body: {} })).status).toBe(409);
    // The same approved, unchanged page can go out again, under a new address.
    const again = await json(await lp("ceo", `/${sub2.id}/publish`, { body: {} }));
    expect(again.url).not.toContain(slug);
  });

  it("expiry removes the page and purges the prospect's data, keeping the counts", async () => {
    const sub = await inReview();
    await lp("reviewer", `/${sub.id}/approve`, { body: { revisionHash: sub.revisionHash } });
    const out = await json(await lp("ceo", `/${sub.id}/publish`, { body: {} }));
    const slug = /\/p\/([0-9a-f]{32})/.exec(out.url)?.[1] as string;
    expect((Date.parse(out.expiresAt) - Date.now()) / 86_400_000).toBeGreaterThan(89);
    await rawEnv.PAGES.put(
      `stats/${slug}.json`,
      JSON.stringify({ loads: 3, views: 2, ctaClicks: 0, byDay: [] }),
    );
    // A page whose clock has not run out is left alone.
    const early = await expireLandingPages(testEnv(), ALPHA, Date.now() + 60 * 86_400_000);
    expect(early).toBe(0);
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).not.toBeNull();
    const later = Date.now() + 91 * 86_400_000;
    expect(await expireLandingPages(testEnv(), ALPHA, later)).toBeGreaterThan(0);
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).toBeNull();
    expect(await rawEnv.PAGES.head(`stats/${slug}.json`)).toBeNull();
    const rec = await planted(sub.id);
    expect(rec).toMatchObject({
      status: "expired",
      prospect: { role: "", company: "" },
      slots: { hero: "", intro: "" },
      references: [],
      previewHtml: null,
      finalStats: { views: 2 },
    });
    expect(JSON.stringify(rec)).not.toContain("Globex");
    expect(JSON.stringify(rec)).not.toContain("Jo");
    const d = await json(await lp("ceo", `/${sub.id}`));
    expect(d.status).toBe("expired");
    expect(
      (
        await put("ceo", {
          ...d,
          slots: { hero: "", intro: "", whyUs: "", caseStudyIntro: "", cta: "" },
          references: [],
          contact: { name: "A", email: "a@example.invalid" },
        })
      ).status,
    ).toBe(409);
    expect((await lp("ceo", `/${sub.id}/publish`, { body: {} })).status).toBe(403);
    // Drafts that never went out expire as well.
    const idle = await compose();
    await expireLandingPages(testEnv(), ALPHA, later);
    expect((await json(await lp("ceo", `/${idle.id}`))).prospect).toEqual({
      role: "",
      company: "",
    });
  });

  it("the ops retention job expires pages", async () => {
    const idle = await compose();
    const { signOps } = await import("./lp-ops.ts");
    const res = await signOps("/v1/internal/ops/retention", Date.now() + 100 * 86_400_000);
    expect(res.status).toBe(200);
    expect((await json(res)).pagesExpired).toBeGreaterThan(0);
    expect((await json(await lp("ceo", `/${idle.id}`))).status).toBe("expired");
  });
});

describe("MCP and the kill switch", () => {
  it("MCP composes drafts and lists, and has no route to submit, approve or publish", async () => {
    const { internal } = await import("./lp-ops.ts");
    const made = await internal("/v1/lp/compose", {
      body: BODY,
      scope: ["secondary.read", "secondary.contribute"],
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const d = await json(made);
    expect(d.status).toBe("draft");
    expect((await json<Loose[]>(await internal("/v1/lp"))).some((x) => x.id === d.id)).toBe(true);
    const need = await internal("/v1/lp/compose", { body: BODY, scope: ["secondary.read"] });
    expect(need.status).toBe(403);
    for (const [p, b] of [
      [`/v1/lp/${d.id}/submit`, {}],
      [`/v1/lp/${d.id}/approve`, { revisionHash: d.revisionHash }],
      [`/v1/lp/${d.id}/publish`, {}],
      [`/v1/lp/${d.id}/check`, {}],
    ] as const) {
      const r = await internal(p, {
        body: b,
        scope: ["secondary.read", "secondary.contribute", "secondary.personal.write"],
      });
      expect(r.status, p).toBe(403);
    }
    expect((await json(await lp("ceo", `/${d.id}`))).status).toBe("draft");
  });

  it("the lp switch stops composing and publishing, but never unpublishing", async () => {
    const sub = await inReview();
    await lp("reviewer", `/${sub.id}/approve`, { body: { revisionHash: sub.revisionHash } });
    const out = await json(await lp("ceo", `/${sub.id}/publish`, { body: {} }));
    const slug = /\/p\/([0-9a-f]{32})/.exec(out.url)?.[1] as string;
    const set = (enabled: boolean) =>
      as("platform_admin", "/v1/admin/switches", { body: { switch: "lp", enabled } });
    expect((await set(false)).status).toBe(200);
    try {
      const off = await lp("ceo", "/compose", { body: BODY });
      expect(off.status).toBe(503);
      expect(await json(off)).toEqual({ error: "switched_off", switch: "lp" });
      expect((await lp("ceo")).status).toBe(503);
      expect((await lp("ceo", `/${sub.id}/unpublish`, { body: {} })).status).toBe(200);
      expect(await rawEnv.PAGES.head(`p/${slug}.html`)).toBeNull();
    } finally {
      await set(true);
    }
    expect((await lp("ceo")).status).toBe(200);
  });
});
