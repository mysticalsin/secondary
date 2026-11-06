// Secondary v8 page lens, Who knows, command palette, faceted search and pulse
// (docs/DESIGN-V8-AMAZING.md sections 3 to 7) against the web app in dev-mock mode: keyboard, table
// twins, no leakage between roles, the expert opt-out, FR, dark, 400 px and axe at 1280 and 400.
// Screenshots land in e2e/screens/v8-lens-*.png.
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

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SCREENS}v8-lens-${name}.png`, fullPage: false });
const mod = process.platform === "darwin" ? "Meta" : "Control";
const combo = (page: Page) =>
  page
    .getByRole("dialog", { name: /Search and commands|Recherche et commandes/ })
    .getByRole("combobox");

async function openPage(page: Page, brain = "c_bid", id = "bid-playbook") {
  await page.goto(`/brains/${brain}/pages/${id}`);
  await expect(page.getByTestId("lens-rail")).toBeVisible();
  await expect(page.getByTestId("lens-graph")).toBeVisible();
  await settle(page);
}

test.describe("page lens", () => {
  test("header, rail cards, graph, facts and the screenshot at 1440", async ({ browser }) => {
    const page = await as(browser, "head_bid", { h: 1900 });
    await openPage(page);
    const head = page.getByTestId("lens-header");
    await expect(head.getByText("Bid & Pre-sales")).toBeVisible();
    await expect(head.getByText("Published")).toBeVisible();
    await expect(head.getByText(/Changed .* by Grace Hopper/)).toBeVisible();
    const rail = page.getByTestId("lens-rail");
    await expect(rail.getByRole("heading", { name: "Trust" })).toBeVisible();
    await expect(rail.getByText("Fresh", { exact: true })).toBeVisible();
    await expect(rail.getByText("Verified by Grace Hopper")).toBeVisible();
    // graph: this page, linked pages in the same brain, and Company Global
    const graph = page.getByTestId("lens-graph");
    await expect(
      graph.getByRole("group", { name: /Pages linked with Bid playbook/ }),
    ).toBeVisible();
    await expect(graph.getByRole("link", { name: /Bid qualification checklist/ })).toBeVisible();
    await expect(graph.getByText("Another brain")).toBeVisible();
    // who knows and contributors
    const who = page.getByTestId("who-knows");
    await expect(who.getByText("Grace Hopper").first()).toBeVisible();
    await expect(who.getByText(/approved changes/).first()).toBeVisible();
    await expect(page.getByTestId("lens-contributors").getByText("Alan Turing")).toBeVisible();
    await shot(page, "page-1440");
    // The graph node opens the neighbour.
    await graph
      .getByRole("link", { name: /Pricing guide/ })
      .first()
      .click();
    await expect(page).toHaveURL(/pages\/pricing-guide$/);
    await expect(page.getByRole("heading", { name: "Pricing guide", level: 1 })).toBeVisible();
    await expect(page.getByTestId("lens-facts").getByText("Conflict").first()).toBeVisible();
    await settle(page);
    await shot(page, "facts-1440");
  });

  test("table twins carry the same data as the graph, the facts and the people", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await openPage(page, "c_bid", "pricing-guide");
    for (const id of ["lens-graph", "lens-facts", "who-knows"]) {
      const card = page.getByTestId(id);
      await card.getByRole("button", { name: "Show as table" }).click();
      await expect(card.getByRole("table")).toBeVisible();
      await expect(card.getByRole("table").locator("tbody tr").first()).toBeVisible();
    }
    const facts = page.getByTestId("lens-facts").getByRole("table");
    await expect(facts.getByText("Conflict")).toBeVisible();
    await expect(facts.getByText("Still true").first()).toBeVisible();
  });

  test("axe at 1280 and at 400, with the rail below the page", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await openPage(page, "c_bid", "pricing-guide");
    await axe(page, "page lens 1280");
    await page.setViewportSize({ width: 400, height: 900 });
    await settle(page);
    await axe(page, "page lens 400");
    const noScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(noScroll).toBe(true);
    await shot(page, "page-400");
  });

  test("French and dark", async ({ browser }) => {
    const page = await as(browser, "head_bid", { lang: "fr", theme: "dark" });
    await openPage(page, "c_bid", "pricing-guide");
    await expect(
      page.getByTestId("lens-rail").getByRole("heading", { name: "Confiance" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("who-knows").getByRole("heading", { name: "Qui connaît" }),
    ).toBeVisible();
    await axe(page, "page lens fr dark");
    await shot(page, "page-fr-dark");
  });

  test("a role that cannot read the brain finds nothing: the page, the graph, the people", async ({
    browser,
  }) => {
    const page = await as(browser, "consultant");
    await page.goto("/brains/c_bid/pages/bid-playbook");
    await expect(page.getByTestId("lens-rail")).toHaveCount(0);
    await expect(page.getByText("Grace Hopper")).toHaveCount(0);
    // A page of Company Global that links to the bid brain's pages shows only what the consultant reads.
    await page.goto("/brains/core/pages/success-stories");
    await expect(page.getByTestId("lens-graph")).toBeVisible();
    await settle(page);
    const text = await page.getByTestId("lens-rail").innerText();
    // The bid brain's pricing guide links here, and the playbook is a bid page the role cannot read.
    expect(text).not.toContain("Pricing guide");
    expect(text).not.toContain("Bid playbook");
  });
});

test.describe("who knows", () => {
  test("on the brain page, by collection, and the expert opt-out is honoured everywhere", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid");
    const card = page.getByTestId("who-knows-brain");
    await expect(card.getByText("Grace Hopper")).toBeVisible();
    await card.getByRole("combobox", { name: "Collection" }).selectOption({ index: 1 });
    await expect(card).toBeVisible();
    await shot(page, "brain-whoknows-1440");
    // Leave the listing in Settings > Privacy.
    await page.goto("/settings/privacy");
    const box = page.getByRole("checkbox", { name: /Leave me out of Who knows/ });
    await expect(box).toBeVisible();
    await box.check();
    await expect(
      page.getByRole("status").filter({ hasText: "You are no longer listed." }),
    ).toBeVisible();
    await page.goto("/brains/c_bid");
    await expect(page.getByTestId("who-knows-brain").getByText("Grace Hopper")).toHaveCount(0);
    await openPage(page);
    await expect(page.getByTestId("lens-rail").getByText("Grace Hopper")).toHaveCount(0);
    await expect(page.getByTestId("lens-contributors")).toContainText("chose not to be listed");
    await expect(page.getByTestId("lens-header").getByText(/by Grace Hopper/)).toHaveCount(0);
    await page.goto("/settings/privacy");
    await page.getByRole("checkbox", { name: /Leave me out of Who knows/ }).uncheck();
    await expect(
      page.getByRole("status").filter({ hasText: "You are listed again." }),
    ).toBeVisible();
  });
});

test.describe("command palette", () => {
  test("opens with the shortcut, filters, moves with the arrows, runs, and gives focus back", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/");
    await settle(page);
    await page.getByRole("link", { name: "Brains" }).first().focus();
    await page.keyboard.press(`${mod}+k`);
    const dlg = page.getByRole("dialog", { name: "Search and commands" });
    await expect(dlg).toBeVisible();
    const input = dlg.getByRole("combobox");
    await expect(input).toBeFocused();
    await expect(dlg.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await shot(page, "palette-empty-1440");
    await input.fill("pricing");
    await expect(dlg.getByRole("option", { name: /Pricing guide/ })).toBeVisible();
    await expect(dlg.getByRole("status")).toContainText(/\d+ results?/);
    await shot(page, "palette-pages-1440");
    // Arrow keys move the active option; aria-activedescendant follows.
    const first = await input.getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    const second = await input.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    await page.keyboard.press("ArrowUp");
    expect(await input.getAttribute("aria-activedescendant")).toBe(first);
    // Escape closes and the focus returns where it was.
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Brains" }).first()).toBeFocused();
    // Run a page: Enter navigates to it, and it is a recent item next time.
    await page.keyboard.press(`${mod}+k`);
    await combo(page).fill("pricing guide");
    await expect(page.getByRole("option", { name: /Pricing guide/ }).first()).toBeVisible();
    await combo(page).press("Enter");
    await expect(page).toHaveURL(/pages\/pricing-guide$/);
    await page.keyboard.press(`${mod}+k`);
    const recent = page.getByRole("group", { name: "Recent" });
    await expect(recent.getByRole("option", { name: /Pricing guide/ })).toBeVisible();
  });

  test("greater-than shows commands only, Alt+Enter opens the search, and actions run", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid");
    await settle(page);
    await page.keyboard.press(`${mod}+k`);
    const input = combo(page);
    const dlg = page.getByRole("dialog", { name: "Search and commands" });
    await input.fill(">review");
    await expect(dlg.getByRole("option")).toHaveCount(1);
    await expect(dlg.getByRole("option", { name: /Open the review desk/ })).toBeVisible();
    await input.press("Enter");
    await expect(page).toHaveURL(/\/waiting/);
    await page.keyboard.press(`${mod}+k`);
    await combo(page).fill("type:method pricing");
    await combo(page).press("Alt+Enter");
    await expect(page).toHaveURL(/\/search\?q=type%3Amethod(%20|\+)pricing/);
    // New page opens the new page dialog of the brain you are in.
    await page.goto("/brains/c_bid");
    await page.keyboard.press(`${mod}+k`);
    await combo(page).fill(">new page");
    await combo(page).press("Enter");
    await expect(page.getByRole("dialog", { name: "New page" })).toBeVisible();
  });

  test("a role never sees a brain or a page it cannot read", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await page.goto("/");
    await settle(page);
    await page.keyboard.press(`${mod}+k`);
    const input = combo(page);
    await input.fill("bid");
    const dlg = page.getByRole("dialog", { name: "Search and commands" });
    await expect(dlg.getByRole("option", { name: /Bid & Pre-sales/ })).toHaveCount(0);
    await input.fill("pricing");
    await expect(dlg.getByRole("option", { name: /Pricing guide/ })).toHaveCount(0);
    await expect(dlg.getByRole("option", { name: /Search every brain for/ })).toBeVisible();
  });

  test("axe on the open palette at 1280 and 400, in French, dark", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await page.goto("/");
    await settle(page);
    await page.keyboard.press(`${mod}+k`);
    await combo(page).fill("playbook");
    await expect(page.getByRole("option", { name: /Bid playbook/ }).first()).toBeVisible();
    await axe(page, "palette 1280");
    await page.setViewportSize({ width: 400, height: 800 });
    await axe(page, "palette 400");
    await shot(page, "palette-400");
    const fr = await as(browser, "head_bid", { lang: "fr", theme: "dark" });
    await fr.goto("/");
    await settle(fr);
    await fr.keyboard.press(`${mod}+k`);
    await expect(fr.getByRole("dialog", { name: "Recherche et commandes" })).toBeVisible();
    await axe(fr, "palette fr dark");
    await shot(fr, "palette-fr-dark");
  });
});

test.describe("faceted search", () => {
  test("facets with counts, an operator, the preview pane and the screenshot", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/search?q=pricing");
    await expect(page.getByTestId("search-page")).toBeVisible();
    await settle(page);
    const facets = page.getByRole("complementary", { name: "Filters" });
    await expect(facets.getByRole("group", { name: "Brain" })).toBeVisible();
    await expect(facets.getByRole("group", { name: "Collection" })).toBeVisible();
    await expect(facets.getByRole("group", { name: "Freshness" })).toBeVisible();
    await expect(facets.getByRole("group", { name: "Status" })).toBeVisible();
    const results = page.getByRole("region", { name: "Results" });
    await expect(results.getByRole("link", { name: /Pricing guide/ })).toBeVisible();
    await expect(page.getByTestId("search-preview")).toContainText("Pricing guide");
    await shot(page, "search-1440");
    // A facet narrows the results and keeps the other counts.
    const before = await results.getByRole("listitem").count();
    await facets.getByRole("group", { name: "Brain" }).getByRole("checkbox").first().check();
    await expect(page).toHaveURL(/brain=/);
    expect(await results.getByRole("listitem").count()).toBeLessThanOrEqual(before);
    // An operator in the box.
    await page.goto("/search?q=pricing%20type%3Aoffer");
    await settle(page);
    await expect(results.getByRole("link", { name: /Pricing guide/ })).toBeVisible();
    await expect(results.getByRole("link", { name: /Bid playbook/ })).toHaveCount(0);
  });

  test("bad operators are words, not errors", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/search?q=pricing%20fresh%3Asoon%20status%3Abogus");
    await settle(page);
    await expect(page.getByRole("status").filter({ hasText: /Not understood/ })).toBeVisible();
    await expect(page.getByText("Request failed")).toHaveCount(0);
  });

  test("saved searches: save, run again, remove", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/search?q=playbook");
    await settle(page);
    const saved = page.getByTestId("saved-searches");
    await saved.getByRole("textbox", { name: "Name this search" }).fill("Playbooks");
    await saved.getByRole("button", { name: "Save search" }).click();
    await expect(saved.getByRole("button", { name: /^Playbooks/ })).toBeVisible();
    await page.goto("/search?q=zzz");
    await settle(page);
    await page
      .getByTestId("saved-searches")
      .getByRole("button", { name: /^Playbooks/ })
      .click();
    await expect(page).toHaveURL(/q=playbook/);
    await page
      .getByTestId("saved-searches")
      .getByRole("button", { name: "Remove Playbooks" })
      .click();
    await expect(
      page.getByTestId("saved-searches").getByRole("button", { name: /^Playbooks/ }),
    ).toHaveCount(0);
  });

  test("a role gets nothing from a brain it cannot read", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await page.goto("/search?q=pricing");
    await settle(page);
    await expect(page.getByRole("link", { name: /Pricing guide/ })).toHaveCount(0);
    const facets = page.getByRole("complementary", { name: "Filters" });
    await expect(facets.getByText("Bid & Pre-sales")).toHaveCount(0);
    await page.goto("/search?q=brain%3Ac_bid");
    await settle(page);
    await expect(page.getByTestId("search-empty")).toBeVisible();
  });

  test("empty states, axe at 1280 and 400, French and dark", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await page.goto("/search?q=pricing");
    await settle(page);
    await axe(page, "search 1280");
    await page.goto("/search");
    await settle(page);
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await axe(page, "search empty 1280");
    await page.goto("/search?q=pricing");
    await settle(page);
    await page.setViewportSize({ width: 400, height: 900 });
    await axe(page, "search 400");
    await page.getByRole("button", { name: "Preview Pricing guide" }).click();
    await expect(page.getByTestId("search-preview")).toBeVisible();
    await shot(page, "search-400");
    const fr = await as(browser, "head_bid", { lang: "fr", theme: "dark" });
    await fr.goto("/search?q=pricing");
    await settle(fr);
    await axe(fr, "search fr dark");
    await shot(fr, "search-fr-dark");
  });
});

test.describe("pulse", () => {
  test("a brain's timeline expands a day, and has a table twin", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid/pulse");
    await expect(page.getByTestId("pulse-timeline")).toBeVisible();
    await settle(page);
    const tl = page.getByTestId("pulse-timeline");
    const days = tl.getByRole("button", { expanded: false });
    expect(await days.count()).toBeGreaterThan(3);
    const open = tl.getByRole("button", { expanded: true });
    await expect(open).toHaveCount(1);
    await days.first().click();
    await expect(tl.getByRole("button", { expanded: true })).toHaveCount(1);
    await expect(tl.getByText(/changes published/).first()).toBeVisible();
    await shot(page, "pulse-1440");
    await tl.getByRole("button", { name: "Show as table" }).click();
    await expect(tl.getByRole("table")).toBeVisible();
    await expect(tl.getByRole("columnheader", { name: "Contradictions resolved" })).toBeVisible();
  });

  test("Home shows one row per readable brain, only for that brain", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/");
    const card = page.getByTestId("pulse-across");
    await expect(card.getByRole("heading", { name: "Pulse across your brains" })).toBeVisible();
    await settle(page);
    await expect(card.getByRole("link", { name: "Bid & Pre-sales" })).toBeVisible();
    await expect(
      card.getByRole("img", { name: /Bid & Pre-sales: \d+ events in 30 days/ }),
    ).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(page, "pulse-home-1440");
    await card.getByRole("button", { name: "Show as table" }).click();
    await expect(card.getByRole("table")).toBeVisible();
    // A role without the bid brain gets no row for it.
    const c = await as(browser, "consultant");
    await c.goto("/");
    await settle(c);
    const cc = c.getByTestId("pulse-across");
    await expect(cc.getByRole("link", { name: "Bid & Pre-sales" })).toHaveCount(0);
    await c.goto("/brains/c_bid/pulse");
    await expect(c.getByTestId("pulse-timeline")).toHaveCount(0);
  });

  test("axe at 1280 and 400, French and dark", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 1280, h: 900 });
    await page.goto("/brains/c_bid/pulse");
    await expect(page.getByTestId("pulse-timeline")).toBeVisible();
    await settle(page);
    await axe(page, "pulse 1280");
    await page.goto("/");
    await expect(page.getByTestId("pulse-across")).toBeVisible();
    await settle(page);
    await axe(page, "home 1280");
    await page.setViewportSize({ width: 400, height: 900 });
    await axe(page, "home 400");
    await page.goto("/brains/c_bid/pulse");
    await settle(page);
    await axe(page, "pulse 400");
    await shot(page, "pulse-400");
    const fr = await as(browser, "head_bid", { lang: "fr", theme: "dark" });
    await fr.goto("/brains/c_bid/pulse");
    await settle(fr);
    await expect(fr.getByRole("heading", { name: /Pouls de/ })).toBeVisible();
    await axe(fr, "pulse fr dark");
    await shot(fr, "pulse-fr-dark");
  });
});

test.describe("My Agent: who knows", () => {
  test("a PeopleList answers who knows, with role and brain, and honours the opt-out", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/");
    await settle(page);
    await page.getByTestId("agent-button").click();
    const box = page.getByRole("textbox", { name: /Ask My Agent/ });
    await box.fill("Who knows about pricing in Bid & Pre-sales?");
    await box.press("Enter");
    const card = page.getByTestId("agent-peoplelist");
    await expect(card).toBeVisible();
    await expect(card.getByText("Grace Hopper")).toBeVisible();
    await expect(card.getByText(/Steward · Bid & Pre-sales/)).toBeVisible();
    await shot(page, "agent-people-1440");
    await axe(page, "agent people 1440");
    // The card around the list has the table twin.
    await page.getByRole("dialog").getByRole("button", { name: "Show as table" }).first().click();
    await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("columnheader", { name: "Role" }),
    ).toBeVisible();
    // The same role never gets people from a brain it cannot read.
    const c = await as(browser, "consultant");
    await c.goto("/");
    await settle(c);
    await c.getByTestId("agent-button").click();
    const cb = c.getByRole("textbox", { name: /Ask My Agent/ });
    await cb.fill("Who knows about pricing?");
    await cb.press("Enter");
    const cc = c.getByTestId("agent-peoplelist");
    await expect(cc).toBeVisible();
    await expect(cc.getByText("Bid & Pre-sales")).toHaveCount(0);
  });
});
