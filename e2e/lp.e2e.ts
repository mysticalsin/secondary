// Landing Page Studio (docs/DESIGN-LP-STUDIO.md) against the dev-mock web app: compose, edit, check,
// submit, approve as a reviewer, publish, unpublish. Screenshots go to e2e/screens/lp-*.png.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { renderLandingPage, type TemplateData } from "../apps/web/src/lp-template/index.ts";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function as(
  browser: Browser,
  persona: string,
  w = 1440,
  h = 900,
  motion: "reduce" | "no-preference" = "reduce",
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: motion,
    locale: "en-CA",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  await page.addInitScript((p) => {
    if (!window.sessionStorage.getItem("e2e.persona.set")) {
      window.localStorage.setItem("secondary.persona", p);
      window.sessionStorage.setItem("e2e.persona.set", "1");
    }
  }, persona);
  return page;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const skip = page.getByRole("button", { name: "Skip the tour" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
}

/** Switch persona the way a person would in dev: the stored choice, then a fresh load. State survives in the tab. */
async function become(page: Page, persona: string, path: string) {
  await page.evaluate((p) => window.localStorage.setItem("secondary.persona", p), persona);
  await open(page, path);
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")} :: ${v.nodes[0]?.any[0]?.message ?? ""}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SCREENS}lp-${name}.png`, fullPage: true });

test.describe.configure({ mode: "serial" });

test("compose, edit, check, submit, approve as a reviewer, publish, unpublish", async ({
  browser,
}) => {
  const page = await as(browser, "head_bid");

  // The list: status chips, sparklines, expiry.
  await open(page, "/studio");
  const card = page.getByTestId("lp-card");
  await expect(card.getByRole("link", { name: "Head of Digital at Fabrikam" })).toBeVisible();
  await expect(card).toContainText("Published");
  await expect(card).toContainText("Expires in 62 days");
  await expect(card).toContainText("Expired");
  await expect(
    card.getByRole("img", { name: /Views per day over 7 days, 52 in total/ }),
  ).toBeVisible();
  await shot(page, "list-1440");
  await axe(page, "studio list");

  // Compose. The privacy note comes before anything is typed.
  await card.getByRole("button", { name: "New page" }).click();
  await expect(page.getByTestId("lp-privacy")).toContainText("personal data");
  await expect(page.getByTestId("lp-privacy")).toContainText("90 days");
  await page.getByLabel("Prospect first name (optional)").fill("Jo");
  await page.getByLabel("Prospect role").fill("Chief Data Officer");
  await page.getByLabel("Company").fill("Acme");
  await page.getByRole("button", { name: "AI governance" }).click();
  await shot(page, "composer-1440");
  await axe(page, "composer");
  await page.getByRole("button", { name: "Compose" }).click();

  // Editor: real-size preview, click-to-edit with a hover outline.
  await expect(page).toHaveURL(/\/studio\/lp\/lp_4$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Chief Data Officer at Acme" }),
  ).toBeVisible();
  const preview = page.frameLocator('iframe[title="Page preview"]');
  await expect(preview.locator("body")).toContainText(
    "Hello Jo. Here is what Amaris would build for Acme.",
  );
  await expect(preview.locator("body")).toContainText(
    "AI governance, built for Chief Data Officer at Acme.",
  );
  const hero = preview.getByRole("button", { name: /Edit Headline/ });
  await hero.hover();
  await expect(hero).toHaveCSS("outline-style", "solid");
  await expect(hero).toHaveCSS("outline-color", "rgb(248, 240, 96)");
  await shot(page, "editor-hover-1440");
  await axe(page, "editor");

  // A client name without permission is caught, blocks Submit, and is fixed in one click.
  await hero.click();
  const box = preview.getByRole("textbox", { name: "Headline" });
  await box.fill("Northwind Bank cut onboarding from five days to one.");
  await box.press("Enter");
  await expect(page.getByTestId("save-state")).toContainText("All changes saved");
  await page.getByRole("button", { name: /^Checks/ }).click();
  await expect(page.getByText("Names a client without permission on record")).toBeVisible();
  // aria-disabled keeps the button focusable and clickable, so the reason can be given.
  await page.getByRole("button", { name: "Submit for review" }).click({ force: true });
  await expect(page.getByTestId("submit-blocked")).toContainText("Fix the 1 open check first");
  await expect(page.getByRole("heading", { name: "In review" })).toHaveCount(0);
  await shot(page, "checks-blocked-1440");
  await axe(page, "checks blocked");
  await page.getByRole("button", { name: /Replace with "a European bank" in Headline/ }).click();
  await expect(page.getByText("All checks pass. This page can go to review.")).toBeVisible();
  await expect(preview.locator("body")).toContainText("a European bank cut onboarding");

  // References: Named and Generalised badges, a visual swap, the 6 maximum.
  await page.getByRole("button", { name: "References", exact: true }).click();
  await expect(page.getByTestId("ref-count")).toContainText("4 of 6 used");
  const refs = page
    .getByRole("list")
    .filter({ has: page.locator(".lp-ref") })
    .first();
  await expect(refs.getByText("Named").first()).toBeVisible();
  await expect(refs.getByText("Generalised").first()).toBeVisible();
  await expect(refs.getByText("No permission on record").first()).toBeVisible();
  const firstRef = refs.locator(".lp-ref").first();
  const before = await preview.locator(".case img").first().getAttribute("src");
  await firstRef.getByRole("button", { name: /Change the visual of/ }).click();
  await firstRef.getByRole("button", { name: "Visual 4" }).click();
  await expect
    .poll(() => preview.locator(".case img").first().getAttribute("src"))
    .not.toBe(before);
  for (const n of ["Wingtip", "Litware"]) {
    await page.getByLabel("Search the brain").fill(n);
    await page.getByRole("button", { name: new RegExp(`^Add ${n}`) }).click();
  }
  await expect(page.getByTestId("ref-count")).toContainText("6 of 6 used");
  await page.getByLabel("Search the brain").fill("Fabrikam");
  const over = page.getByRole("button", { name: /^Add Fabrikam/ });
  await expect(over).toHaveAttribute("aria-disabled", "true");
  await over.click({ force: true });
  await expect(page.getByTestId("ref-note")).toContainText("6 references at most");
  await page.getByLabel("Search the brain").fill("");
  await shot(page, "references-1440");
  await axe(page, "references");

  // The contact in the footer, and the phone preview.
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Dana Whitfield");
  await expect(preview.locator("body")).toContainText("Dana Whitfield");
  await page.getByRole("button", { name: "Phone" }).click();
  await expect(page.locator(".lp-device.phone")).toBeVisible();
  await expect(preview.locator("h1")).toBeVisible();
  await shot(page, "editor-phone-1440");
  await axe(page, "editor phone");
  await page.getByRole("button", { name: "Desktop" }).click();

  // Submit.
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("waiting for a reviewer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
  await shot(page, "in-review-1440");

  // A different person reviews it in Questions: rendered preview and diff, then approves.
  await become(page, "reviewer", "/questions");
  await page.getByRole("button", { name: /Approvals/ }).click();
  const q = page.getByRole("article", { name: /Landing page: Chief Data Officer at Acme/ });
  await expect(q.getByTestId("lp-review")).toBeVisible();
  await expect(q.frameLocator("iframe").locator("body")).toContainText(
    "a European bank cut onboarding",
  );
  const diff = q.getByRole("group", { name: "Changes since the previous revision" });
  await expect(diff).toContainText("a European bank cut onboarding");
  await expect(diff).toContainText("Dana Whitfield");
  await q.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}lp-review-1440.png` });
  await diff.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}lp-review-diff-1440.png` });
  await axe(page, "review");
  await q.getByRole("button", { name: "Approve page" }).click();
  await expect(q).toHaveCount(0);

  // The author publishes. Copy link with a UTM, then unpublish with an in-page confirmation.
  await become(page, "head_bid", "/studio/lp/lp_4");
  await expect(page.getByText("Approved. Editing is locked.")).toBeVisible();
  await shot(page, "approved-1440");
  await page.getByRole("button", { name: "Publish page" }).click();
  const link = page.getByLabel("Page link");
  await expect(link).toHaveValue(/^https:\/\/pages\.example\.invalid\/p\//);
  await page.getByText("Track where it is shared").click();
  await page.getByLabel("Source", { exact: true }).fill("linkedin");
  await page.getByLabel("Campaign").fill("acme-ai");
  await expect(link).toHaveValue(
    /utm_source=linkedin.*utm_campaign=acme-ai|utm_campaign=acme-ai.*utm_source=linkedin/,
  );
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied.").first()).toBeVisible();
  await expect(page.getByText(/Expires on/)).toBeVisible();
  await shot(page, "published-1440");
  await axe(page, "published");

  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.getByRole("group", { name: "Unpublish this page?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep it published" })).toBeFocused();
  await shot(page, "unpublish-confirm-1440");
  await page.getByRole("button", { name: "Unpublish page" }).click();
  await expect(page.getByText("Unpublished. The link no longer opens.").first()).toBeVisible();
  await shot(page, "unpublished-1440");
  await page.context().close();
});

test("the author cannot approve their own page", async ({ browser }) => {
  const page = await as(browser, "reviewer");
  await open(page, "/studio");
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Prospect role").fill("CIO");
  await page.getByLabel("Company").fill("Tailspin");
  await page.getByLabel("Angle").fill("Data platform adoption");
  await page.getByRole("button", { name: "Compose" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("waiting for a reviewer")).toBeVisible();
  await open(page, "/questions");
  await expect(page.getByRole("article", { name: /Landing page: CIO at Tailspin/ })).toHaveCount(0);
  await page.context().close();
});

test("French: the studio, composer and editor render in French", async ({ browser }) => {
  const page = await as(browser, "head_bid");
  await open(page, "/studio");
  await page.getByRole("button", { name: "FR Français" }).click();
  await expect(page.getByRole("button", { name: "Nouvelle page" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle page" }).click();
  await expect(page.getByTestId("lp-privacy")).toContainText("données personnelles");
  await shot(page, "composer-fr-1440");
  await page.getByRole("button", { name: "Annuler" }).click();
  await page.context().close();
});

for (const [wl, w, h] of [
  ["1280", 1280, 900],
  ["400", 400, 860],
  ["390", 390, 844],
] as const) {
  test(`composer at ${wl}: axe, no overflow, screenshot`, async ({ browser }) => {
    const page = await as(browser, "head_bid", w, h);
    await open(page, "/studio");
    await page.getByRole("button", { name: "New page" }).click();
    await expect(page.getByTestId("lp-privacy")).toBeVisible();
    await noOverflow(page);
    await axe(page, `composer ${wl}`);
    await shot(page, `composer-${wl}`);
    await page.context().close();
  });
}

test("the page assembles in stages", async ({ browser }) => {
  const page = await as(browser, "head_bid", 1440, 900, "no-preference");
  await open(page, "/studio");
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Prospect role").fill("Head of Digital");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Angle").fill("AI governance");
  await page.getByRole("button", { name: "Compose" }).click();
  const asm = page.getByTestId("lp-assemble");
  await expect(asm).toBeVisible();
  await expect(asm.getByText("Writing the headline")).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, "assembling-1440");
  await expect(page).toHaveURL(/\/studio\/lp\/lp_\d+$/, { timeout: 8000 });
  await page.context().close();
});

for (const [name, path, persona] of [
  ["studio", "/studio", "head_bid"],
  ["editor-draft", "/studio/lp/lp_2", "head_bid"],
  ["editor-published", "/studio/lp/lp_1", "head_bid"],
  ["editor-expired", "/studio/lp/lp_3", "head_bid"],
] as const) {
  for (const [wl, w, h] of [
    ["1280", 1280, 900],
    ["1440", 1440, 900],
    ["400", 400, 860],
    ["390", 390, 844],
  ] as const) {
    test(`${name} at ${wl}: axe, no overflow, screenshot`, async ({ browser }) => {
      const page = await as(browser, persona, w, h);
      await open(page, path);
      await noOverflow(page);
      await axe(page, `${name} ${wl}`);
      await shot(page, `${name}-${wl}`);
      if (name === "editor-draft") {
        await page.getByRole("button", { name: "Phone" }).click();
        await noOverflow(page);
        await axe(page, `${name} phone ${wl}`);
        await page.getByRole("button", { name: "Checks", exact: false }).first().click();
        await axe(page, `${name} checks ${wl}`);
        await shot(page, `editor-draft-checks-${wl}`);
      }
      await page.context().close();
    });
  }
}

// The public page itself, as the visitor gets it: no app around it.
const SAMPLE: TemplateData = {
  brand: "amaris",
  lang: "en",
  prospect: { firstName: "Claire", role: "CFO", company: "Contoso" },
  slots: {
    hero: "Supply chain visibility that your plants actually use.",
    intro:
      "Claire, you own cost and risk across twelve plants. Here is how we would give you one view, in small steps.",
    whyUs:
      "We ship in small steps, show results at every step and leave your teams holding the keys to what we build.",
    caseStudyIntro: "Work close to your situation",
    cta: "Let's talk about your next step. One message is enough to book 30 minutes.",
  },
  references: [
    {
      title: "Acme retail platform migration",
      summary: "Moved 40 stores to one platform in nine months, with no trading day lost.",
      permission: "named",
      metric: { value: "40 stores", label: "on one platform" },
    },
    {
      title: "Northwind Bank KYC automation",
      summary: "Cut onboarding checks from five days to one with a reviewed AI assistant.",
      permission: "generalised-only",
      generalisedTitle: "A European bank: KYC automation",
    },
    {
      title: "Contoso control tower",
      summary: "One view of orders, stock and delays across 12 plants.",
      permission: "generalised-only",
      generalisedTitle: "A global manufacturer: control tower",
    },
  ],
  contact: { name: "Sam Rowe", title: "Head of Bid and Pre-sales", email: "sam@example.invalid" },
  expiresAt: "2027-02-03T00:00:00.000Z",
};

for (const [lang, brand] of [
  ["en", "amaris"],
  ["fr", "mantu"],
] as const) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`public page ${brand}/${lang} at ${w}: axe, no overflow, screenshot`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await page.setContent(renderLandingPage({ ...SAMPLE, lang, brand }));
      await noOverflow(page);
      await axe(page, `public page ${brand} ${w}`);
      await page.screenshot({
        path: `${SCREENS}lp-public-${brand}-${lang}-${w}.png`,
        fullPage: true,
      });
      await ctx.close();
    });
  }
}
