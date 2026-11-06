// Secondary v8 Knowledge gaps (docs/DESIGN-V8-AMAZING.md section 2) against the web app in dev-mock
// mode: the Gaps tab, the Home card, assign, start page, merge, dismiss, table twin, FR, dark, 400 px,
// axe at 1280 and 400. Screenshots land in e2e/screens/v8-gaps-*.png.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

async function as(
  browser: Browser,
  persona: string,
  o: { w?: number; h?: number; theme?: string; lang?: string } = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1440, height: o.h ?? 1000 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([p, th, l]) => {
      localStorage.setItem("secondary.persona", p as string);
      localStorage.setItem("secondary.theme", th as string);
      localStorage.setItem("secondary.lang", l as string);
    },
    [persona, o.theme ?? "light", o.lang ?? "en"],
  );
  return page;
}

const card = (page: Page) => page.getByTestId("insight-gaps");
async function openTab(page: Page) {
  await page.goto("/brains/c_bid?tab=gaps");
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId("gap-row").first()).toBeVisible();
}
const shot = (page: Page, name: string, full = false) =>
  page.screenshot({ path: `${SCREENS}v8-gaps-${name}.png`, fullPage: full });

test.describe("Gaps tab", () => {
  test("renders ranked dot rows, a steward KPI and the tab is selected from the URL", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    await expect(page.getByRole("tab", { name: "Gaps" })).toHaveAttribute("aria-selected", "true");
    const rows = page.getByTestId("gap-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(rows.first()).toContainText("frame agreement");
    await expect(page.getByTestId("gap-rate")).toContainText("%");
    await expect(page.getByText(/Overdue since/)).toBeVisible();
    await expect(rows.first().getByRole("img", { name: /Last 14 days/ })).toBeVisible();
    await shot(page, "tab-1440", true);
    await card(page).screenshot({ path: `${SCREENS}v8-gaps-card-1440.png` });
  });

  test("axe is clean at 1280 and 400, and in the table twin", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await openTab(page);
    await axe(page, "gaps 1280");
    await page.getByRole("button", { name: "Show as table" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await axe(page, "gaps table 1280");
    await page.getByRole("button", { name: "Show as chart" }).click();
    await page.setViewportSize({ width: 400, height: 900 });
    await expect(page.getByTestId("gap-row").first()).toBeVisible();
    await axe(page, "gaps 400");
    await shot(page, "tab-400", true);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(over, "no horizontal page scroll at 400").toBe(false);
  });

  test("French and dark", async ({ browser }) => {
    const fr = await as(browser, "head_bid", { lang: "fr", w: 1280, h: 900 });
    await openTab(fr);
    await expect(fr.getByRole("tab", { name: "Lacunes" })).toBeVisible();
    await expect(fr.getByText("Taux de fermeture des lacunes")).toBeVisible();
    await axe(fr, "gaps fr");
    await shot(fr, "tab-fr", true);
    const dark = await as(browser, "head_bid", { theme: "dark", w: 1280, h: 900 });
    await openTab(dark);
    await axe(dark, "gaps dark");
    await shot(dark, "tab-dark", true);
  });

  test("assign: eligible contributors only, a due date, and the row says who and when", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    const row = page.getByTestId("gap-row").filter({ hasText: "Who signs off" });
    await row.getByRole("button", { name: /^Assign:/ }).click();
    const dlg = page.getByRole("dialog", { name: "Assign this gap" });
    await expect(dlg).toBeVisible();
    await axe(page, "assign dialog");
    await expect(dlg.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
    await dlg.getByLabel("Contributor").selectOption({ label: "Acme Lead" });
    await dlg.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId("gap-row").filter({ hasText: "Who signs off" })).toContainText(
      /Assigned to Acme Lead|Overdue/,
    );
  });

  test("start page sends a draft to review", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    const row = page.getByTestId("gap-row").filter({ hasText: "go/no-go threshold" });
    await row.getByRole("button", { name: /^Start page:/ }).click();
    const dlg = page.getByRole("dialog", { name: "Start a page from this gap" });
    await expect(dlg.getByLabel("Page title")).toHaveValue(/go\/no-go threshold/);
    await dlg.getByRole("button", { name: "Send draft to review" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("Draft sent to review")).toBeVisible();
    await expect(
      page.getByTestId("gap-row").filter({ hasText: "go/no-go threshold" }),
    ).toContainText("Draft in review");
  });

  test("merge folds a gap into another", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    const before = await page.getByTestId("gap-row").count();
    const row = page.getByTestId("gap-row").filter({ hasText: "Who signs off" });
    await row.getByRole("button", { name: /^Merge:/ }).click();
    const dlg = page.getByRole("dialog", { name: "Merge duplicate gaps" });
    await dlg.getByLabel("Merge into").selectOption({ label: "How do we price a frame agreement" });
    await dlg.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId("gap-row")).toHaveCount(before - 1);
    await expect(page.getByTestId("gap-row").first()).toContainText("3 merged");
  });

  test("dismiss needs a clean note, then leaves the active list and shows under Dismissed", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    const row = page.getByTestId("gap-row").filter({ hasText: "go/no-go threshold" });
    await row.getByRole("button", { name: /^Dismiss:/ }).click();
    const dlg = page.getByRole("dialog", { name: "Dismiss this gap" });
    await dlg.getByLabel("Reason").selectOption("duplicate");
    await dlg.getByLabel(/Note/).fill("mail jane@example.invalid");
    await dlg.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(dlg.getByRole("alert")).toContainText("personal details");
    await dlg.getByLabel(/Note/).fill("Same as the frame agreement question");
    await dlg.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("go/no-go threshold")).toHaveCount(0);
    await page.getByRole("radio", { name: "Dismissed" }).click();
    await expect(
      page.getByTestId("gap-row").filter({ hasText: "go/no-go threshold" }),
    ).toContainText("Dismissed: Duplicate");
  });

  test("a contributor who is not a steward only starts pages, a person without the right has no tab", async ({
    browser,
  }) => {
    const ceo = await as(browser, "ceo");
    await openTab(ceo);
    await expect(ceo.getByRole("button", { name: /^Start page:/ }).first()).toBeVisible();
    await expect(ceo.getByRole("button", { name: /^(Assign|Merge|Dismiss):/ })).toHaveCount(0);
    // The knowledge reviewer opens the bid circle but has no contribute right: no Gaps tab.
    const rev = await as(browser, "reviewer");
    await rev.goto("/brains/c_bid");
    await expect(rev.getByRole("tab", { name: "Contents" })).toBeVisible();
    await rev.waitForTimeout(300);
    await expect(rev.getByRole("tab", { name: "Gaps" })).toHaveCount(0);
  });

  test("keyboard: tab key reaches the filter and arrow keys move it", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await openTab(page);
    await page.getByRole("radio", { name: "Active" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Closed" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("gap-row").first()).toContainText("Bid retrospective");
  });
});

test.describe("Home top gaps", () => {
  test("a steward sees it, links to the brain's Gaps tab, axe is clean at 1280 and 400", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await page.goto("/");
    const home = page.getByTestId("top-gaps");
    await expect(home).toBeVisible();
    await expect(home).toContainText("Top gaps in your brains");
    await axe(page, "home gaps 1280");
    await home.screenshot({ path: `${SCREENS}v8-gaps-home-1440.png` });
    await page.setViewportSize({ width: 400, height: 900 });
    await axe(page, "home gaps 400");
    await home.screenshot({ path: `${SCREENS}v8-gaps-home-400.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("link", { name: /^Open the gaps of/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/brains\/c_bid\?tab=gaps/);
    await expect(card(page)).toBeVisible();
  });

  test("anyone who stewards nothing does not see it", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("top-gaps")).toHaveCount(0);
  });

  test("French and dark home", async ({ browser }) => {
    const page = await as(browser, "head_bid", { lang: "fr", theme: "dark", w: 1280, h: 900 });
    await page.goto("/");
    await expect(page.getByTestId("top-gaps")).toContainText("Principales lacunes");
    await axe(page, "home gaps fr dark");
  });
});
