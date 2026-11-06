// v5 Brain Insights against the real local stack: the API's masking and isolation seen from the
// browser, the Insights tab on real data, and axe at 1280 and 400.
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
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};

test.describe.configure({ mode: "serial" });

test("overview and insights only carry brains the persona can open", async ({ browser }) => {
  const bid = await asPersona(browser, "head_bid");
  await bid.goto("/");
  const o = await api(bid, "head_bid", "/v1/brains/overview");
  expect(o.status).toBe(200);
  const ids = (o.json.brains as { id: string }[]).map((b) => b.id);
  expect(ids[0]).toBe("me");
  expect(ids).toContain("c_bid");
  expect(ids).not.toContain("c_sales");
  expect((await api(bid, "head_bid", "/v1/brains/c_sales/insights")).status).toBe(404);
  const own = await api(bid, "head_bid", "/v1/brains/c_bid/insights?mode=freshness");
  expect(own.status).toBe(200);
  expect(own.json.constellation.legend.total).toBe(
    own.json.constellation.dots.reduce((n: number, d: { k: number }) => n + d.k, 0),
  );
  await bid.context().close();

  const aud = await asPersona(browser, "auditor");
  await aud.goto("/brains");
  await settle(aud);
  const a = await api(aud, "auditor", "/v1/brains/overview");
  expect((a.json.brains as { id: string }[]).map((b) => b.id)).toEqual(["me"]);
  await expect(aud.getByTestId("glance")).toHaveCount(0);
  await aud.context().close();
});

for (const w of [1280, 400]) {
  test(`the Insights tab on a real brain, axe at ${w}`, async ({ browser }) => {
    const page = await asPersona(browser, "head_bid", { width: w, height: 900 });
    await page.goto("/brains/c_bid?tab=insights");
    await expect(page.getByTestId("insight-constellation")).toBeVisible();
    await settle(page);
    for (const id of ["focus", "health", "flow"])
      await expect(page.getByTestId(`insight-${id}`)).toBeVisible();
    await axe(page, `real insights ${w}`);
    await page.goto("/");
    await settle(page);
    await expect(page.getByTestId("glance")).toBeVisible();
    await axe(page, `real home ${w}`);
    await page.screenshot({ path: `${SCREENS}v5-real-home-${w}.png`, fullPage: true });
    await page.context().close();
  });
}
