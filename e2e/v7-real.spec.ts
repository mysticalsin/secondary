// v7 Brain rules against the real local stack: the dev seed rules, the floors refused by the real
// validator, a rule that blocks a real proposal and shows on the receipt, the simulation answering
// from the audit worker, and the Settings page and editor reading the real API. Written for the
// real-stack config (`pnpm e2e`, needs `pnpm dev:all`); the mock job does not run it.
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

const when = (field: string, op: string, ...values: string[]) => ({ field, op, values });
const block = (over: Record<string, unknown> = {}) => ({
  name: "E2E pause pages in delivery",
  scope: { kind: "brains", ids: ["c_delivery"] },
  when: [when("action", "is_any_of", "propose_page")],
  then: { effect: "block", message: "Pages are paused here for the e2e run." },
  except: { incident: false },
  status: "enforced",
  ...over,
});

test("the dev seed rules are there, a stranger gets 404, and a floor is refused by the real validator", async ({
  browser,
}) => {
  const page = await asPersona(browser, "platform_admin");
  await page.goto("/");
  const list = await api(page, "platform_admin", "/v1/rules");
  expect(list.status).toBe(200);
  expect(list.json.rules[0]).toMatchObject({ id: "floor:mcp_review", readOnly: true });
  const ids = list.json.rules.map((r: { id: string }) => r.id);
  expect(ids).toEqual(
    expect.arrayContaining([
      "r_seed_client_global",
      "r_seed_export_50",
      "r_seed_ai_unknown",
      "r_seed_weekend_bid",
    ]),
  );
  const weekend = list.json.rules.find((r: { id: string }) => r.id === "r_seed_weekend_bid");
  expect(weekend).toMatchObject({ status: "monitor", version: 1 });
  expect((await api(page, "consultant", "/v1/rules")).status).toBe(404);
  const bad = await api(page, "platform_admin", "/v1/rules/validate", {
    method: "POST",
    body: block({
      when: [when("action", "is_any_of", "promote_to_global")],
      then: { effect: "review" },
    }),
  });
  expect(bad.status).toBe(422);
  expect(bad.json.issues[0]).toMatchObject({ code: "floor", floor: "global_two_person" });
  await page.context().close();
});

test("an enforced rule blocks a real proposal, the receipt names the rule, and one admin cannot withdraw it alone", async ({
  browser,
}) => {
  const page = await asPersona(browser, "platform_admin");
  await page.goto("/");
  const made = await api(page, "platform_admin", "/v1/rules", { method: "POST", body: block() });
  expect(made.status).toBe(201);
  const id = made.json.id as string;
  const hashOf = async () =>
    (await api(page, "platform_admin", `/v1/rules/${id}`)).json.draftHash as string;
  const pub = await api(page, "platform_admin", `/v1/rules/${id}/publish`, {
    method: "POST",
    body: { expectedHash: await hashOf() },
  });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  const cons = await asPersona(browser, "consultant");
  await cons.goto("/");
  const refused = await api(cons, "consultant", "/v1/wiki/c_delivery/propose", {
    method: "POST",
    body: { title: "E2E rule page", markdown: "# E2E rule page\n\n## Summary\n- A line.\n" },
  });
  expect(refused.status).toBe(403);
  expect(refused.json).toMatchObject({ error: "blocked_by_rule", rule: `${id}@1` });
  // The simulation answers from the audit worker for the same draft.
  const sim = await api(page, "platform_admin", "/v1/rules/simulate", {
    method: "POST",
    body: { rule: block(), days: 7 },
  });
  expect(sim.status).toBe(200);
  expect(sim.json.matches).toBeGreaterThanOrEqual(1);
  expect(sim.json.split.blocked).toBe(sim.json.matches);
  // Withdrawing a live rule is a two-person step (the review's H-1): alone, it stays held and the
  // rule keeps blocking.
  await api(page, "platform_admin", `/v1/rules/${id}`, {
    method: "PUT",
    body: block({ status: "draft" }),
  });
  const off = await api(page, "platform_admin", `/v1/rules/${id}/publish`, {
    method: "POST",
    body: { status: "draft", expectedHash: await hashOf() },
  });
  expect(off.status).toBe(202);
  expect(off.json).toMatchObject({ status: "pending", needs: "second_person" });
  const still = await api(cons, "consultant", "/v1/wiki/c_delivery/propose", {
    method: "POST",
    body: { title: "E2E rule page", markdown: "# E2E rule page\n\n## Summary\n- A line.\n" },
  });
  expect(still.status).toBe(403);
  await page.context().close();
  await cons.context().close();
});

test("Settings › Rules reads the real API: counts, seed rows, the editor with a real impact preview", async ({
  browser,
}) => {
  const page = await asPersona(browser, "platform_admin", { width: 1280, height: 900 });
  await page.goto("/settings/rules");
  await settle(page);
  await expect(page.getByTestId("rule-counts")).toBeVisible();
  await expect(
    page.getByTestId("rule-row").filter({ hasText: "Exports over 50 pages" }),
  ).toBeVisible();
  await expect(page.getByTestId("rule-floor")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}v7-rules-real-list-1280.png`, fullPage: true });
  await axe(page, "rules list real 1280");
  await page.getByTestId("rule-row").filter({ hasText: "Weekend" }).click();
  const dlg = page.getByTestId("rule-editor");
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId("impact-number")).toBeVisible();
  await expect(dlg.getByTestId("rule-status")).toContainText("Monitor");
  await page.screenshot({ path: `${SCREENS}v7-rules-real-editor-1280.png` });
  await axe(page, "rules editor real 1280");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await page.setViewportSize({ width: 400, height: 860 });
  await settle(page);
  await axe(page, "rules list real 400");
  await page.context().close();
});

test("a steward sees the Brain rules for her own brain only", async ({ browser }) => {
  const page = await asPersona(browser, "head_bid");
  await page.goto("/");
  const mine = await api(page, "head_bid", "/v1/rules?brain=c_bid");
  expect(mine.status).toBe(200);
  expect(mine.json.brain).toMatchObject({ id: "c_bid" });
  // The weekend rule names her brain: she sees it, and it is hers to edit.
  const row = mine.json.rules.find((r: { id: string }) => r.id === "r_seed_weekend_bid");
  expect(row).toMatchObject({ editable: true });
  expect((await api(page, "head_bid", "/v1/rules")).status).toBe(404);
  expect((await api(page, "head_bid", "/v1/rules?brain=c_delivery")).status).toBe(404);
  const wide = await api(page, "head_bid", "/v1/rules", {
    method: "POST",
    body: block({ scope: { kind: "tenant" } }),
  });
  expect(wide.status).toBe(403);
  await page.context().close();
});
