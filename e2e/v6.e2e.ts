// Secondary v6 My Agent (docs/DESIGN-V6-MY-AGENT-GENUI.md section 5) against the web app in dev-mock
// mode: ask and stream, structured actions, pin and reload, share to a lower persona, the My Home
// grid with keyboard move and resize, settings, axe at 1280 and 400, FR and EN, keyboard only and
// reduced motion. Screenshots land in e2e/screens/v6-*.png.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const STORE = "secondary.mock.agent.views";

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`).join(" | ")}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

const PROGRAMS = {
  bid: [
    "root = Stack([c1, c2])",
    'c1 = InsightCard("Bid & Pre-sales: Knowledge flow", [f1])',
    'f1 = Funnel("c_bid", "30d")',
    'c2 = InsightCard("Bid & Pre-sales: Brain health", [s1])',
    's1 = Beeswarm("c_bid", "freshness")',
  ].join("\n"),
  acme: [
    "root = Stack([c1])",
    'c1 = InsightCard("Acme Synthetic SA: In focus", [fit, act])',
    'fit = FitBars("a_acme")',
    'act = ActivityGrid("a_acme")',
  ].join("\n"),
  kpis: [
    "root = Stack([g])",
    "g = Grid([k0, k1, k2, k3], 4)",
    'k0 = KpiTile("Bid pages", "c_bid", "pages")',
    'k1 = KpiTile("Bid health", "c_bid", "health")',
    'k2 = KpiTile("Acme pages", "a_acme", "pages")',
    'k3 = KpiTile("Acme health", "a_acme", "health")',
  ].join("\n"),
  sales: [
    "root = Stack([c1])",
    'c1 = InsightCard("Sales: Knowledge flow", [f1])',
    'f1 = Funnel("c_sales", "30d")',
  ].join("\n"),
};

const seed = (owner: string) => [
  {
    id: "v_seed1",
    owner,
    name: "Monday bid review",
    pin: "home",
    layout: { x: 0, y: 0, w: 7, h: 10 },
    program: PROGRAMS.bid,
    updatedAt: "2026-11-05T10:00:00.000Z",
  },
  {
    id: "v_seed2",
    owner,
    name: "Acme watch",
    pin: "home",
    layout: { x: 7, y: 0, w: 5, h: 10 },
    program: PROGRAMS.acme,
    updatedAt: "2026-11-05T10:01:00.000Z",
  },
  {
    id: "v_seed3",
    owner,
    name: "Key numbers",
    pin: "home",
    layout: { x: 0, y: 10, w: 12, h: 3 },
    program: PROGRAMS.kpis,
    updatedAt: "2026-11-05T10:02:00.000Z",
  },
];

interface Opts {
  persona?: string;
  w?: number;
  h?: number;
  theme?: string;
  lang?: string;
  seeded?: boolean;
  reduced?: "reduce" | "no-preference";
  agent?: Record<string, unknown>;
}

/** A page with the persona, theme and language set once (later changes in the test are kept). */
async function as(browser: Browser, o: Opts = {}): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1440, height: o.h ?? 1000 },
    reducedMotion: o.reduced ?? "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([persona, theme, lang, seeded, rows, agent]) => {
      if (sessionStorage.getItem("v6.init")) return;
      sessionStorage.setItem("v6.init", "1");
      localStorage.setItem("secondary.persona", persona as string);
      localStorage.setItem("secondary.theme", theme as string);
      localStorage.setItem("secondary.lang", lang as string);
      if (seeded) localStorage.setItem("secondary.mock.agent.views", JSON.stringify(rows));
      if (agent) localStorage.setItem("secondary.agent.settings", JSON.stringify(agent));
    },
    [
      o.persona ?? "ceo",
      o.theme ?? "light",
      o.lang ?? "en",
      !!o.seeded,
      seed(o.persona ?? "ceo"),
      o.agent ?? null,
    ],
  );
  return page;
}

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("status").filter({ hasText: /^(Loading|Reading the brain)$/ }),
  ).toHaveCount(0);
};
const panel = (page: Page) =>
  page.getByRole("dialog", { name: /My Agent panel|Panneau Mon agent/ });
const box = (page: Page) => page.getByRole("textbox", { name: /Ask My Agent|Poser une question/ });
const noScroll = async (page: Page, label: string) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide, `no horizontal page scroll on ${label}`).toBeLessThanOrEqual(1);
};

async function openPanel(page: Page) {
  await page.getByTestId("agent-button").click();
  await expect(panel(page)).toBeVisible();
}
async function ask(page: Page, text: string) {
  const b = box(page);
  await b.fill(text);
  await b.press("Enter");
}
const BID = "Show me where Bid & Pre-sales stands this month";

test.describe("ask, stream, act", () => {
  test("the Bid question streams a funnel, a beeswarm and top pages; a focus button opens the Acme panel", async ({
    browser,
  }) => {
    const page = await as(browser);
    await page.goto("/");
    await settle(page);
    await openPanel(page);
    // Suggested prompts come from the person's own brains.
    await expect(
      panel(page).getByRole("button", { name: /^Show me where .* stands this month$/ }),
    ).toBeVisible();
    await ask(page, BID);
    // The shell of the answer arrives before the data does.
    await expect(page.getByTestId("agent-streaming")).toBeVisible();
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await expect(page.getByTestId("agent-beeswarm")).toBeVisible();
    await expect(page.getByTestId("agent-pagelist")).toBeVisible();
    await expect(page.getByTestId("agent-streaming")).toHaveCount(0);
    await expect(page.getByTestId("agent-det-note")).toContainText("AI is switched off");
    await expect(panel(page).getByTestId("agent-live")).toHaveText("Your view is ready");
    await page.screenshot({ path: `${SCREENS}v6-panel-1440.png` });
    // A structured action: the Acme focus panel.
    await ask(page, "How is Acme doing this week?");
    await page.getByRole("button", { name: "Focus: Acme Synthetic SA" }).click();
    await expect(page.getByRole("heading", { name: "Acme Synthetic SA: In focus" })).toBeVisible();
    await expect(page.getByTestId("agent-fit")).toBeVisible();
    await expect(page.getByTestId("agent-activity")).toBeVisible();
    await page.context().close();
  });

  test("the answer as tables, refine, the full page and history after a reload", async ({
    browser,
  }) => {
    const page = await as(browser, { w: 1280, h: 900 });
    await page.goto("/agent");
    await settle(page);
    await ask(page, BID);
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin" })).toBeVisible();
    await page.locator(".ag-actions").getByRole("button", { name: "Show as table" }).click();
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.locator(".ag-actions").getByRole("button", { name: "Show as charts" }).click();
    await page.getByRole("button", { name: "Refine" }).click();
    await page.getByRole("button", { name: "Add the funnel" }).click();
    await expect(page.getByRole("heading", { name: "Knowledge flow" }).nth(1)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 2000 });
    await page.screenshot({ path: `${SCREENS}v6-page-1280.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByTestId("agent-streaming")).toHaveCount(0);
    // History is kept on the device: programs, not data.
    await page.reload();
    await settle(page);
    await expect(page.getByTestId("agent-exchange")).toHaveCount(2);
    await expect(page.getByTestId("agent-funnel").first()).toBeVisible();
    const kept = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([k]) => k.startsWith("secondary.agent.history"))
        .map(([, v]) => v)
        .join(""),
    );
    expect(kept).toContain("Funnel(");
    expect(kept).not.toMatch(/publishRate|"dots"/);
    await page.context().close();
  });
});

test.describe("pin, reload, share", () => {
  test("pin to My Home, reload, still there; then move and resize with the keyboard, rename, remove", async ({
    browser,
  }) => {
    const page = await as(browser, { w: 1440, h: 1000 });
    await page.goto("/");
    await settle(page);
    await expect(page.getByTestId("agent-home").getByText("Nothing pinned yet")).toBeVisible();
    await openPanel(page);
    await ask(page, BID);
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await panel(page).getByRole("button", { name: "Pin", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Pin this view" });
    await dlg.getByRole("textbox", { name: "Name" }).fill("Monday bid review");
    await dlg.getByRole("button", { name: "Pin view" }).click();
    await expect(page.getByText("Pinned to My Home.")).toBeVisible();
    await page.reload();
    await settle(page);
    const cell = page.getByTestId("agent-cell");
    await expect(cell.getByRole("heading", { name: "Monday bid review" })).toBeVisible();
    await expect(cell.getByTestId("agent-funnel")).toBeVisible();
    // Keyboard: arrows move, shift and arrows resize, and the layout is saved.
    const col = () =>
      cell.evaluate(
        (e) => `${getComputedStyle(e).gridColumnStart}/${getComputedStyle(e).gridColumnEnd}`,
      );
    const before = await col();
    await cell.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.getByRole("status").filter({ hasText: /is at column 2/ })).toContainText(
      "7 wide",
    );
    expect(await col()).not.toBe(before);
    await page.waitForTimeout(600);
    await page.reload();
    await settle(page);
    const saved = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? "[]")[0].layout,
      STORE,
    );
    expect(saved).toMatchObject({ x: 1, w: 7 });
    // Rename inline, then remove with a confirm.
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "View name" }).fill("Bid Monday");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("heading", { name: "Bid Monday" })).toBeVisible();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText('Remove "Bid Monday"');
    await page.getByRole("button", { name: "Remove view" }).click();
    await expect(page.getByTestId("agent-home").getByText("Nothing pinned yet")).toBeVisible();
    await page.context().close();
  });

  test("a shared view shows a lower persona locked cards, never more", async ({ browser }) => {
    const page = await as(browser, { persona: "ceo" });
    await page.goto("/");
    await settle(page);
    // A view of the Sales brain, which only the CEO may read.
    await page.evaluate(
      ([k, program]) =>
        localStorage.setItem(
          k as string,
          JSON.stringify([
            {
              id: "v_sales",
              owner: "ceo",
              name: "Sales watch",
              pin: "home",
              layout: { x: 0, y: 0, w: 6, h: 6 },
              program,
              updatedAt: "2026-11-05T10:00:00.000Z",
            },
          ]),
        ),
      [STORE, PROGRAMS.sales],
    );
    await page.reload();
    await settle(page);
    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Link copied.")).toBeVisible();
    await expect(page.getByText("Shared by link")).toBeVisible();
    const path = await page.evaluate(
      (k) => `/agent/shared/${JSON.parse(localStorage.getItem(k) ?? "[]")[0].shareId}`,
      STORE,
    );
    // The CEO sees the card; Head of Bid, who may not read Sales, sees a locked placeholder.
    await page.goto(path);
    await settle(page);
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await page.evaluate(() => localStorage.setItem("secondary.persona", "head_bid"));
    await page.goto(path);
    await settle(page);
    await expect(page.getByTestId("agent-locked")).toBeVisible();
    await expect(page.getByTestId("agent-funnel")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Sales: Knowledge flow");
    await expect(page.locator("main")).not.toContainText("c_sales");
    await page.screenshot({ path: `${SCREENS}v6-shared-locked-1440.png` });
    // Stop sharing: the link no longer opens.
    await page.evaluate(() => localStorage.setItem("secondary.persona", "ceo"));
    await page.goto("/");
    await settle(page);
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(page.getByText("Sharing stopped.")).toBeVisible();
    await page.goto(path);
    await expect(page.getByText("This shared view is not available anymore.")).toBeVisible();
    await page.context().close();
  });

  test("a view pinned to a brain lists on that brain's My view tab", async ({ browser }) => {
    const page = await as(browser);
    await page.goto("/brains/c_bid?tab=myview");
    await settle(page);
    await expect(page.getByTestId("agent-myview").getByText("No view pinned here")).toBeVisible();
    await openPanel(page);
    await ask(page, BID);
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await panel(page).getByRole("button", { name: "Pin", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Pin this view" });
    await dlg.getByRole("radio", { name: "Brain > My view" }).check();
    await dlg.getByRole("combobox", { name: "Brain" }).selectOption("c_bid");
    await dlg.getByRole("button", { name: "Pin view" }).click();
    await expect(page.getByText(/Pinned to .* > My view\./)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await settle(page);
    await expect(page.getByRole("tab", { name: "My view", selected: true })).toBeVisible();
    await expect(page.getByTestId("agent-myview").getByTestId("agent-funnel")).toBeVisible();
    await page.context().close();
  });
});

test.describe("settings", () => {
  test("density, card theme, answer language, tokens and clear history", async ({ browser }) => {
    const page = await as(browser, { w: 1440, h: 1000 });
    await page.goto("/settings/agent-settings");
    await settle(page);
    await expect(page.getByRole("heading", { name: "My Agent", level: 2 })).toBeVisible();
    await page.getByRole("radio", { name: "Compact" }).check();
    await page.getByRole("radio", { name: "Light" }).check();
    await page.getByRole("radio", { name: "Français" }).check();
    await page.getByRole("checkbox", { name: /Show token use/ }).check();
    await page.screenshot({ path: `${SCREENS}v6-settings-1440.png` });
    await axe(page, "settings");
    const s = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("secondary.agent.settings") ?? "{}"),
    );
    expect(s).toEqual({ density: "compact", theme: "light", lang: "fr", tokens: true });
    await page.goto("/");
    await settle(page);
    await openPanel(page);
    await ask(page, BID);
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await expect(page.getByTestId("agent-tokens")).toHaveText("No AI used");
    await expect(page.locator(".ag-render.ag-d-compact.ag-t-light").first()).toBeVisible();
    // The answer language is sent to the turn: the deterministic answer is French.
    await expect(page.getByRole("heading", { name: /Flux de connaissances/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/settings/agent-settings");
    await settle(page);
    await page.getByRole("button", { name: "Clear history" }).click();
    await page.getByRole("button", { name: "Clear history" }).last().click();
    await expect(page.getByText("My Agent history cleared.")).toBeVisible();
    await page.context().close();
  });
});

test.describe("accessibility and layout", () => {
  for (const [w, label] of [
    [1280, "1280"],
    [400, "400"],
  ] as const) {
    for (const cards of ["dark", "light"] as const) {
      test(`axe: zero violations at ${label}, ${cards} cards: panel, full page, My Home`, async ({
        browser,
      }) => {
        const page = await as(browser, {
          w,
          h: 900,
          seeded: true,
          agent: { density: "comfortable", theme: cards, lang: "follow", tokens: true },
        });
        await page.goto("/agent");
        await settle(page);
        await ask(page, BID);
        await expect(page.getByTestId("agent-funnel")).toBeVisible();
        await expect(page.getByTestId("agent-beeswarm")).toBeVisible();
        await axe(page, `agent page ${label} ${cards}`);
        await noScroll(page, `agent page ${label}`);
        await page.locator(".ag-actions").getByRole("button", { name: "Show as table" }).click();
        await expect(page.getByRole("table").first()).toBeVisible();
        await axe(page, `agent page tables ${label} ${cards}`);
        await page.goto("/");
        await settle(page);
        await openPanel(page);
        await expect(panel(page).getByTestId("agent-funnel")).toBeVisible();
        await axe(page, `panel ${label} ${cards}`);
        await noScroll(page, `panel ${label}`);
        if (cards === "dark" && w === 400)
          await page.screenshot({ path: `${SCREENS}v6-mobile-400.png` });
        await page.keyboard.press("Escape");
        await expect(panel(page)).toBeHidden();
        await expect(page.getByTestId("agent-cell")).toHaveCount(3);
        await expect(page.getByTestId("agent-home").getByTestId("agent-funnel")).toBeVisible();
        await settle(page);
        await axe(page, `my home ${label} ${cards}`);
        await noScroll(page, `my home ${label}`);
        if (w === 1280 && cards === "dark") {
          await page.getByTestId("agent-home").screenshot({ path: `${SCREENS}v6-home-1440.png` });
        }
        if (w === 400 && cards === "light") {
          await page.getByTestId("agent-home").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${SCREENS}v6-mobile-home-400.png` });
        }
        await page.context().close();
      });
    }
  }

  test("My Home with pinned views at 1440 in dark page theme", async ({ browser }) => {
    const page = await as(browser, { w: 1440, h: 1000, seeded: true, theme: "dark" });
    await page.goto("/");
    await settle(page);
    await expect(page.getByTestId("agent-cell")).toHaveCount(3);
    await expect(page.getByTestId("agent-home").getByTestId("agent-funnel")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 2200 });
    await page.screenshot({ path: `${SCREENS}v6-home-1440.png` });
    await axe(page, "my home dark");
    await page.context().close();
  });

  test("French: the button, the thread and the answer", async ({ browser }) => {
    const page = await as(browser, { lang: "fr", w: 1280, h: 900 });
    await page.goto("/");
    await settle(page);
    await expect(page.getByTestId("agent-button")).toContainText("Mon agent");
    await openPanel(page);
    await expect(panel(page).getByRole("heading", { name: "Mon agent" })).toBeVisible();
    await ask(page, "Montre-moi où en est Bid & Pre-sales ce mois-ci");
    await expect(page.getByTestId("agent-funnel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Épingler" })).toBeVisible();
    await expect(page.getByTestId("agent-det-note")).toContainText("L'IA est désactivée");
    await axe(page, "panel fr");
    await page.screenshot({ path: `${SCREENS}v6-fr-1280.png` });
    await page.context().close();
  });

  test("keyboard only: Ctrl+J, type, send, pin from the keyboard, Escape gives focus back", async ({
    browser,
  }) => {
    const page = await as(browser, { w: 1280, h: 900 });
    await page.goto("/");
    await settle(page);
    const btn = page.getByTestId("agent-button");
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("What needs my attention?");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
    // Tab stays inside the panel.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      expect(await panel(page).evaluate((p) => p.contains(document.activeElement))).toBe(true);
    }
    await page.getByRole("button", { name: "Pin", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog", { name: "Pin this view" });
    await expect(dlg.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press("Control+j");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(panel(page)).toBeHidden();
    await page.context().close();
  });

  test("reduced motion: no animation on the panel, the dot or the skeleton", async ({
    browser,
  }) => {
    const page = await as(browser, { reduced: "reduce" });
    await page.goto("/");
    await openPanel(page);
    const name = await panel(page).evaluate((e) => getComputedStyle(e).animationName);
    expect(name).toBe("none");
    await ask(page, BID);
    const dot = page.locator(".ag-dot");
    if (await dot.count())
      expect(await dot.first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    await page.context().close();
    const live = await as(browser, { reduced: "no-preference" });
    await live.goto("/");
    await openPanel(live);
    expect(await panel(live).evaluate((e) => getComputedStyle(e).animationName)).toBe("ag-in");
    await live.context().close();
  });
});
