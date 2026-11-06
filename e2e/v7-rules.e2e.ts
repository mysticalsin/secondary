// Secondary v7 Brain rules (docs/DESIGN-V7-GOVERN-OPERATE.md section 1) against the web app in
// dev-mock mode: the list, the editor over it, live validation and the floors, impact numbers, save,
// publish (one person and two), history and rollback, incident mode, held actions, the steward's
// Brain tab, FR and EN, axe at 1280 and 400, keyboard only. Screenshots land in e2e/screens/v7-*.png.
// The mock keeps its rules in memory, so every test starts from the five seed rules.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`).join(" | ")}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

interface Opts {
  persona?: string;
  w?: number;
  h?: number;
  theme?: string;
  lang?: string;
}
/** A page with persona, theme and language set once (the mock's second-person keys are set per test). */
async function as(browser: Browser, o: Opts = {}): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1280, height: o.h ?? 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([persona, theme, lang]) => {
      if (sessionStorage.getItem("v7.init")) return;
      sessionStorage.setItem("v7.init", "1");
      localStorage.setItem("secondary.persona", persona as string);
      localStorage.setItem("secondary.theme", theme as string);
      localStorage.setItem("secondary.lang", lang as string);
    },
    [o.persona ?? "platform_admin", o.theme ?? "light", o.lang ?? "en"],
  );
  return page;
}
const second = (page: Page) =>
  page.evaluate(() => localStorage.setItem("secondary.mock.rules.second", "1"));
const other = (page: Page) =>
  page.evaluate(() => localStorage.setItem("secondary.mock.rules.other", "1"));

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};
const dlg = (page: Page) => page.getByTestId("rule-editor");
const noScroll = async (page: Page, label: string) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide, `no horizontal page scroll on ${label}`).toBeLessThanOrEqual(1);
};
const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator(".toast")).toContainText(text);

async function goRules(page: Page) {
  await page.goto("/settings/rules");
  await settle(page);
  await expect(page.getByTestId("rule-counts")).toBeVisible();
}
async function openRule(page: Page, name: string | RegExp) {
  await page.getByTestId("rule-row").filter({ hasText: name }).click();
  await expect(dlg(page)).toBeVisible();
  // The impact preview runs once by itself when the editor opens.
  await expect(page.getByTestId("impact-number")).toBeVisible();
}
const publishBtn = (page: Page) => dlg(page).getByTestId("rule-publish");
async function publish(page: Page) {
  await expect(publishBtn(page)).toBeEnabled();
  await publishBtn(page).click();
}
const values = (page: Page, n = 1) =>
  dlg(page).getByRole("combobox", { name: `Values for check ${n}`, exact: true });
async function addChip(box: Locator, text: string) {
  await box.fill(text);
  await box.press("Enter");
}

test.describe("list", () => {
  test("counts, the read-only floor row first, the hard floors, incident mode and held actions", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    const counts = page.getByTestId("rule-counts");
    await expect(counts).toContainText("4");
    await expect(counts).toContainText("+2 since");
    await expect(counts).toContainText("3 enforced");
    await expect(counts).toContainText("1 monitor · 0 draft");
    const items = page.getByTestId("rule-list").getByRole("listitem");
    await expect(items.first()).toContainText(
      "Always on: agent proposals in shared brains need review",
    );
    await expect(items.first().getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("rule-row")).toHaveCount(4);
    const row = page.getByTestId("rule-row").filter({ hasText: "Exports over 50 pages" });
    await expect(row).toContainText("Whole tenant");
    await expect(row).toContainText("Enforced");
    await expect(row).toContainText("v1");
    await expect(page.getByTestId("rule-row").filter({ hasText: "Weekend" })).toContainText(
      "Monitor",
    );
    // The seven floors sit in a disclosure under the list.
    await page.getByTestId("rule-floors").getByText("Hard floors").click();
    await expect(page.getByTestId("rule-floors").getByRole("listitem")).toHaveCount(7);
    await expect(page.getByTestId("rule-floors")).toContainText("Personal Brains stay private");
    await expect(page.getByTestId("rule-holds").getByTestId("rule-hold")).toHaveCount(2);
    await noScroll(page, "list 1280");
    await page.screenshot({ path: `${SCREENS}v7-rules-list-1280.png`, fullPage: true });
    await axe(page, "list 1280");
    await page.context().close();
  });

  test("a person with no Rules surface sees no Rules tab, and a steward sees only her brain's tab", async ({
    browser,
  }) => {
    const nope = await as(browser, { persona: "consultant" });
    await nope.goto("/settings/profile");
    await settle(nope);
    await expect(
      nope.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Rules" }),
    ).toHaveCount(0);
    await nope.goto("/settings/rules");
    await settle(nope);
    await expect(nope).toHaveURL(/\/settings\/profile$/);
    await nope.goto("/brains/c_delivery/access");
    await settle(nope);
    await expect(nope.getByRole("tab", { name: "Rules" })).toHaveCount(0);
    await nope.context().close();

    const admin = await as(browser);
    await admin.goto("/settings/profile");
    await settle(admin);
    await expect(
      admin.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Rules" }),
    ).toBeVisible();
    await admin.context().close();
  });
});

test.describe("editor", () => {
  test("opens over the list, shows the impact, edits a condition and saves a draft", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    await openRule(page, "Exports over 50 pages");
    const d = dlg(page);
    // Header: name, version line, status chip, history and close.
    await expect(
      d.getByRole("heading", { name: "Exports over 50 pages need approval" }),
    ).toBeVisible();
    await expect(d).toContainText(/v1 · edited by the system \d+ d ago/);
    await expect(d.getByTestId("rule-status")).toHaveText("Enforced");
    await expect(d.getByRole("button", { name: "Version history" })).toBeVisible();
    // The list stays in the DOM behind it.
    await expect(page.getByTestId("rule-list")).toBeAttached();
    // WHEN: two conditions separated by one AND label; THEN: effect.
    await expect(d.getByTestId("rule-condition")).toHaveCount(2);
    await expect(d.getByTestId("rule-and")).toHaveCount(1);
    await expect(d.getByLabel("Effect", { exact: true })).toHaveValue("review");
    // Impact: a number, a split with counts, and sample matches with effect chips.
    const n = Number(
      (await page.getByTestId("impact-number").locator(".rl-num").textContent()) ?? "0",
    );
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId("impact-summary")).toContainText(`${n} of`);
    await expect(page.getByTestId("impact-bar")).toBeVisible();
    await expect(page.getByTestId("impact-samples").getByRole("listitem").first()).toContainText(
      "Approval",
    );
    await expect(d).toContainText(/Adds ~\d+ min median wait to \d+ approvals? a day\./);
    // Edit a condition: more pages means fewer matches once the simulation runs again.
    await d.getByRole("spinbutton", { name: "Values for check 2" }).fill("100");
    await expect(d).toContainText("Press Run simulation to refresh");
    await d.getByRole("button", { name: "Run simulation" }).click();
    await expect(d).not.toContainText("Press Run simulation to refresh");
    await expect(page.locator(".rl-impact")).toHaveAttribute("aria-busy", "false");
    const n2 = Number(
      (await page.getByTestId("impact-number").locator(".rl-num").textContent()) ?? "0",
    );
    expect(n2).toBeLessThan(n);
    // The window select re-runs it.
    const total7 = /of (\d+) requests/.exec(
      (await page.getByTestId("impact-summary").textContent()) ?? "",
    )?.[1];
    await d.getByLabel("Window").selectOption("30");
    await expect(page.getByTestId("impact-summary")).not.toContainText(`of ${total7} requests`);
    // Table twin of the split.
    await d.getByRole("button", { name: "Show as table" }).click();
    await expect(d.getByTestId("impact-table").getByRole("row")).toHaveCount(4);
    // Save draft: the list marks unpublished edits.
    await d.getByRole("button", { name: "Save draft" }).click();
    await toast(page, "Draft saved.");
    await expect(d.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await d.getByRole("button", { name: "Close the rule editor" }).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.getByTestId("rule-row").filter({ hasText: "Exports over" })).toContainText(
      "Unpublished edits",
    );
    await page.context().close();
  });

  test("a rule that would loosen a hard floor is refused inline, and Publish stays off until it is fixed", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    await page.getByTestId("rule-new").click();
    const d = dlg(page);
    await expect(d).toContainText("New rule · not saved yet");
    await d.getByRole("textbox", { name: "Rule name" }).fill("Promotions go straight through");
    await addChip(values(page), "Promote to Global");
    await d.getByLabel("Effect", { exact: true }).selectOption("notify");
    await d.getByRole("radio", { name: "Enforced" }).check();
    const issue = d.getByTestId("rule-issue");
    await expect(issue).toContainText("Hard floor");
    await expect(issue).toContainText(
      "A release to Global always needs two approvers: a rule cannot lower that.",
    );
    await expect(publishBtn(page)).toBeDisabled();
    await expect(d).toContainText("Fix the marked parts to publish.");
    await d.getByLabel("Effect", { exact: true }).selectOption("two_approvers");
    await expect(issue).toHaveCount(0);
    await expect(publishBtn(page)).toBeEnabled();
    // A plain mistake is named in plain words next to the part at fault.
    await d.getByRole("textbox", { name: "Rule name" }).fill("No");
    await expect(d.getByTestId("rule-issue")).toContainText("Name the rule in 3 to 80 characters.");
    await expect(publishBtn(page)).toBeDisabled();
    await page.context().close();
  });

  test("publishing a team-scoped rule needs one person; the list shows it as monitor v1", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    await page.getByTestId("rule-new").click();
    const d = dlg(page);
    await d.getByRole("textbox", { name: "Rule name" }).fill("Imports into Bid need review");
    await d.getByLabel("Applies to", { exact: true }).selectOption("brains");
    await addChip(
      d.getByRole("combobox", { name: "Brains or types", exact: true }),
      "Bid & Pre-sales",
    );
    await addChip(values(page), "Import");
    await d.getByRole("radio", { name: "Monitor" }).check();
    await expect(d.getByTestId("impact-number")).toBeVisible();
    await publish(page);
    await toast(page, "Published v1.");
    await expect(d.getByTestId("rule-status")).toHaveText("Monitor");
    await expect(d).toContainText(/v1 · edited by Platform admin/);
    await expect(d.getByTestId("rule-pending")).toHaveCount(0);
    await d.getByRole("button", { name: "Close the rule editor" }).click();
    const row = page.getByTestId("rule-row").filter({ hasText: "Imports into Bid" });
    await expect(row).toContainText("Bid & Pre-sales");
    await expect(row).toContainText("Monitor");
    await expect(page.getByTestId("rule-counts")).toContainText("5");
    await page.context().close();
  });

  test("publishing a tenant rule waits for a second person, who then confirms it", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    await openRule(page, "Exports over 50 pages");
    const d = dlg(page);
    await expect(d).toContainText("A second admin or steward must confirm it");
    await d.getByRole("textbox", { name: "Rule name" }).fill("Exports over 50 pages need review");
    await publish(page);
    await expect(d.getByTestId("rule-pending")).toContainText(
      "Waiting for a second admin or steward",
    );
    await expect(d.getByRole("button", { name: "Waiting for a second person" })).toBeDisabled();
    await expect(d.getByTestId("rule-status")).toHaveText("Enforced");
    // The live version is still v1 until someone else confirms.
    await expect(d).toContainText(/^.*v1 · edited by/);
    await page.context().close();

    // The second person sees "Confirm publish v2".
    const p2 = await as(browser);
    await goRules(p2);
    await openRule(p2, "Exports over 50 pages");
    await other(p2);
    await dlg(p2)
      .getByRole("textbox", { name: "Rule name" })
      .fill("Exports over 50 pages need review");
    await publish(p2);
    const confirm = dlg(p2).getByRole("button", { name: "Confirm publish v2" });
    await expect(confirm).toBeVisible();
    await expect(dlg(p2).getByTestId("rule-pending")).toContainText("Waiting for you");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await toast(p2, "Published v2.");
    await expect(dlg(p2)).toContainText(/v2 · edited by/);
    await expect(dlg(p2).getByRole("button", { name: "Publish v3" })).toBeVisible();
    await p2.context().close();

    // With a second person already in, one click is enough.
    const p3 = await as(browser);
    await goRules(p3);
    await openRule(p3, "Exports over 50 pages");
    await second(p3);
    await dlg(p3)
      .getByRole("textbox", { name: "Rule name" })
      .fill("Exports over 40 pages need review");
    await publish(p3);
    await toast(p3, "Published v2.");
    await p3.context().close();
  });

  test("history lists versions with their changes, and a rollback needs a second person", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    await openRule(page, "Weekend: agent writes");
    const d = dlg(page);
    await d
      .getByRole("textbox", { name: "Rule name" })
      .fill("Weekend: agent writes to Bid need two approvers");
    await d.getByRole("radio", { name: "Enforced" }).check();
    await publish(page);
    await toast(page, "Published v2.");
    await d.getByRole("button", { name: "Version history" }).click();
    const hist = page.getByTestId("rule-history");
    await expect(hist.getByTestId("rule-version")).toHaveCount(2);
    const v2 = hist.getByTestId("rule-version").first();
    await expect(v2).toContainText("v2");
    await expect(v2).toContainText("Live");
    await expect(v2).toContainText("Name");
    await expect(v2).toContainText("Weekend: agent writes to Bid & Pre-sales need two approvers");
    await expect(v2).toContainText("Weekend: agent writes to Bid need two approvers");
    await expect(v2).toContainText("Status");
    await expect(v2).toContainText("monitor");
    await expect(v2).toContainText("enforced");
    await expect(hist.getByTestId("rule-version").nth(1)).toContainText("v1");
    await page.screenshot({ path: `${SCREENS}v7-rules-history-1280.png` });
    await axe(page, "history 1280");
    // Rollback is always two people: the first click waits.
    await hist.getByRole("button", { name: "Roll back to v1" }).click();
    await expect(d.getByTestId("rule-pending")).toContainText(
      "Waiting for a second admin or steward",
    );
    await expect(d.getByTestId("rule-pending")).toContainText("rollback to v1");
    await expect(hist.getByRole("button", { name: "Roll back to v1" })).toBeDisabled();
    await page.context().close();

    const p2 = await as(browser);
    await goRules(p2);
    await openRule(p2, "Weekend: agent writes");
    await second(p2);
    await p2.getByRole("button", { name: "Version history" }).click();
    // Seed has only v1, so make v2 first.
    await p2.getByRole("button", { name: "Back to the rule" }).click();
    await dlg(p2)
      .getByRole("textbox", { name: "Rule name" })
      .fill("Weekend agent writes need two approvers");
    await dlg(p2).getByRole("radio", { name: "Enforced" }).check();
    await publish(p2);
    await toast(p2, "Published v2.");
    await second(p2);
    await p2.getByRole("button", { name: "Version history" }).click();
    await p2.getByTestId("rule-history").getByRole("button", { name: "Roll back to v1" }).click();
    await toast(p2, "Rolled back. This is now v3.");
    const v3 = p2.getByTestId("rule-history").getByTestId("rule-version").first();
    await expect(v3).toContainText("v3");
    await expect(v3).toContainText("Restored from v1");
    await p2.context().close();
  });
});

test.describe("incident mode and held actions", () => {
  test("incident mode is a two-person switch", async ({ browser }) => {
    const page = await as(browser);
    await goRules(page);
    const inc = page.getByTestId("rule-incident");
    await expect(page.getByTestId("incident-state")).toHaveText("Off");
    await inc.getByRole("textbox", { name: "Reason (optional)" }).fill("Suspected leak, Acme");
    await page.getByTestId("incident-toggle").click();
    await toast(page, "Waiting for a second admin to confirm incident mode.");
    await expect(page.getByTestId("incident-state")).toHaveText("Waiting for a second admin");
    await expect(page.getByTestId("incident-toggle")).toBeDisabled();
    await page.context().close();

    const p2 = await as(browser);
    await goRules(p2);
    await other(p2);
    await p2.getByTestId("incident-toggle").click();
    await expect(p2.getByTestId("incident-state")).toHaveText("Another admin asked to turn it on");
    await p2.getByTestId("incident-toggle").click();
    await expect(p2.getByTestId("incident-state")).toContainText("On until");
    await toast(p2, "Incident mode is on.");
    // Turning it off is one admin.
    await p2.getByTestId("incident-toggle").click();
    await expect(p2.getByTestId("incident-state")).toHaveText("Off");
    await p2.context().close();
  });

  test("held actions: an approver decides, never the person who asked", async ({ browser }) => {
    const page = await as(browser);
    await goRules(page);
    const holds = page.getByTestId("rule-holds").getByTestId("rule-hold");
    await expect(holds).toHaveCount(2);
    await expect(holds.nth(1)).toContainText("You asked for this");
    await expect(holds.nth(1).getByRole("button")).toHaveCount(0);
    await holds
      .first()
      .getByRole("button", { name: /^Approve Export in Bid & Pre-sales$/ })
      .click();
    await toast(page, "Approved.");
    await expect(holds).toHaveCount(1);
    await page.context().close();
    const p2 = await as(browser);
    await goRules(p2);
    await p2
      .getByTestId("rule-hold")
      .first()
      .getByRole("button", { name: /^Reject / })
      .click();
    await toast(p2, "Rejected.");
    await expect(p2.getByTestId("rule-hold")).toHaveCount(1);
    await p2.context().close();
  });
});

test.describe("steward", () => {
  test("Brain, Members and access, Rules: one brain, other rules read only, specific brains only", async ({
    browser,
  }) => {
    const page = await as(browser, { persona: "head_bid" });
    await page.goto("/brains/c_bid/access");
    await settle(page);
    const tabs = page.getByRole("tablist", { name: "Members and rules" });
    await expect(tabs.getByRole("tab", { name: "Members" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: "Rules" }).click();
    await expect(page).toHaveURL(/tab=rules/);
    await expect(page.getByTestId("rules-page")).toContainText(
      "Rules that apply in Bid & Pre-sales",
    );
    const items = page.getByTestId("rule-list").getByRole("listitem");
    await expect(items.first()).toContainText("Always on");
    // The tenant rule that reaches this brain is listed read only; her own brain rule is editable.
    const ro = page.getByTestId("rule-row-ro");
    await expect(ro).toHaveCount(1);
    await expect(ro).toContainText("Exports over 50 pages need approval");
    await expect(ro).toContainText("Read only");
    await expect(page.getByTestId("rule-row")).toHaveCount(1);
    await expect(page.getByTestId("rule-row")).toContainText("Weekend");
    // Incident mode is for admins.
    await expect(page.getByTestId("rule-incident")).toContainText(
      "Only admins change incident mode.",
    );
    await expect(page.getByTestId("incident-toggle")).toHaveCount(0);
    // Her new rule can name only brains she stewards.
    await page.getByTestId("rule-new").click();
    const d = dlg(page);
    const scope = d.getByLabel("Applies to", { exact: true });
    await expect(scope).toBeDisabled();
    await expect(scope).toHaveValue("brains");
    await expect(d.getByRole("button", { name: "Remove Bid & Pre-sales" })).toBeVisible();
    // Her impact preview replays only her brain's receipts.
    await d.getByRole("textbox", { name: "Rule name" }).fill("Agent exports need review");
    await addChip(values(page), "Export");
    await expect(d.getByTestId("impact-number")).toBeVisible();
    await expect(d.getByTestId("impact-samples")).not.toContainText("Company Global");
    await expect(d.getByTestId("impact-samples")).not.toContainText("Acme");
    // Publishing a rule on her own team brain needs nobody else.
    await d.getByRole("radio", { name: "Enforced" }).check();
    await publish(page);
    await toast(page, "Published v1.");
    // Keyboard: arrow keys move between the two tabs.
    await d.getByRole("button", { name: "Close the rule editor" }).click();
    await page.getByRole("tab", { name: "Rules" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Members" })).toBeFocused();
    await expect(page).not.toHaveURL(/tab=rules/);
    await page.context().close();
  });
});

test.describe("language and look", () => {
  test("French and English, and the editor stays a light panel in the dark theme", async ({
    browser,
  }) => {
    const page = await as(browser, { lang: "fr", theme: "dark" });
    await page.goto("/settings/rules");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Règles", level: 2 })).toBeVisible();
    await expect(page.getByTestId("rule-counts")).toContainText("3 appliquées");
    await expect(page.getByTestId("rule-counts")).toContainText("1 en suivi · 0 brouillon");
    await expect(page.getByRole("button", { name: "Nouvelle règle" })).toBeVisible();
    await page.getByTestId("rule-row").filter({ hasText: "Exports over" }).click();
    const d = dlg(page);
    await expect(d.getByRole("textbox", { name: "Nom de la règle" })).toBeVisible();
    await expect(d).toContainText(/v1 · modifiée par le système il y a \d+ j/);
    await expect(d.getByText("Quand", { exact: true })).toBeVisible();
    await expect(d.getByTestId("rule-status")).toHaveText("Appliquée");
    await expect(page.getByTestId("impact-number")).toBeVisible();
    await expect(page.getByTestId("impact-number")).toContainText(/demandes? correspondrai/);
    await expect(d.getByRole("button", { name: "Lancer la simulation" })).toBeVisible();
    await expect(d.getByRole("button", { name: /^Publier v2$/ })).toBeVisible();
    // The panel is white even in the dark theme.
    const bg = await d.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: `${SCREENS}v7-rules-editor-fr-dark.png` });
    await axe(page, "editor fr dark 1280");
    await page.context().close();
  });
});

test.describe("accessibility", () => {
  test("axe reports nothing on the list and the editor at 1280 and 400, with no sideways scroll", async ({
    browser,
  }) => {
    const wide = await as(browser);
    await goRules(wide);
    await openRule(wide, "Exports over 50 pages");
    await dlg(wide).getByRole("button", { name: "Show as table" }).click();
    await axe(wide, "editor 1280");
    await dlg(wide).getByRole("button", { name: "Show as bar" }).click();
    // THEN variants: group (approvers), expire, block.
    for (const e of ["group", "expire", "block"]) {
      await dlg(wide).getByLabel("Effect", { exact: true }).selectOption(e);
      await axe(wide, `editor 1280 effect ${e}`);
    }
    await wide.context().close();

    const small = await as(browser, { w: 400, h: 860 });
    await small.goto("/settings/rules");
    await settle(small);
    await expect(small.getByTestId("rule-counts")).toBeVisible();
    await noScroll(small, "list 400");
    await axe(small, "list 400");
    await small.getByTestId("rule-row").filter({ hasText: "Exports over 50 pages" }).click();
    await expect(small.getByTestId("impact-number")).toBeVisible();
    // A full-screen sheet at phone width.
    const box = await dlg(small).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(399);
    await noScroll(small, "editor 400");
    await small.screenshot({ path: `${SCREENS}v7-rules-editor-400.png` });
    await axe(small, "editor 400");
    await dlg(small).getByRole("button", { name: "Version history" }).click();
    await axe(small, "history 400");
    await noScroll(small, "history 400");
    await small.context().close();
  });

  test("keyboard only: open a rule, add and remove chips, Tab stays inside, Escape closes and gives focus back", async ({
    browser,
  }) => {
    const page = await as(browser);
    await goRules(page);
    const row = page.getByTestId("rule-row").filter({ hasText: "Exports over 50 pages" });
    await row.focus();
    await page.keyboard.press("Enter");
    const d = dlg(page);
    await expect(d).toBeVisible();
    // Focus starts on the name.
    await expect(d.getByRole("textbox", { name: "Rule name" })).toBeFocused();
    // Chips: type a value and press Enter; Backspace on an empty box removes the last chip.
    const box = values(page, 1);
    await box.focus();
    await box.fill("Import");
    await page.keyboard.press("Enter");
    await expect(d.getByRole("button", { name: "Remove Import" })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(d.getByRole("button", { name: "Remove Import" })).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Remove Export" })).toBeVisible();
    // A word that is not an option is refused with a hint, not added.
    await box.fill("Nonsense");
    await page.keyboard.press("Enter");
    await expect(d).toContainText("No match for that. Pick from the list.");
    await box.fill("");
    // Tab onto a chip's remove button and press Enter.
    await page.keyboard.press("Shift+Tab");
    await expect(d.getByRole("button", { name: "Remove Export" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(d.getByRole("button", { name: "Remove Export" })).toHaveCount(0);
    // The incident switch is a real switch: Space toggles it.
    const sw = d.getByRole("switch", { name: /While incident mode is on/ });
    await sw.focus();
    const was = await sw.getAttribute("aria-checked");
    await page.keyboard.press("Space");
    await expect(sw).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");
    // Status: arrow keys move through the radios.
    await d.getByRole("radio", { name: "Enforced" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(d.getByRole("radio", { name: "Monitor" })).toBeChecked();
    // Tab never leaves the dialog.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest("[data-testid='rule-editor']"),
      );
      expect(inside, `focus inside the editor after ${i + 1} tabs`).toBe(true);
    }
    // Escape closes it and focus returns to the row that opened it.
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    await expect(row).toBeFocused();
    await page.context().close();
  });
});

test.describe("reference", () => {
  test("the editor at 1280, with several conditions and a named group, for the side-by-side", async ({
    browser,
  }) => {
    const page = await as(browser, { w: 1280, h: 860 });
    await goRules(page);
    await openRule(page, "Exports over 50 pages");
    const d = dlg(page);
    await d.getByRole("button", { name: "Add condition" }).click();
    await d.getByLabel("Check 3", { exact: true }).selectOption("brain_type");
    await addChip(values(page, 3), "Account");
    await addChip(values(page, 3), "Global");
    await d.getByLabel("Effect", { exact: true }).selectOption("group");
    await addChip(d.getByRole("combobox", { name: "Approvers", exact: true }), "Privacy");
    await d.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByTestId("impact-number")).toBeVisible();
    await expect(d).not.toContainText("Press Run simulation to refresh");
    await expect(publishBtn(page)).toBeEnabled();
    await page.mouse.move(2, 2);
    await page.screenshot({ path: `${SCREENS}v7-rules-editor-1280.png` });
    await page.context().close();
  });
});
