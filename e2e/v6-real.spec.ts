// v6 My Agent against the real local stack (AI off, so the deterministic planner answers): the SSE
// turn from the browser, a pin that is read again after a reload, and a share that shows a
// lower-privilege persona less. Written to run with the real-stack config; not run in the mock job.
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
  await expect(
    page.getByRole("status").filter({ hasText: /^(Loading|Reading the brain)$/ }),
  ).toHaveCount(0);
};

test.describe.configure({ mode: "serial" });

test("the turn endpoint streams events in order and refuses an invalid body", async ({
  browser,
}) => {
  const page = await asPersona(browser, "head_bid");
  await page.goto("/");
  const res = await page.request.fetch("/v1/agent/turn", {
    method: "POST",
    headers: { "X-Demo-Persona": "head_bid", "Content-Type": "application/json" },
    data: JSON.stringify({ text: "Show me where Bid & Pre-sales stands this month" }),
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/event-stream");
  const events = [...(await res.text()).matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  expect(events[0]).toBe("meta");
  expect(events).toContain("line");
  expect(events.at(-1)).toBe("done");
  const bad = await api(page, "head_bid", "/v1/agent/turn", { method: "POST", body: { nope: 1 } });
  expect(bad.status).toBe(400);
  await page.context().close();
});

test("ask in the panel, pin, reload: the view is read again for the viewer", async ({
  browser,
}) => {
  const page = await asPersona(browser, "head_bid", { width: 1280, height: 900 });
  // Personal workspaces survive a reseed: start from no pinned views so a rerun finds exactly one.
  const old = await api(page, "head_bid", "/v1/views");
  for (const v of (old.json?.views ?? []) as { id: string }[])
    await api(page, "head_bid", `/v1/views/${v.id}`, { method: "DELETE" });
  await page.goto("/");
  await settle(page);
  await page.getByTestId("agent-button").click();
  const box = page.getByRole("textbox", { name: "Ask My Agent" });
  await box.fill("Show me where Bid & Pre-sales stands this month");
  await box.press("Enter");
  await expect(page.getByTestId("agent-funnel")).toBeVisible();
  await expect(page.getByTestId("agent-beeswarm")).toBeVisible();
  await expect(page.getByTestId("agent-pagelist")).toBeVisible();
  await axe(page, "panel real 1280");
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Pin this view" });
  await dlg.getByRole("textbox", { name: "Name" }).fill("Monday bid review");
  await dlg.getByRole("button", { name: "Pin view" }).click();
  await expect(page.getByText("Pinned to My Home.")).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(
    page.getByTestId("agent-cell").getByRole("heading", { name: "Monday bid review" }),
  ).toBeVisible();
  await expect(page.getByTestId("agent-cell").getByTestId("agent-funnel")).toBeVisible();
  const list = await api(page, "head_bid", "/v1/views?pin=home");
  expect(list.status).toBe(200);
  // Plan and layout only: the stored view carries no data.
  expect(JSON.stringify(list.json)).not.toMatch(/"dots"|"points"/);
  for (const v of (list.json?.views ?? []) as { id: string }[])
    await api(page, "head_bid", `/v1/views/${v.id}`, { method: "DELETE" });
  await page.context().close();
});

test("a shared view shows a lower-privilege persona locked cards, never more", async ({
  browser,
}) => {
  const owner = await asPersona(browser, "ceo");
  await owner.goto("/");
  const program = [
    "root = Stack([c1])",
    'c1 = InsightCard("Sales: Knowledge flow", [f1])',
    'f1 = Funnel("c_sales", "30d")',
  ].join("\n");
  const made = await api(owner, "ceo", "/v1/views", {
    method: "POST",
    body: { name: "Sales watch", program, pin: "home" },
  });
  expect(made.status).toBe(201);
  const shared = await api(owner, "ceo", `/v1/views/${made.json.id}/share`, {
    method: "POST",
    body: {},
  });
  expect(shared.status).toBe(200);
  const path = shared.json.path as string;

  const low = await asPersona(browser, "head_bid", { width: 1280, height: 900 });
  const got = await api(low, "head_bid", `/v1${path.replace("/agent", "/views")}`);
  expect(got.status).toBe(200);
  expect(JSON.stringify(got.json.tree)).not.toContain("c_sales");
  await low.goto(path);
  await settle(low);
  await expect(low.getByTestId("agent-locked")).toBeVisible();
  await expect(low.getByTestId("agent-funnel")).toHaveCount(0);
  await axe(low, "shared locked 1280");
  await low.setViewportSize({ width: 400, height: 900 });
  await axe(low, "shared locked 400");
  await low.context().close();

  await api(owner, "ceo", `/v1/views/${made.json.id}`, { method: "DELETE" });
  await owner.context().close();
});
