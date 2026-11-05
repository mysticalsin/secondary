import { describe, expect, it } from "vitest";
import { renderLandingPage, type TemplateData } from "../lp-template";

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
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
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

  it("drops image URLs that are not data: or https:", () => {
    const base = data().references[0] as TemplateData["references"][number];
    const html = renderLandingPage(
      data({
        references: [
          { ...base, image: "javascript:alert(1)" },
          { ...base, title: "Two", image: "https://img.example.invalid/a.png" },
        ],
      }),
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("https://img.example.invalid/a.png");
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
