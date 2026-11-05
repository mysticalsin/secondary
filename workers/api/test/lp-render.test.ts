// The output of every template (docs/API-CONTRACT.md "Landing Page Studio", LandingRenderData): static
// HTML, no external request, one inline script at most (the consent and beacon script, allowed by its
// hash), consent that declines by default, and images only from the pages bucket, never from the brain.

import { describe, expect, it } from "vitest";
import { type LandingRenderData, PALETTE, renderLandingPage } from "../src/lp/render.ts";

const SLUG = "0123456789abcdef0123456789abcdef";
const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const data = (over: Partial<LandingRenderData> = {}): LandingRenderData => ({
  brand: "amaris",
  lang: "en",
  prospect: { firstName: "Jo", role: "CIO", company: "Globex Holdings" },
  slots: {
    hero: "A cloud move your teams can run",
    intro: "First paragraph.\n\nSecond paragraph.",
    whyUs: "Why us text.",
    caseStudyIntro: "Our work.",
    cta: "Start the conversation",
  },
  references: [
    { title: "Retail cloud move", summary: "A summary.", image: `/p/${SLUG}/i/0` },
    { title: "Second", summary: "Another." },
  ],
  contact: { name: "Alex Doe", email: "alex@example.invalid" },
  mode: "published",
  ...over,
});

const URLISH =
  /(?:src|href|action|poster|srcset|data|content)=["']\s*(?!#|mailto:|\/p\/[0-9a-f]{32}\/i\/|data:image\/|width=|noindex|no-referrer|text\/|utf-8)[^"']*(?:https?:)?\/\//i;

describe("every template's output", () => {
  const html = renderLandingPage(data());

  it("is a static, self-contained document with no external request", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    // No absolute URL anywhere: nothing the browser would fetch, no tracker, no font, no CDN.
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\/\/[a-z0-9-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/@import|url\(|<link|<iframe|<object|<embed|<form|<base|srcset/i);
    expect(html).not.toMatch(URLISH);
    expect(html).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|import\(|eval\(|document\.write|localStorage|document\.cookie/,
    );
    // The only script is inline and the only way out is a beacon to the page's own address.
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[1]).toBe("");
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain("sendBeacon(p,");
    expect(html).toContain('location.pathname.replace(/\\/+$/,"")+"/e"');
  });

  it("the preview has no script at all", () => {
    const preview = renderLandingPage(data({ mode: "preview" }));
    expect(preview).not.toMatch(/<script/i);
    expect(preview).toContain('id="consent"');
  });

  it("declines non-essential tracking by default and sets no cookie", () => {
    // The banner is hidden until the script decides; with no script nothing is ever counted.
    expect(html).toMatch(/<div id="consent"[^>]* hidden>/);
    expect(html.indexOf('<button type="button" data-no>')).toBeLessThan(
      html.indexOf('<button type="button" data-yes>'),
    );
    expect(html).toContain('if(s==="1")start();else if(s!=="0")');
    expect(html).not.toMatch(/Set-Cookie|cookie=/i);
    // Every event carries the consent flag the pages worker requires, and only after Accept.
    expect(html).toContain("o.c=true");
    expect(html.indexOf("function start")).toBeLessThan(html.indexOf('send({k:"view"})'));
    expect(html).toContain("sessionStorage");
    expect(html).not.toContain("localStorage");
  });

  it("uses the brand: Carlito then Calibri, the palette, responsive, accessible", () => {
    expect(html).toContain("font-family:Carlito,Calibri");
    for (const c of Object.values(PALETTE)) expect(html).toContain(c);
    expect(html).toContain('name="viewport"');
    expect(html).toContain("@media");
    expect(html).toContain('class="skip"');
    expect(html).toContain(":focus-visible");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    expect(html).toMatch(/<img [^>]*alt="">/);
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
    // Mailto with a pre-filled message: the visitor sends it; nothing is sent by the page.
    expect(html).toContain('href="mailto:alex@example.invalid?subject=');
    expect(html).not.toMatch(/\.png|\.jpe?g/);
  });

  it("escapes everything it is given", () => {
    const evil = renderLandingPage(
      data({
        slots: { ...data().slots, hero: '<script>alert(1)</script>"><img src=x onerror=alert(1)>' },
        references: [{ title: "<b>x</b>", summary: "</article><script>1</script>" }],
        prospect: { firstName: "<i>", role: "CIO", company: 'Evil" onload="x' },
      }),
    );
    expect(evil).not.toContain("<script>alert");
    expect(evil).not.toMatch(/<(?:b|i)>/);
    expect(evil).not.toMatch(/<img[^>]*onerror/i);
    expect(evil).not.toMatch(/<img src=x/);
    expect((evil.match(/<script/g) ?? []).length).toBe(1);
  });

  it("French is French", () => {
    const fr = renderLandingPage(data({ lang: "fr" }));
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain("Aller au contenu");
    expect(fr).toContain("Refuser");
  });
});

describe("images", () => {
  const imgs = (h: string): string[] =>
    [...h.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1] as string);

  it("a published page shows only an image copied into its own bucket at publish time", () => {
    expect(imgs(renderLandingPage(data()))).toEqual([`/p/${SLUG}/i/0`]);
    for (const bad of [
      "https://brain.example.invalid/asset.png",
      "http://x/y.png",
      "//cdn.example.invalid/a.png",
      TINY,
      "/p/other/i/0",
      `/p/${SLUG}/i/9`,
      `/p/${SLUG}/i/0/../../x`,
      "javascript:alert(1)",
      "/v1/wiki/a_acme/pages/x",
    ]) {
      const h = renderLandingPage(data({ references: [{ title: "T", summary: "S", image: bad }] }));
      expect(imgs(h), bad).toEqual([]);
      expect(h, bad).not.toContain("<img");
    }
  });

  it("the review preview may show a small inline data image and nothing else", () => {
    const ok = renderLandingPage(
      data({ mode: "preview", references: [{ title: "T", summary: "S", image: TINY }] }),
    );
    expect(imgs(ok)).toEqual([TINY]);
    for (const bad of [
      "https://brain.example.invalid/a.png",
      `/p/${SLUG}/i/0`,
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      const h = renderLandingPage(
        data({ mode: "preview", references: [{ title: "T", summary: "S", image: bad }] }),
      );
      expect(imgs(h), bad).toEqual([]);
    }
  });
});
