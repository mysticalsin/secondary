// Secondary v5 Brain Insights (docs/DESIGN-V5-BRAIN-INSIGHTS.md) against the web app in dev-mock
// mode: the four cards, the focus panel, the glance grid, table twins, keyboard, FR, dark, 400 px,
// axe at 1280 and 400, and a hover timing check at 1500 dots. Screenshots land in e2e/screens/v5-*.png.
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
  o: { w?: number; h?: number; theme?: string; lang?: string; dots?: number } = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1440, height: o.h ?? 1000 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([p, th, l, d]) => {
      localStorage.setItem("secondary.persona", p as string);
      localStorage.setItem("secondary.theme", th as string);
      localStorage.setItem("secondary.lang", l as string);
      if (d) localStorage.setItem("secondary.mock.dots", String(d));
    },
    [persona, o.theme ?? "light", o.lang ?? "en", o.dots ?? 0],
  );
  return page;
}

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};
const card = (page: Page, id: string) => page.getByTestId(`insight-${id}`);
const shot = (page: Page, name: string) =>
  card(page, name).screenshot({ path: `${SCREENS}v5-${name}-1440.png` });
const QUERY = "pricing method public sector";

async function open(page: Page, brain: string, q?: string) {
  await page.goto(`/brains/${brain}?tab=insights`);
  await expect(card(page, "constellation")).toBeVisible();
  await settle(page);
  if (q) {
    const box = page.getByRole("textbox", { name: "Ask what matters to you" });
    await box.fill(q);
    await box.press("Enter");
    await expect(page.getByText("pricing", { exact: true }).first()).toBeVisible();
    await settle(page);
    await box.blur();
  }
}

test.describe("insights tab", () => {
  test("the four cards, the legend, chips and the screenshots at 1440", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await open(page, "c_bid", QUERY);
    await expect(page.getByRole("tab", { name: "Insights", selected: true })).toBeVisible();
    // Constellation: legend with the dot scale, three chips with counts and a +N chip.
    const con = card(page, "constellation");
    const legend = con.locator(".dc-legend");
    await expect(legend.getByText(/1 dot = 2 pages/)).toBeVisible();
    await expect(legend.getByText("In the zone")).toBeVisible();
    await expect(legend.getByText("Below 85%")).toBeVisible();
    await expect(con.getByText(/^\+\d+$/).first()).toBeVisible();
    await expect(
      con.getByRole("group", { name: "Map of the pages in Bid & Pre-sales" }),
    ).toBeVisible();
    // Health: big number, +week chip, threshold, sources bar with shares.
    const health = card(page, "health");
    await expect(health.locator(".pill-up")).toContainText("this week");
    await expect(health.locator(".bs-thr")).toHaveText("Review below 60%");
    await expect(health.getByText("Pages by source")).toBeVisible();
    await expect(health.getByText("SharePoint")).toBeVisible();
    // Flow: publish rate, stages and the two KPI tiles.
    const flow = card(page, "flow");
    await expect(flow.getByText("publish rate")).toBeVisible();
    await expect(flow.getByText("Promoted to Global")).toBeVisible();
    await expect(page.getByTestId("kpi-review")).toContainText("1.8 d");
    await expect(page.getByTestId("kpi-seen")).toContainText("100%");
    for (const n of ["constellation", "health", "flow"]) await shot(page, n);
    await page.getByTestId("insights").screenshot({ path: `${SCREENS}v5-insights-1440.png` });
    await page.context().close();
  });

  test("an account brain: focus panel with coverage, timeline, activity and a status that goes to review", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo");
    await open(page, "a_acme", QUERY);
    const focus = card(page, "focus");
    await expect(focus.getByText("Coverage", { exact: true }).first()).toBeVisible();
    await expect(focus.getByText("Engagements and projects")).toBeVisible();
    await expect(focus.getByText("Activity", { exact: true })).toBeVisible();
    await expect(focus.getByText("Missing")).toBeVisible();
    await expect(
      focus
        .getByRole("button", { name: "Open brain" })
        .or(focus.getByRole("link", { name: "Open brain" })),
    ).toBeVisible();
    await expect(focus.getByRole("link", { name: "Ask this brain" })).toBeVisible();
    const status = focus.getByRole("combobox");
    await expect(status).toHaveValue("watch");
    await status.selectOption("active");
    await expect(page.getByText("Status change sent for review.")).toBeVisible();
    await shot(page, "focus");
    await page.context().close();
  });

  test("clicking a named page focuses it; Back returns; the keyboard does the same", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo");
    await open(page, "c_bid", QUERY);
    const con = card(page, "constellation");
    const nodes = con.getByRole("button", { name: /\d+%$/ });
    await expect(nodes).toHaveCount(5);
    await nodes.first().click();
    const focus = card(page, "focus");
    await expect(focus.getByText("Sections this page needs").first()).toBeVisible();
    await expect(focus.getByRole("button", { name: "Back to the brain" })).toBeVisible();
    await expect(focus.getByRole("link", { name: "Open page" })).toBeVisible();
    await focus.getByRole("button", { name: "Back to the brain" }).click();
    await expect(focus.getByText("Open brain")).toBeVisible();
    // Keyboard: Tab lands on the first named node, arrows move, Enter selects.
    await nodes.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(nodes.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(focus.getByText("Sections this page needs").first()).toBeVisible();
    await page.context().close();
  });

  test("modes, score kinds, chip removal and table twins", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await open(page, "c_bid", QUERY);
    const con = card(page, "constellation");
    await con.getByRole("radio", { name: "Freshness" }).click();
    await expect(con.getByText("Freshest pages sit at the centre")).toBeVisible();
    await con.getByRole("radio", { name: "Relevance" }).click();
    const health = card(page, "health");
    await health.getByRole("radio", { name: "Evidence" }).click();
    await expect(health.getByRole("radio", { name: "Evidence" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await con.getByRole("button", { name: "Remove method" }).click();
    await expect(con.getByRole("textbox", { name: "Ask what matters to you" })).toHaveValue(
      "pricing public sector",
    );
    for (const id of ["constellation", "health", "flow", "focus"]) {
      const c = card(page, id);
      await c.getByRole("button", { name: "Show as table" }).click();
      await expect(c.getByRole("table").first()).toBeVisible();
      await c.getByRole("button", { name: "Show as chart" }).click();
    }
    await page.context().close();
  });
});

test.describe("at a glance", () => {
  test("Home and All brains show one small map per brain the person can open", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo");
    await page.goto("/");
    await settle(page);
    const g = page.getByTestId("glance");
    await expect(g.getByRole("heading", { name: "Your brains at a glance" })).toBeVisible();
    const tiles = g.locator("a.gl-link");
    expect(await tiles.count()).toBeGreaterThanOrEqual(4);
    await g.scrollIntoViewIfNeeded();
    await g.screenshot({ path: `${SCREENS}v5-glance-1440.png` });
    await tiles.first().click();
    await expect(page).toHaveURL(/tab=insights/);
    await page.goto("/brains");
    await settle(page);
    await expect(page.getByTestId("glance")).toBeVisible();
    await page.context().close();
  });
});

test.describe("accessibility and layout", () => {
  for (const [w, label] of [
    [1280, "1280"],
    [400, "400"],
  ] as const) {
    test(`axe: zero violations at ${label}, chart and table twin, Home glance`, async ({
      browser,
    }) => {
      const page = await as(browser, "ceo", { w, h: 900 });
      await open(page, "a_acme", QUERY);
      await axe(page, `insights ${label}`);
      if (w === 400)
        await page.screenshot({ path: `${SCREENS}v5-insights-400.png`, fullPage: true });
      for (const id of ["constellation", "health", "flow", "focus"])
        await card(page, id).getByRole("button", { name: "Show as table" }).click();
      await axe(page, `insights tables ${label}`);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(wide, "no horizontal page scroll").toBeLessThanOrEqual(1);
      if (w === 400) {
        const a = await card(page, "constellation").boundingBox();
        const b = await card(page, "focus").boundingBox();
        expect(b?.y ?? 0, "cards stack at 400").toBeGreaterThan((a?.y ?? 0) + (a?.height ?? 0) - 2);
      }
      await page.goto("/");
      await settle(page);
      await expect(page.getByTestId("glance")).toBeVisible();
      await axe(page, `home glance ${label}`);
      await page.context().close();
    });
  }

  test("French and dark: no violations, the labels are French, the cards stay dark", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo", { lang: "fr", theme: "dark", w: 1280, h: 900 });
    await open(page, "c_bid");
    await expect(page.getByRole("tab", { name: "Aperçu", selected: true })).toBeVisible();
    await expect(card(page, "health").getByText("Santé du cerveau")).toBeVisible();
    await expect(card(page, "flow").getByText("Flux de connaissance")).toBeVisible();
    await expect(
      card(page, "constellation")
        .locator(".dc-legend")
        .getByText(/1 point = 2 pages/),
    ).toBeVisible();
    const bg = await card(page, "health").evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe("rgb(30, 30, 34)");
    await axe(page, "insights fr dark");
    await page.screenshot({ path: `${SCREENS}v5-insights-fr-dark.png`, fullPage: true });
    await page.context().close();
  });
});

test.describe("performance", () => {
  test("hover at 1500 dots takes under 16 ms of main-thread work at the 95th percentile", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo", { dots: 1500, w: 1440, h: 1000 });
    await open(page, "c_bid", QUERY);
    const dots = await page.evaluate(
      () =>
        document.querySelectorAll('.dc-svg circle[fill="#8b5cf6"], .dc-svg circle[fill="#7f7f8b"]')
          .length,
    );
    expect(dots).toBeGreaterThanOrEqual(1400);
    // Main-thread work per hover: the pointer event, React's commit and a forced style and layout.
    const stats = await page.evaluate(async () => {
      const svg = document.querySelector(".dc-svg") as SVGSVGElement;
      const box = svg.getBoundingClientRect();
      const ch = new MessageChannel();
      const macro = () =>
        new Promise<void>((r) => {
          ch.port1.onmessage = () => r();
          ch.port2.postMessage(0);
        });
      await macro();
      const times: number[] = [];
      let shown = 0;
      for (let n = 0; n < 240; n++) {
        const a = (n / 240) * Math.PI * 6;
        const rr = 0.15 + 0.3 * ((n % 40) / 40);
        const x = box.left + box.width / 2 + Math.cos(a) * box.width * rr;
        const y = box.top + box.height / 2 + Math.sin(a) * box.height * rr;
        const t0 = performance.now();
        svg.dispatchEvent(
          new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }),
        );
        await macro();
        await macro();
        svg.getBoundingClientRect();
        getComputedStyle(svg).height;
        times.push(performance.now() - t0);
        if (document.querySelector(".dc-hover")) shown++;
      }
      times.sort((p, q) => p - q);
      return {
        p50: times[120] as number,
        p95: times[228] as number,
        max: times[239] as number,
        shown,
      };
    });
    console.log(
      `hover at ${dots} dots: p50 ${stats.p50.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms, max ${stats.max.toFixed(1)} ms`,
    );
    expect(stats.shown, "the hover marker really appeared").toBeGreaterThan(100);
    expect(stats.p95).toBeLessThan(16);
    await page.context().close();
  });
});
