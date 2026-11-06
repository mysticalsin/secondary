// Secondary v7 Operate (docs/DESIGN-V7-OPS-WEB.md) against the web app in dev-mock mode: Brain activity,
// the agent activity section, Sources (list and page), and Platform health. Axe at 1280 and 400, light,
// dark and FR, keyboard flows, "/" search, retry once then already queued, rotation pending, table
// twins. Screenshots land in e2e/screens/v7-ops-*.png.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BID = "/brains/c_bid?tab=activity";
const SRC = "/settings/sources/src_bidlib01";
const RETRY_ID = "evt_7a31c0d29b4e8f56";

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

const activity = (page: Page) => page.getByTestId("ops-activity");
const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
};
async function openActivity(page: Page) {
  await page.goto(BID);
  await expect(activity(page)).toBeVisible();
  await expect(activity(page).locator("tbody tr").first()).toBeVisible();
  await settle(page);
}
async function openSource(page: Page) {
  await page.goto(SRC);
  await expect(page.getByTestId("source-form")).toBeVisible();
  await expect(page.getByTestId("latency-swarm")).toBeVisible();
  await settle(page);
}
async function openHealth(page: Page) {
  await page.goto("/settings/health");
  await expect(page.getByTestId("health-heatmap")).toBeVisible();
  await settle(page);
}

test.describe("brain activity", () => {
  test("timeline, callout, table, detail panel and the screenshots", async ({ browser }) => {
    const page = await as(browser, "head_bid", { h: 1500 });
    await openActivity(page);
    const card = activity(page);
    await expect(page.getByRole("tab", { name: "Activity", selected: true })).toBeVisible();
    await expect(card.getByText(/^Last 60 min$/)).toBeVisible();
    await expect(card.getByText(/^1 dot = \d+ events$/)).toBeVisible();
    // The failure callout reads like the reference: blocked since 10:51 and the rule.
    await expect(card.getByRole("note")).toContainText("blocked since 10:51");
    await expect(card.getByRole("note")).toContainText("client-name rule");
    // The first rows are the two from the reference story.
    const first = card.locator("tbody tr").first();
    await expect(first).toContainText("connector.sync");
    await expect(first).toContainText("Retrying");
    await expect(first).toContainText("11:04:09");
    for (const col of ["Event", "Source", "Status", "Attempts", "Latency", "Time"])
      await expect(card.getByRole("columnheader", { name: col })).toBeVisible();
    await expect(card.getByTestId("shown-count")).toContainText(/^200 of \d+/);
    for (const s of ["Published", "Needs review", "Blocked or failed", "Retrying"])
      await expect(card.getByRole("list", { name: "Legend" }).getByText(s)).toBeVisible();
    // Open the recovered row: steps with a check, metadata with ids only.
    await card.locator(`tr[data-event="evt_7a31c0d29b4e8f02"]`).click();
    const detail = page.locator("#opx-detail");
    await expect(detail.getByText("Steps")).toBeVisible();
    await expect(detail.getByText("Metadata")).toBeVisible();
    await expect(
      detail.getByText("Ids and codes only. Page content is never shown."),
    ).toBeVisible();
    await expect(detail.getByRole("button", { name: "Retry ingest" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Copy event id" })).toBeVisible();
    await card.screenshot({ path: `${SCREENS}v7-ops-activity-1440.png` });
    await page.context().close();
  });

  test("brush by keyboard and by mouse narrows the table, Escape clears", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await openActivity(page);
    const card = activity(page);
    const count = card.getByTestId("shown-count");
    const before = (await count.innerText()).match(/of (\d+)/)?.[1];
    const brush = card.getByRole("group", { name: "Time window brush" });
    await brush.focus();
    await page.keyboard.press("ArrowLeft"); // creates a window at the end
    await expect(card.getByTestId("selected-range")).toContainText("Selected 11:00-11:05");
    await expect(count).not.toContainText(`of ${before} `);
    await page.keyboard.press("ArrowLeft");
    await expect(card.getByTestId("selected-range")).toContainText("Selected 10:59-11:04");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(card.getByTestId("selected-range")).toContainText("10:59-11:05");
    await page.keyboard.press("Escape");
    await expect(card.getByTestId("selected-range")).toHaveText("");
    await expect(count).toContainText(`of ${before} `);
    // Pointer drag over the timeline.
    const box = (await brush.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(card.getByTestId("selected-range")).toContainText("Selected 10:");
    await expect(count).not.toContainText(`of ${before} `);
    await page.context().close();
  });

  test("filters, search with slash, and the retry flow", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await openActivity(page);
    const card = activity(page);
    await card.getByRole("radio", { name: "Blocked" }).click();
    await expect(card.locator("tbody tr").first()).toContainText("Blocked");
    expect(await card.locator("tbody tr", { hasNotText: "Blocked" }).count()).toBe(0);
    await card.getByRole("radio", { name: "All" }).click();
    // "/" opens search (and only when no field has focus).
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    const search = card.getByRole("searchbox", { name: "Search events" });
    await expect(search).toBeFocused();
    await search.fill("connector.sync");
    await expect(card.locator("tbody tr").first()).toContainText("connector.sync");
    await expect(card.getByTestId("shown-count")).not.toContainText("of 9");
    await search.fill(RETRY_ID);
    await expect(card.locator("tbody tr")).toHaveCount(1);
    // Retry: queued once, then the same event says already queued (the API is idempotent).
    await card.locator(`tr[data-event="${RETRY_ID}"]`).click();
    const detail = page.locator("#opx-detail");
    const retry = detail.getByRole("button", { name: "Retry ingest" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(detail.getByRole("button", { name: "Retry queued" })).toBeDisabled();
    await card.locator(`tr[data-event="${RETRY_ID}"]`).click(); // close
    await card.locator(`tr[data-event="${RETRY_ID}"]`).click(); // open again
    await expect(detail.getByRole("button", { name: "Already queued" })).toBeDisabled();
    // Nothing on the page is content: only ids and codes.
    await expect(detail.locator(".opx-json")).toContainText("receiptId");
    await page.context().close();
  });

  test("table twin of the timeline, and the tab is hidden without manage rights", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await openActivity(page);
    const card = activity(page);
    await card.getByRole("button", { name: "Show as table" }).click();
    await expect(
      card.getByRole("table", { name: "Events per time bucket, as a table" }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Show as chart" }).click();
    await card.getByRole("radio", { name: "24 h" }).click();
    await expect(card.getByText(/^Last 24 h$/)).toBeVisible();
    await card.getByRole("radio", { name: "7 d" }).click();
    await expect(card.getByText(/^Last 7 d$/)).toBeVisible();
    await page.context().close();
    // The CEO reads Bid & Pre-sales but does not manage it: no tab, and the URL falls back to Contents.
    const other = await as(browser, "ceo");
    await other.goto(BID);
    await expect(other.getByRole("tab", { name: "Contents", selected: true })).toBeVisible();
    await expect(other.getByRole("tab", { name: "Activity" })).toHaveCount(0);
    await other.context().close();
  });

  test("axe: 1280 light, dark, FR, and 400 px", async ({ browser }) => {
    for (const o of [
      { w: 1280, theme: "light", lang: "en" },
      { w: 1280, theme: "dark", lang: "en" },
      { w: 1280, theme: "light", lang: "fr" },
      { w: 400, h: 900, theme: "light", lang: "en" },
    ]) {
      const page = await as(browser, "head_bid", o);
      await openActivity(page);
      await activity(page).locator("tr[data-event]").first().click();
      await expect(
        page.locator("#opx-detail").getByRole("button", { name: /Copy|Copier/ }),
      ).toBeVisible();
      await axe(page, `activity ${JSON.stringify(o)}`);
      if (o.w === 400) {
        await activity(page).screenshot({ path: `${SCREENS}v7-ops-activity-400.png` });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "no horizontal page scroll at 400 px").toBeLessThanOrEqual(1);
      }
      await page.context().close();
    }
  });
});

test.describe("agent activity in Settings", () => {
  test("the person's own calls, no retry, no brain", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await page.goto("/settings/agents");
    const card = page.getByTestId("agent-activity");
    await expect(card).toBeVisible();
    await expect(card.locator("tbody tr").first()).toBeVisible();
    await expect(card.getByRole("heading", { name: /Agents\s+Activity/ })).toBeVisible();
    await card.locator("tr[data-event]").first().click();
    await expect(
      page.locator("#opx-detail").getByRole("button", { name: "Copy event id" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry ingest" })).toHaveCount(0);
    await settle(page);
    await axe(page, "agents activity");
    await page.context().close();
  });
});

test.describe("sources", () => {
  test("list, then a source page with the retry chart, swarm, form and screenshots", async ({
    browser,
  }) => {
    const page = await as(browser, "platform_admin", { h: 2200 });
    await page.goto("/settings/sources");
    const list = page.getByTestId("sources-list");
    await expect(list.locator("tbody tr")).toHaveCount(12);
    await expect(page.getByRole("link", { name: "Sources" }).first()).toBeVisible();
    await list.getByRole("link", { name: "Bid library" }).click();
    await expect(page).toHaveURL(/\/settings\/sources\/src_bidlib01$/);
    await expect(page.getByTestId("latency-swarm")).toBeVisible();
    await settle(page);
    const swarm = page.getByTestId("latency-swarm");
    await expect(swarm.getByText("p50 292 ms", { exact: true })).toBeVisible();
    await expect(swarm.getByText("p95 13.9 s", { exact: true })).toBeVisible();
    await expect(swarm.getByText("last 320 · timeout 15 s")).toBeVisible();
    await expect(swarm.getByText("Raise timeout?")).toBeVisible();
    const chart = page.getByTestId("retry-chart");
    await expect(chart.getByText("8 tries · 37 h")).toBeVisible();
    await expect(chart.getByText("next try in 22 s · last 429")).toBeVisible();
    await expect(page.getByTestId("chip-count")).toHaveText("4 of 31");
    await expect(page.getByTestId("secret-name")).toContainText("SOURCE_BIDLIB01_SECRET");
    await page.locator(".opx-srcpage").screenshot({ path: `${SCREENS}v7-ops-source-1440.png` });
    await page.context().close();
  });

  test("edit: policy preview, chips, raise timeout, save and discard", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await openSource(page);
    const save = page.getByRole("button", { name: "Save source" });
    await expect(save).toBeDisabled();
    // Linear every 10 m: the chart redraws at once and the twin lists 8 tries.
    await page.getByLabel("Retry policy").selectOption("linear");
    const chart = page.getByTestId("retry-chart");
    await expect(chart.getByText("8 tries · 1.2 h")).toBeVisible();
    await expect(chart.getByText("next try in 22 s · last 429")).toHaveCount(0);
    await expect(save).toBeEnabled();
    await chart.getByRole("button", { name: "Show as table" }).click();
    await expect(chart.getByRole("table")).toBeVisible();
    await chart.getByRole("button", { name: "Show as chart" }).click();
    // Chips: remove one, add one.
    await page.getByRole("button", { name: "Remove pdf" }).click();
    await expect(page.getByTestId("chip-count")).toHaveText("3 of 31");
    await page.getByRole("button", { name: "Add type" }).click();
    await page
      .getByRole("combobox", { name: "Add type" })
      .or(page.getByLabel("Add type").last())
      .fill("xlsx");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chip-count")).toHaveText("4 of 31");
    // Timeout: the stepper and the raise hint.
    await page.getByRole("button", { name: "Increase timeout" }).click();
    await expect(page.getByTestId("timeout-value")).toHaveText("20 s");
    await page.getByRole("button", { name: "Decrease timeout" }).click();
    await page.getByRole("button", { name: "Raise timeout?" }).click();
    await expect(page.getByTestId("timeout-value")).toHaveText("20 s");
    await save.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    // Discard puts a change back.
    await page.getByLabel("Sync schedule").selectOption("60");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByLabel("Sync schedule")).toHaveValue("15");
    await page.context().close();
  });

  test("credential rotation needs a second admin, and never shows a value", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await openSource(page);
    const form = page.getByTestId("source-form");
    await form.getByRole("button", { name: "Rotate" }).click();
    await expect(form.getByText("Waiting for a second admin")).toBeVisible();
    await form.getByRole("button", { name: "Confirm rotation" }).click();
    await expect(form.getByText("Credential rotated")).toBeVisible();
    await expect(form.getByText("Waiting for a second admin")).toHaveCount(0);
    // Only the secret name is on the page.
    await expect(form.getByTestId("secret-name")).toHaveText(/^SOURCE_[A-Z0-9_]+_SECRET$/);
    await page.context().close();
  });

  test("pause, resume and run sync now", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await openSource(page);
    const form = page.getByTestId("source-form");
    await form.getByRole("button", { name: "Run sync now" }).click();
    await expect(form.getByText("Sync started")).toBeVisible();
    await form.getByRole("button", { name: "Pause" }).click();
    await expect(form.getByText("Source paused")).toBeVisible();
    await expect(form.getByRole("button", { name: "Run sync now" })).toBeDisabled();
    await form.getByRole("button", { name: "Resume" }).click();
    await expect(form.getByRole("button", { name: "Run sync now" })).toBeEnabled();
    await page.context().close();
  });

  test("an ordinary person has no Sources and is sent back", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await page.goto("/settings/profile");
    await expect(page.getByRole("link", { name: "Sources" })).toHaveCount(0);
    await page.goto("/settings/sources");
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await page.context().close();
  });

  test("table twins of the swarm and the ACL strip; axe at 1280 and 400, dark and FR", async ({
    browser,
  }) => {
    for (const o of [
      { w: 1280, theme: "light", lang: "en" },
      { w: 1280, theme: "dark", lang: "en" },
      { w: 1280, theme: "light", lang: "fr" },
      { w: 400, h: 900, theme: "light", lang: "en" },
    ]) {
      const page = await as(browser, "platform_admin", { ...o, h: o.w === 400 ? 2600 : 1000 });
      await openSource(page);
      if (o.lang === "en" && o.w === 1280 && o.theme === "light") {
        for (const id of ["latency-swarm", "acl-strip"]) {
          const p = page.getByTestId(id);
          await p.getByRole("button", { name: "Show as table" }).click();
          await expect(p.getByRole("table")).toBeVisible();
          await p.getByRole("button", { name: "Show as chart" }).click();
        }
      }
      await axe(page, `source ${JSON.stringify(o)}`);
      if (o.w === 400) {
        await page.locator(".opx-srcpage").screenshot({ path: `${SCREENS}v7-ops-source-400.png` });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "no horizontal page scroll at 400 px").toBeLessThanOrEqual(1);
      }
      await page.context().close();
    }
    const list = await as(browser, "platform_admin", { w: 1280 });
    await list.goto("/settings/sources");
    await expect(list.getByTestId("sources-list").locator("tbody tr").first()).toBeVisible();
    await settle(list);
    await axe(list, "sources list");
    await list.context().close();
  });
});

test.describe("platform health", () => {
  test("gauge, outcomes, failures, heatmap with a tooltip, totals and the screenshots", async ({
    browser,
  }) => {
    const page = await as(browser, "platform_admin", { h: 2200 });
    await openHealth(page);
    const gauge = page.getByTestId("health-gauge");
    await expect(gauge.getByTestId("gauge-rate")).toHaveText(/^9\d\.\d%$/);
    await expect(gauge.getByTestId("gauge-failed")).toContainText(/^\d+ of [56],\d{3} failed$/);
    await expect(gauge.getByText("SLO 99%")).toBeVisible();
    for (const s of ["Delivered first try", "Recovered on retry", "Still failing"])
      await expect(gauge.getByText(s)).toBeVisible();
    const fails = page.getByTestId("failures");
    for (const s of ["Blocked by rule", "Graph 429", "Permission denied (fail-closed)", "Timeout"])
      await expect(fails.getByText(s)).toBeVisible();
    // Keyboard: the heatmap starts on the first failing hour and arrows move.
    const heat = page.getByTestId("health-heatmap");
    const grid = heat.getByRole("grid");
    const cell = grid.locator('[tabindex="0"]');
    await cell.focus();
    const tip = page.getByTestId("heat-tip");
    await expect(tip).toBeVisible();
    await page.keyboard.press("End");
    await expect(tip).toContainText("Bid & Pre-sales · 11:00 · 12 blocked · client-name rule");
    await page.keyboard.press("ArrowDown");
    await expect(tip).toContainText("Company Brain");
    await page.keyboard.press("ArrowUp");
    await expect(tip).toContainText("Bid & Pre-sales · 11:00");
    for (const s of ["Fewer", "More", "Failing hour"])
      await expect(heat.getByText(s, { exact: true })).toBeVisible();
    const totals = page.getByTestId("health-totals");
    for (const s of ["Attempts", "Delivered", "Failed"])
      await expect(totals.getByText(s)).toBeVisible();
    // Windows.
    await heat.getByRole("radio", { name: "1h" }).click();
    await expect(grid.getByRole("gridcell")).toHaveCount(8 * 12);
    await heat.getByRole("radio", { name: "7d" }).click();
    await expect(grid.getByRole("gridcell")).toHaveCount(8 * 28);
    await heat.getByRole("radio", { name: "24h" }).click();
    await expect(grid.getByRole("gridcell")).toHaveCount(8 * 24);
    await page.locator(".opx-health-grid").screenshot({ path: `${SCREENS}v7-ops-health-1440.png` });
    await page.context().close();
  });

  test("table twins for the gauge and the heatmap", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await openHealth(page);
    const heat = page.getByTestId("health-heatmap");
    await heat.getByRole("button", { name: "Show as table" }).click();
    await expect(
      heat.getByRole("table", { name: "Attempts by brain or source, as a table" }),
    ).toBeVisible();
    await expect(heat.getByRole("rowheader", { name: "Bid & Pre-sales" })).toBeVisible();
    await heat.getByRole("button", { name: "Show as chart" }).click();
    const gauge = page.getByTestId("health-gauge");
    await gauge.getByRole("button", { name: "Show as table" }).click();
    await expect(gauge.getByRole("table")).toBeVisible();
    await page.context().close();
  });

  test("a steward sees only their brains, and says so", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/settings/health");
    await expect(page.getByTestId("health-scope")).toHaveText(
      "Showing only the brains you manage.",
    );
    const grid = page.getByTestId("health-heatmap").getByRole("grid");
    await expect(grid.getByRole("row")).toHaveCount(2); // Bid & Pre-sales and its source
    await page.context().close();
    const other = await as(browser, "consultant");
    await other.goto("/settings/health");
    await expect(other).toHaveURL(/\/settings\/profile$/);
    await other.context().close();
  });

  test("axe: 1280 light, dark, FR and 400 px", async ({ browser }) => {
    for (const o of [
      { w: 1280, theme: "light", lang: "en" },
      { w: 1280, theme: "dark", lang: "en" },
      { w: 1280, theme: "light", lang: "fr" },
      { w: 400, h: 900, theme: "light", lang: "en" },
    ]) {
      const page = await as(browser, "platform_admin", { ...o, h: o.w === 400 ? 2600 : 1000 });
      await openHealth(page);
      await axe(page, `health ${JSON.stringify(o)}`);
      if (o.w === 400) {
        await page
          .locator(".opx-healthpage")
          .screenshot({ path: `${SCREENS}v7-ops-health-400.png` });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "no horizontal page scroll at 400 px").toBeLessThanOrEqual(1);
      }
      await page.context().close();
    }
  });
});
