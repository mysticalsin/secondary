import { describe, expect, it } from "vitest";
import { renderLandingPage, type TemplateData } from "../src/index.ts";

const data = (over: Partial<TemplateData> = {}): TemplateData => ({
  brand: "amaris",
  lang: "en",
  prospect: { firstName: "Claire", role: "CFO", company: "Contoso" },
  slots: {
    hero: "Visibility across twelve plants.",
    intro: "Claire, you own this topic.",
    whyUs: "We ship in small steps.",
    caseStudyIntro: "Projects close to you.",
    cta: "Let's talk.",
  },
  references: [
    {
      title: "Acme retail platform migration",
      summary: "One platform for 40 stores.",
      permission: "named",
      metric: { value: "40 stores", label: "on one platform" },
    },
    {
      title: "Northwind Bank KYC automation",
      summary: "Onboarding checks in one day.",
      permission: "generalised-only",
      generalisedTitle: "A European bank: KYC automation",
      metric: { value: "5 days to 1", label: "onboarding" },
    },
  ],
  contact: { name: "Sam Rowe", title: "Sales owner", email: "sam@example.invalid" },
  ...over,
});

describe("landing page template", () => {
  it("is plain HTML: no script, no external request", () => {
    const html = renderLandingPage(data());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    expect(html).toContain("Hello Claire. Here is what Amaris would build for Contoso.");
  });

  it("never shows a client name or metric without permission", () => {
    const html = renderLandingPage(data());
    expect(html).toContain("Acme retail platform migration");
    expect(html).toContain("40 stores");
    expect(html).toContain("A European bank: KYC automation");
    expect(html).toContain("Client name kept private");
    expect(html).not.toContain("Northwind");
    expect(html).not.toContain("5 days to 1");
  });

  it("escapes everything a person can type", () => {
    const html = renderLandingPage(
      data({
        slots: { ...data().slots, hero: '<img src=x onerror="alert(1)">' },
        contact: { name: "A&B", email: '"><script>1</script>@example.invalid' },
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>1");
    expect(html).toContain("A&#38;B");
  });

  it("shows an image only as an inline data: image, or as the pages worker's own path once published", () => {
    const base = data().references[0] as TemplateData["references"][number];
    const SLUG = "0123456789abcdef0123456789abcdef";
    const PNG = `data:image/png;base64,${"A".repeat(40)}`;
    const refs = (image: string) => [{ ...base, image }];
    // Never a URL, in any mode.
    for (const bad of [
      "javascript:alert(1)",
      "https://img.example.invalid/a.png",
      "//cdn.example.invalid/a.png",
      "data:text/html;base64,PHNjcmlwdD4=",
    ])
      for (const mode of ["public", "published", "edit", "thumb"] as const)
        expect(renderLandingPage(data({ references: refs(bad) }), { mode }), bad).not.toContain(
          "<img",
        );
    expect(renderLandingPage(data({ references: refs(PNG) }))).toContain(`<img src="${PNG}"`);
    expect(renderLandingPage(data({ references: refs(PNG) }), { mode: "published" })).not.toContain(
      "<img",
    );
    expect(
      renderLandingPage(data({ references: refs(`/p/${SLUG}/i/2`) }), { mode: "published" }),
    ).toContain(`<img src="/p/${SLUG}/i/2"`);
    expect(renderLandingPage(data({ references: refs(`/p/${SLUG}/i/2`) }))).not.toContain("<img");
  });

  it("puts the nonce on the one style and uses no inline style attribute", () => {
    const html = renderLandingPage(data(), { nonce: "abc123" });
    expect(html).toContain('<style nonce="abc123">');
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("the published page has the consent banner, hidden, and the one beacon script; the others have no script", () => {
    const pub = renderLandingPage(data(), { mode: "published" });
    expect([...pub.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(["<script>"]);
    expect(pub).toMatch(/<div id="consent"[^>]* hidden>/);
    expect(pub.indexOf("data-no>")).toBeLessThan(pub.indexOf("data-yes>"));
    expect(pub).toContain("o.c=true");
    expect(pub).not.toMatch(/localStorage|document\.cookie/);
    for (const mode of ["public", "edit", "thumb"] as const)
      expect(renderLandingPage(data(), { mode })).not.toMatch(/<script/i);
  });

  it("makes no claim it cannot back: the closing date is the page's own", () => {
    const html = renderLandingPage(data({ expiresAt: "2027-02-03T10:00:00Z" }));
    expect(html).toContain("February 3, 2027");
    expect(html).not.toMatch(/2 people|read this page before/);
    expect(renderLandingPage(data())).not.toMatch(/\b90 days\b/);
  });

  it("is in one language only", () => {
    const EN =
      /Hello|Here is what|See related work|How we work|We listen first|Write to|Reviewed|Skip to content|Decline|Accept\b/;
    const FR =
      /Bonjour|Voici ce qu|Voir des travaux|Notre façon|On écoute|Écrire à|Relue|Aller au contenu|Refuser|Accepter/;
    const en = renderLandingPage(data({ lang: "en" }), { mode: "published" });
    const fr = renderLandingPage(data({ lang: "fr" }), { mode: "published" });
    expect(en).not.toMatch(FR);
    expect(fr).not.toMatch(EN);
  });

  it("speaks French with the right elision, and hooks slots only in edit mode", () => {
    const fr = renderLandingPage(data({ lang: "fr" }));
    expect(fr).toContain("Bonjour Claire. Voici ce qu&#39;Amaris construirait pour Contoso.");
    expect(fr).not.toContain("data-slot");
    const edit = renderLandingPage(data(), { mode: "edit" });
    expect(edit).toContain('data-slot="hero"');
    expect(edit).toContain('role="button"');
  });
});
