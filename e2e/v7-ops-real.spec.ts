// v7 operate against the real local stack (`pnpm dev:all`, with OPS_SYNTHETIC on: no connector runs here,
// so Sources, Activity and Health answer the labelled synthetic numbers). Scope seen from the browser,
// the three views on real API data, retry once, and axe at 1280 and 400.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { api, asPersona } from "./helpers.ts";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe on ${label}`,
  ).toEqual([]);
}
const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
};

test.describe.configure({ mode: "serial" });

test("scope: managers, administrators and people see only their own", async ({ browser }) => {
  const bid = await asPersona(browser, "head_bid");
  await bid.goto("/");
  const act = await api(bid, "head_bid", "/v1/brains/c_bid/activity?window=24h");
  expect(act.status).toBe(200);
  expect(act.json.synthetic).toBe(true);
  expect(act.json.events.some((e: { type: string }) => e.type === "connector.sync")).toBe(true);
  expect(JSON.stringify(act.json)).not.toMatch(/"(title|markdown|body|text)"/);
  expect((await api(bid, "head_bid", "/v1/brains/c_delivery/activity")).status).toBe(404);
  expect((await api(bid, "head_bid", "/v1/sources")).status).toBe(403);
  const steward = await api(bid, "head_bid", "/v1/ops/health?window=24h");
  expect(steward.json.scope).toBe("stewards");
  expect(
    steward.json.heatmap.rows.every(
      (r: { id: string; kind: string }) => r.kind === "source" || r.id === "c_bid",
    ),
  ).toBe(true);
  await bid.context().close();

  const cons = await asPersona(browser, "consultant");
  await cons.goto("/");
  expect((await api(cons, "consultant", "/v1/ops/health?window=24h")).status).toBe(403);
  expect((await api(cons, "consultant", "/v1/brains/c_delivery/activity")).status).toBe(403);
  const own = await api(cons, "consultant", "/v1/agents/activity?window=24h");
  expect(own.status).toBe(200);
  await cons.context().close();

  const adm = await asPersona(browser, "platform_admin");
  await adm.goto("/");
  const h = await api(adm, "platform_admin", "/v1/ops/health?window=24h");
  expect(h.json.scope).toBe("tenant");
  expect(h.json.totals.attempts).toBe(
    h.json.outcomes.firstTry + h.json.outcomes.recovered + h.json.outcomes.failing,
  );
  await adm.context().close();
});

for (const w of [1280, 400]) {
  test(`Brain activity on real data, retry once, axe at ${w}`, async ({ browser }) => {
    const page = await asPersona(browser, "head_bid", { width: w, height: 1100 });
    await page.goto("/brains/c_bid?tab=activity");
    const card = page.getByTestId("ops-activity");
    await expect(card).toBeVisible();
    await expect(card.locator("tbody tr").first()).toBeVisible();
    await settle(page);
    await expect(card.getByText("Synthetic data").first()).toBeVisible();
    await axe(page, `real activity ${w}`);
    if (w === 1280) {
      // The dev stand-in is in a 429 streak: its sync is retrying and can be retried once.
      await card.getByRole("radio", { name: "Failed" }).click();
      await card.locator("tbody tr", { hasText: "connector.sync" }).first().click();
      const detail = page.locator("#opx-detail");
      const retry = detail.getByRole("button", { name: "Retry ingest" });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(
        detail.getByRole("button", { name: /Retry queued|Already queued/ }),
      ).toBeDisabled();
    }
    await page.screenshot({ path: `${SCREENS}v7-ops-real-activity-${w}.png`, fullPage: true });
    await page.context().close();
  });

  test(`Sources and Health on real data, axe at ${w}`, async ({ browser }) => {
    const page = await asPersona(browser, "platform_admin", { width: w, height: 1100 });
    await page.goto("/settings/sources");
    await expect(page.getByTestId("sources-list")).toBeVisible();
    await settle(page);
    await axe(page, `real sources ${w}`);
    await page.getByTestId("sources-list").getByRole("link").first().click();
    await expect(page.getByTestId("source-form")).toBeVisible();
    await expect(page.getByTestId("latency-swarm")).toBeVisible();
    await expect(page.getByTestId("secret-name")).toHaveText("GRAPH_CLIENT_SECRET");
    await settle(page);
    await axe(page, `real source ${w}`);
    await page.screenshot({ path: `${SCREENS}v7-ops-real-source-${w}.png`, fullPage: true });
    await page.goto("/settings/health");
    await expect(page.getByTestId("health-heatmap")).toBeVisible();
    await settle(page);
    await axe(page, `real health ${w}`);
    await page.screenshot({ path: `${SCREENS}v7-ops-real-health-${w}.png`, fullPage: true });
    await page.context().close();
  });
}
