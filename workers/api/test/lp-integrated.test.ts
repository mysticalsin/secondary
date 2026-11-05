// Landing Page Studio, integration pass: the premium template as the one renderer, the shapes the web
// app reads, one language per page, and the operations around the page store (switch, erasure, backup).

import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { type BackupDeps, restoreBackup, runBackup } from "../../ops/src/backup.ts";
import { createApp } from "../src/index.ts";
import { shorten } from "../src/lp/checks.ts";
import { composeDeterministic } from "../src/lp/compose.ts";
import { languageOf } from "../src/lp/lang.ts";
import { clientPhrase } from "../src/lp/refs.ts";
import type { Reference } from "../src/lp/types.ts";
import { ALPHA, as, json, type Loose, publicJwk, rawEnv, sign, testEnv, wsOf } from "./helpers.ts";
import {
  BODY,
  compose,
  inReview,
  lp,
  PERMITTED,
  PROSPECT,
  plantLpBrain,
  publish,
  put,
  questions,
  TINY_PNG,
  withStory,
} from "./lp-helpers.ts";

beforeAll(plantLpBrain);

describe("the premium template is the renderer", () => {
  it("the stored review rendering and the published page both come from it, and keep the rules", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    const withImage = await put("ceo", d, {
      references: d.references.map((r: Loose) =>
        r.permission === "named" ? { pageId: r.pageId, image: TINY_PNG } : { pageId: r.pageId },
      ),
    });
    const cur = await json(withImage);
    const sub = await json(await lp("ceo", `/${cur.id}/submit`, { body: {} }));
    const q = (await questions("reviewer")).find((x) => x.id === `lp:${sub.id.slice(3)}`);
    const preview = q?.detail.previewHtml as string;
    expect(preview).toContain('class="band"');
    expect(preview).toContain("Carlito");
    expect(preview).toContain('id="consent"');
    expect(preview).not.toMatch(/<script/i);
    expect(preview).toContain(TINY_PNG);

    const pub = await publish(sub);
    const { html, slug } = pub;
    expect(html).toContain('class="band"');
    expect(html).toContain(`/p/${slug}/i/0`);
    expect(html).not.toContain("data:image");
    // The rules of the contract: no external request, one script, no style attribute, no handler.
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import|url\(|<link|<iframe|<form|<object|<embed|srcset/i);
    expect(html).not.toMatch(/\sstyle=|\son[a-z]+\s*=/i);
    expect([...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1])).toEqual([""]);
    expect([...html.matchAll(/<style\b([^>]*)>/g)].map((m) => m[1])).toEqual([""]);
    expect(html).toMatch(/<div id="consent"[^>]* hidden>/);
    expect(html).toContain('lang="en"');
    expect(html).toContain("sendBeacon(p,");
    // It closes on the date the page really closes, not on a made-up one.
    const closes = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(pub.expiresAt),
    );
    expect(html).toContain(closes);
    expect(html).not.toMatch(/2 people|read this page before/);
  });

  it("a figure is shown only when the customer permission covers it", async () => {
    const metric = { value: "40 stores", label: "on one platform" };
    const named = (d: Loose) =>
      d.references.find((r: Loose) => r.pageId === "a_acme/cloud-at-acme");
    // No figure on record: none on the page, none in the reference.
    const plain = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    expect(named(plain).metric).toBeUndefined();
    await withStory(
      (st) => {
        st.permission.metric = metric;
      },
      async () => {
        const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
        expect(named(d)).toMatchObject({ permission: "named", metric });
        // A generalised reference never carries one, whatever the page says.
        for (const r of d.references)
          if (r.permission === "generalised-only") expect(r.metric).toBeUndefined();
        const sub = await json(await lp("ceo", `/${d.id}/submit`, { body: {} }));
        const pub = await publish(sub);
        expect(pub.html).toContain("40 stores");
        expect(pub.html).toContain("on one platform");
        // The figure is part of what the reviewer approved: it changes the hash.
        expect(sub.revisionHash).not.toBe(
          (await json(await lp("ceo", `/${plain.id}`))).revisionHash,
        );
        // Withdrawn after the draft: the check catches the difference.
        const second = await compose("ceo", {
          prospect: { ...PROSPECT, company: "Acme Synthetic SA" },
        });
        await withStory(
          (st) => {
            st.permission.metric = undefined;
          },
          async () => {
            const res = await json(await lp("ceo", `/${second.id}/check`, { body: {} }));
            expect(res.ok).toBe(false);
            expect(res.issues).toContainEqual(
              expect.objectContaining({
                kind: "customer-permission",
                fix: expect.objectContaining({ removeReference: "a_acme/cloud-at-acme" }),
              }),
            );
          },
        );
      },
    );
  });
});

describe("what the web app reads", () => {
  it("the list carries stats, drafts carry url, expiresAt and updatedAt", async () => {
    const sub = await inReview();
    const pub = await publish(sub);
    await rawEnv.PAGES.put(
      `stats/${pub.slug}.json`,
      JSON.stringify({
        loads: 5,
        views: 3,
        ctaClicks: 1,
        byDay: [{ day: "2026-11-04", loads: 5, views: 3, ctaClicks: 1 }],
      }),
    );
    const row = (await json<Loose[]>(await lp("ceo"))).find((x) => x.id === sub.id);
    expect(row.stats).toEqual({
      views: 3,
      ctaClicks: 1,
      consentRate: 0.6,
      byDay: [{ day: "2026-11-04", views: 3, ctaClicks: 1 }],
    });
    expect(row.url).toBe(pub.url);
    expect(Date.parse(row.expiresAt)).toBe(Date.parse(pub.expiresAt));
    expect(Date.parse(row.updatedAt)).toBeGreaterThan(0);
    // A draft has the clock and the stamp too, and a (zero) stats object.
    const d = await compose();
    const mine = (await json<Loose[]>(await lp("ceo"))).find((x) => x.id === d.id);
    expect(mine.url).toBeUndefined();
    expect(mine.expiresAt).toMatch(/^20\d\d-/);
    expect(mine.updatedAt).toMatch(/^20\d\d-/);
    expect(mine.stats).toEqual({ views: 0, ctaClicks: 0, consentRate: 0, byDay: [] });
  });

  it("the release question carries the page and the revision before it: detail.landing", async () => {
    const d = await compose();
    const edited = await json(await put("ceo", d, { slots: { ...d.slots, cta: "A second try" } }));
    const sub = await json(await lp("ceo", `/${edited.id}/submit`, { body: {} }));
    const q = (await questions("reviewer")).find((x) => x.id === `lp:${sub.id.slice(3)}`);
    const landing = q?.detail.landing;
    expect(landing.id).toBe(sub.id);
    expect(landing.draft).toMatchObject({
      id: sub.id,
      status: "in_review",
      revision: 2,
      revisionHash: sub.revisionHash,
      slots: { cta: "A second try" },
      prospect: { role: "CIO", company: "Globex Holdings" },
    });
    expect(landing.previous).toMatchObject({ revision: 1, slots: { cta: d.slots.cta } });
    expect(landing.previous.references.length).toBe(d.references.length);
    expect(landing.previous.references[0]).toMatchObject({ pageId: d.references[0].pageId });
    expect(landing.previous.contact).toEqual(d.contact);
    // A first revision has nothing before it.
    const first = await inReview();
    const q1 = (await questions("reviewer")).find((x) => x.id === `lp:${first.id.slice(3)}`);
    expect(q1?.detail.landing.previous).toBeNull();
  });

  it("a check's fix is {label, text?, removeReference?} and does what it says", async () => {
    const d = await compose();
    const set = async (slot: string, text: string) => {
      const cur = await json(await lp("ceo", `/${d.id}`));
      return json(await put("ceo", cur, { slots: { ...cur.slots, [slot]: text } }));
    };
    const check = async () => json(await lp("ceo", `/${d.id}/check`, { body: {} }));
    // Too long: the fix is a text that fits and ends cleanly.
    await set("hero", `${"A long sentence about a cloud move. ".repeat(10)}`);
    let res = await check();
    const len = res.issues.find((i: Loose) => i.slot === "hero" && i.kind === "length");
    expect(len.fix.label).toBeTruthy();
    expect(len.fix.text.length).toBeLessThanOrEqual(140);
    expect(len.fix.text.length).toBeGreaterThan(40);
    expect(len.fix.removeReference).toBeUndefined();
    // Contact detail: the fix is the text without it.
    await set("intro", "Write to bob@client.example.invalid before Friday please");
    res = await check();
    const mail = res.issues.find((i: Loose) => i.slot === "intro" && i.kind === "sensitivity");
    expect(mail.fix.text).not.toContain("bob@");
    expect(mail.fix.text).toContain("before Friday");
    // Another client's name: said without the name, in the page's language.
    await set("whyUs", "We did this for Solana Demo SL last year and it held.");
    res = await check();
    const name = res.issues.find(
      (i: Loose) => i.slot === "whyUs" && i.kind === "customer-permission",
    );
    expect(name.fix.text).not.toMatch(/Solana/);
    expect(name.fix.text).toContain("the client");
    // Applying a fix clears its issue.
    await set("whyUs", name.fix.text);
    expect((await check()).issues.some((i: Loose) => i.slot === "whyUs")).toBe(false);
    // An empty required slot has a flag and no fix to offer.
    await set("cta", "");
    res = await check();
    expect(res.issues.find((i: Loose) => i.slot === "cta").fix).toBeUndefined();
  });

  it("shorten never cuts a word or exceeds the limit", () => {
    for (const max of [30, 90, 140]) {
      const out = shorten("Alpha beta gamma delta epsilon. ".repeat(12), max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out).toMatch(/[.]$/);
    }
    expect(shorten("short", 90)).toBe("short");
  });
});

describe("one language per page", () => {
  const ANGLES = [
    "AI governance",
    "security and compliance",
    "cloud migration",
    "data and analytics",
    "cost and finops",
    "transformation and change",
    "something else entirely",
  ];
  const EN_ONLY =
    /\b(the|your|with|and|for|our|you|that|from|teams|build|why|start|talk|shape|hello|engagements?|partner|delivery)\b/i;
  const FR_ONLY =
    /\b(pour|vous|votre|avec|nous|des|les|une|du|chez|pourquoi|bonjour|missions?|partenaire|livraison|parler|équipes)\b/i;
  const base = {
    prospect: { firstName: "Jo", role: "CIO", company: "Globex Holdings" },
    brand: "amaris" as const,
    refs: [] as Reference[],
  };

  it("French copy has no English template phrase, English none of the French", () => {
    for (const angle of ANGLES) {
      // The prospect's own words (role, company, name) are theirs; the rest is the template's.
      const strip = (t: string) =>
        t.replaceAll("Globex Holdings", "").replaceAll("CIO", "").replaceAll("Jo", "");
      const fr = composeDeterministic({ ...base, angle, lang: "fr" });
      const en = composeDeterministic({ ...base, angle, lang: "en" });
      for (const [k, v] of Object.entries(fr))
        expect(strip(v), `fr ${angle} ${k}: ${v}`).not.toMatch(EN_ONLY);
      for (const [k, v] of Object.entries(en))
        expect(strip(v), `en ${angle} ${k}: ${v}`).not.toMatch(FR_ONLY);
      expect(languageOf(fr.intro), angle).toBe("fr");
      expect(languageOf(en.intro), angle).toBe("en");
    }
  });

  it("the angle typed in the other language is not pasted into the page", () => {
    const fr = composeDeterministic({ ...base, angle: "Supply chain visibility", lang: "fr" });
    expect(JSON.stringify(fr)).not.toMatch(/Supply chain|visibility/i);
    const en = composeDeterministic({
      ...base,
      angle: "visibilité de la chaîne logistique",
      lang: "en",
    });
    expect(JSON.stringify(en)).not.toMatch(/visibilité|chaîne/i);
  });

  it("the phrase that stands for a client is in one language, whatever the sector says", () => {
    const facts = { Country: "France", Sector: "Retail" };
    expect(clientPhrase(facts, "en")).toBe("A European retail client");
    expect(clientPhrase(facts, "fr")).toBe("Un client européen du commerce de détail");
    // A sector the page cannot name in its language is left out, never printed in the other one.
    expect(clientPhrase({ Country: "Brazil", Sector: "Mining" }, "fr")).toBe("Un client des mines");
    expect(clientPhrase({ Country: "Brazil", Sector: "Quantum widgets" }, "fr")).toBe("Un client");
    expect(clientPhrase({ Country: "Brazil", Sector: "Quantum widgets" }, "en")).toBe("A client");
    expect(clientPhrase({ Country: "Spain", Sector: "banque" }, "en")).toBe(
      "A European banking client",
    );
  });

  it("a composed French page and its generalised references carry no English placeholder", async () => {
    const d = await compose("ceo", {
      lang: "fr",
      angle: "migration cloud",
      prospect: { ...PROSPECT, company: "Acme Synthetic SA" },
    });
    const text = JSON.stringify([
      d.slots,
      d.references.map((r: Loose) => [r.title, r.generalisedTitle]),
    ]);
    expect(text).not.toMatch(/the client|A European|European retail/i);
    expect(d.slots.hero).toMatch(/^Une migration cloud/);
    const gen = d.references.find((r: Loose) => r.permission === "generalised-only");
    expect(gen.title).toMatch(/^Un client/);
  });
});

describe("the AI composer keeps the page's language", () => {
  const on = {
    AI_ENABLED: "true",
    AI_PROCESSOR_CONTRACT: "approved",
    ANTHROPIC_API_KEY: "test-key-not-real",
  };
  const viaApp = async (body: Loose, answer: Loose) => {
    const app = createApp({
      jwks: () => createLocalJWKSet({ keys: [publicJwk] }),
      fetch: async () =>
        Response.json({
          stop_reason: "end_turn",
          model: "m",
          content: [{ type: "text", text: JSON.stringify(answer) }],
          usage: { input_tokens: 100, output_tokens: 80 },
        }),
    });
    const res = await app.fetch(
      new Request("https://secondary.example.test/v1/lp/compose", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": await sign("head_bid@example.invalid"),
          "X-Demo-Persona": "head_bid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      testEnv(on),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    return json(res);
  };

  it("an answer in the other language is refused; one in the right language is used", async () => {
    const english = {
      hero: "AI that your teams use every day, built for you",
      intro:
        "As the person in charge, you want a platform that works with your teams and for your clients.",
      whyUs:
        "We build with the people who run the process, and we hand over everything that we make.",
      caseStudyIntro: "Engagements that look like yours, from our teams.",
      cta: "Talk to us about your plan",
    };
    const d = await viaApp({ ...BODY, lang: "fr" }, english);
    // Every slot was English: the answer is refused as a whole and the French template is shown.
    expect(d.composedBy).toBe("deterministic");
    for (const v of Object.values(d.slots) as string[]) expect(languageOf(v) ?? "fr", v).toBe("fr");
    const french = {
      hero: "Une IA que vos équipes utilisent chaque jour, pour vous",
      intro: "Vous voulez une plateforme qui fonctionne avec vos équipes et pour vos clients.",
      whyUs:
        "Nous construisons avec les personnes qui font tourner le processus, et nous vous remettons tout.",
      caseStudyIntro: "Des missions qui ressemblent à la vôtre, avec nos équipes.",
      cta: "Parlons de votre plan",
    };
    const ok = await viaApp({ ...BODY, lang: "fr" }, french);
    expect(ok.composedBy).toBe("ai");
    expect(ok.slots.hero).toBe(french.hero);
    // One slot in English among French ones is replaced by the template's, the others stay.
    const mixed = await viaApp({ ...BODY, lang: "fr" }, { ...french, whyUs: english.whyUs });
    expect(mixed.composedBy).toBe("ai");
    expect(mixed.slots.hero).toBe(french.hero);
    expect(mixed.slots.whyUs).toMatch(/^Pourquoi Amaris/);
  });
});

describe("operations", () => {
  it("the lp switch can take published pages offline: audited, only for lp, restorable", async () => {
    const sub = await inReview();
    const { slug } = await publish(sub);
    const idle = await compose();
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).not.toBeNull();
    const off = (body: Loose) =>
      as("platform_admin", "/v1/admin/switches", {
        body: { switch: "lp", enabled: false, ...body },
      });
    // Not for another switch, and not when switching on.
    expect(
      (
        await as("platform_admin", "/v1/admin/switches", {
          body: { switch: "ai", enabled: false, takeOffline: true },
        })
      ).status,
    ).toBe(400);
    expect((await off({ takeOffline: "yes" })).status).toBe(400);
    // A plain switch-off leaves the page public (the owner can still unpublish).
    const plain = await off({});
    expect(await json(plain)).toMatchObject({ ok: true, status: "applied" });
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).not.toBeNull();
    const res = await off({ takeOffline: true });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pagesTakenOffline).toBeGreaterThanOrEqual(1);
    expect(await rawEnv.PAGES.head(`p/${slug}.html`)).toBeNull();
    // The record says unpublished, the approval and the draft are intact, nothing else changed.
    expect(
      await (async () => (await rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA)).get(sub.id))?.status)(),
    ).toBe("unpublished");
    expect((await rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA)).get(idle.id))?.status).toBe("draft");
    // Everything under /v1/lp is stopped, and the owner can publish again once the switch is back on.
    expect((await lp("ceo")).status).toBe(503);
    expect(
      (await as("platform_admin", "/v1/admin/switches", { body: { switch: "lp", enabled: true } }))
        .status,
    ).toBe(200);
    const again = await lp("ceo", `/${sub.id}/publish`, { body: {} });
    expect(again.status, await again.clone().text()).toBe(200);
  });

  it("erasing a person removes their pages and prospect data, and redacts them as a contact", async () => {
    const mine = await inReview();
    const live = await publish(mine);
    const other = await json(await lp("head_bid", "/compose", { body: BODY }));
    // Another person's page names the subject as its contact.
    const store = rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA));
    const own = await store.get(mine.id);
    expect(own?.ownerEmail).toBeTruthy();
    const put2 = await lp("head_bid", `/${other.id}`, {
      method: "PUT",
      body: {
        slots: other.slots,
        references: [],
        contact: { name: "Ceo Person", email: own?.ownerEmail },
        revision: other.revision,
      },
    });
    expect(put2.status, await put2.clone().text()).toBe(200);
    expect(JSON.stringify(await store.get(mine.id))).toContain("Globex");

    const subject = (await json(await as("ceo", "/v1/me"))).principal.id as string;
    const A = { email: "admin-a@example.invalid" };
    const B = { email: "admin-b@example.invalid" };
    const erase = (who: Loose) =>
      as("platform_admin", "/v1/admin/rights/erase", { ...who, body: { principal: subject } });
    expect((await erase(A)).status).toBe(202);
    const done = await erase(B);
    expect(done.status, await done.clone().text()).toBe(200);
    const summary = await json(done);
    expect(summary.landingPages.removed).toBeGreaterThanOrEqual(1);
    expect(summary.landingPages.redacted).toBe(1);

    // Gone: the record, its prospect, its public page.
    expect(await store.get(mine.id)).toBeNull();
    expect(await rawEnv.PAGES.head(`p/${live.slug}.html`)).toBeNull();
    const all = JSON.stringify(await store.exportAll());
    const hit = Object.entries((await store.exportAll()) as Loose).flatMap(([t, rows]) =>
      (rows as Loose[])
        .filter((r) => JSON.stringify(r).includes(own?.ownerEmail as string))
        .map((r) => [t, JSON.stringify(r).slice(0, 300)]),
    );
    expect(hit).toEqual([]);
    expect(all).not.toContain(own?.ownerEmail as string);
    expect(
      ((await store.exportAll()) as Loose).pages.some((p: Loose) => p.owner === own?.owner),
    ).toBe(false);
    // The other page lost the contact and is no longer approved or public.
    const left = await store.get(other.id);
    expect(left?.contact.email).toBe("");
    expect(left?.contact.name).not.toBe("Ceo Person");
    expect(left?.status).toBe("draft");
    // Idempotent.
    const again = await erase(A);
    expect([200, 202, 404, 409]).toContain(again.status);
  });

  it("the page store is in the backup and comes back whole; a page past its clock does not", async () => {
    const BACKUP_KEY = "test-backup-key-0123456789abcdef0123456";
    const deps = (): BackupDeps => ({
      BACKUPS: rawEnv.BLOBS,
      API: {
        fetch: (url: string, init: RequestInit) =>
          createApp().fetch(new Request(url, init), testEnv()),
      } as unknown as Fetcher,
      ENVIRONMENT: "staging",
      OPS_HMAC_KEY: (rawEnv as unknown as Env).OPS_HMAC_KEY as string,
      BACKUP_KEY,
      RESTORE_ENABLED: "yes",
    });
    const mk = await json(await lp("head_bid", "/compose", { body: BODY }));
    const store = rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA));
    // A page whose clock ran out before the snapshot was taken but was not purged yet.
    await store.create(
      {
        id: "lp_deadbeef00000001",
        owner: "u_head_bid",
        ownerEmail: "head_bid@example.invalid",
        brand: "amaris",
        lang: "en",
        prospect: { role: "CFO", company: "Overdue Holdings" },
        slots: mk.slots,
        references: [],
        contact: mk.contact,
        composer: "deterministic",
        expiresAt: Date.now() - 1_000,
      },
      Date.now() - 100_000,
    );
    // A page by someone erased earlier in this run: the erasure is applied again by the restore.
    const ghost = await compose("ceo");
    const before = JSON.stringify(await store.exportAll());
    await runBackup(deps());
    const date = new Date().toISOString().slice(0, 10);
    const key = `${date}/${ALPHA}/lp.jsonl.enc`;
    const bytes = new Uint8Array(
      (await (await rawEnv.BLOBS.get(key))?.arrayBuffer()) as ArrayBuffer,
    );
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw.startsWith("SBK1")).toBe(true);
    expect(raw).not.toContain("Globex");
    expect(raw).not.toContain("Overdue");
    // Damage the store, then restore it.
    await store.erasePerson(["u_head_bid"], ["head_bid@example.invalid"], "pseud", Date.now());
    expect(await store.get(mk.id)).toBeNull();
    const res = await restoreBackup(deps(), key);
    expect(res).toMatchObject({ ok: true, kind: "lp" });
    expect((await store.get(mk.id))?.prospect.company).toBe("Globex Holdings");
    // Past its clock: expired again at once, its prospect data not back.
    expect(await store.get("lp_deadbeef00000001")).toMatchObject({
      status: "expired",
      prospect: { role: "", company: "" },
    });
    // Erased since (u_ceo, earlier in this run): not back either.
    expect(await store.get(ghost.id)).toBeNull();
    expect(before).toContain(ghost.id);
  });
});

describe("a published page and its permission text", () => {
  it("the named reference shows the permitted words and nothing else of the client", async () => {
    const d = await compose("ceo", { prospect: { ...PROSPECT, company: "Acme Synthetic SA" } });
    const sub = await json(await lp("ceo", `/${d.id}/submit`, { body: {} }));
    const { html } = await publish(sub);
    expect(html).toContain(PERMITTED);
    expect(html).not.toContain("jane@");
    expect(html).not.toContain("35%");
  });
});
