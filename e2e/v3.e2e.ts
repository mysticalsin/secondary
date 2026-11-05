// v3 brains acceptance (docs/DESIGN-BRAINS-V3.md, WS-B) against the dev-mock web app.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SIZES: [string, number, number][] = [
  ["1280", 1280, 860],
  ["400", 400, 860],
];

async function as(browser: Browser, persona: string, w = 1280, h = 860): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
    locale: "en-CA",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  await page.addInitScript((p) => window.localStorage.setItem("secondary.persona", p), persona);
  return page;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const skip = page.getByRole("button", { name: "Skip the tour" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")} :: ${v.nodes[0]?.any[0]?.message ?? ""}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/** Shot and axe at both sizes for one path. */
async function sweep(
  browser: Browser,
  persona: string,
  path: string,
  name: string,
  act?: (p: Page) => Promise<void>,
) {
  for (const [label, w, h] of SIZES) {
    const page = await as(browser, persona, w, h);
    await open(page, path);
    if (act) await act(page);
    await page.screenshot({ path: `${SCREENS}v3-${name}-${label}.png`, fullPage: true });
    await axe(page, `${name} ${label}`);
    await noOverflow(page);
    await page.context().close();
  }
}

test.describe("v3 brains", () => {
  test("directory: type chips, health rings, readers and what you manage", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains");
    const list = page.getByRole("list").filter({ has: page.getByRole("heading", { level: 3 }) });
    await expect(list.getByRole("heading", { level: 3 }).first()).toHaveText("My Secondary");
    await expect(
      page.getByRole("img", { name: /Health score \d+ out of 100/ }).first(),
    ).toBeVisible();
    const bid = page.getByRole("listitem").filter({ hasText: "Bid & Pre-sales" });
    await expect(bid).toContainText("You manage");
    await expect(bid).toContainText("18");
    const team = page.getByRole("button", { name: /^Team/ });
    await team.click();
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toContainText("1 shown");
    await expect(page.getByRole("heading", { level: 3, name: "Company Global" })).toHaveCount(0);
    await page.close();
    await sweep(browser, "head_bid", "/brains", "directory");
  });

  test("directory only lists admitted brains", async ({ browser }) => {
    const page = await as(browser, "auditor");
    await open(page, "/brains");
    await expect(page.getByRole("heading", { level: 3, name: "Acme Synthetic SA" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Company Global" })).toBeVisible();
    await page.context().close();
  });

  test("brain home: health strip, what changed with diffs, collections, coach suggestion", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains");
    await page.getByRole("link", { name: "Bid & Pre-sales" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Bid & Pre-sales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Brain health" })).toBeVisible();
    await expect(page.locator(".tile-l", { hasText: "Waiting for review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What changed this week" })).toBeVisible();
    await expect(page.locator(".chg").first()).toContainText("Bid playbook");
    await expect(page.locator(".diffbar").first()).toContainText("+18");
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The coach suggests" })).toBeVisible();
    await page.getByLabel("Status").selectOption("new");
    await expect(page.locator(".chg")).toHaveCount(1);
    await page.getByLabel("Status").selectOption("");
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid", "home");
  });

  test("a restricted brain's score hides what the caller cannot decide", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await open(page, "/brains/c_bid");
    await expect(page.getByText("Visible to people who review").first()).toBeVisible();
    await page.context().close();
  });

  test("access: policy-bound options are disabled with the reason; a member change waits for a second person", async ({
    browser,
  }) => {
    const page = await as(browser, "acme_lead");
    await open(page, "/brains/a_acme/access");
    const direct = page.getByRole("radio", { name: /Publish directly/ });
    await expect(direct).toBeDisabled();
    await expect(page.getByText("Account brains always need a review")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Can read and contribute/ })).toHaveCount(0);
    await page.getByLabel("Person id").fill("u_newperson");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByTestId("pending-banner")).toContainText("Waiting for a second approver");
    await expect(page.getByRole("row", { name: /newperson/ })).toContainText(
      "Waiting for approval",
    );
    await page.context().close();
    await sweep(browser, "acme_lead", "/brains/a_acme/access", "access");
  });

  test("team access lets a manager switch to direct publishing", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/access");
    await page.getByRole("radio", { name: /Publish directly/ }).check();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.getByRole("radio", { name: /Review required/ }).check();
    await page.context().close();
  });

  test("business fields: edit, validate, save", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/fields");
    await page.getByRole("button", { name: "Add field" }).click();
    await page.getByLabel("Key").last().fill("Bad Key");
    await expect(
      page.getByRole("alert").filter({ hasText: "Use a key that starts" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save fields" })).toBeDisabled();
    await page.getByLabel("Key").last().fill("owner_team");
    await page.getByLabel("Label").last().fill("Owning team");
    await page.getByRole("button", { name: "Save fields" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Fields saved." })).toBeVisible();
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid/fields", "fields");
  });

  test("hidden versions: hide with a reason, restore, current cannot be hidden", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/pages/bid-playbook/versions");
    await expect(page.getByText("The current revision cannot be hidden.")).toBeVisible();
    await page.getByRole("button", { name: /Hide Revision 2/ }).click();
    await page.getByLabel("Why hide it?").fill("Names a client that should not be there.");
    await page.getByRole("button", { name: "Hide this version" }).click();
    await expect(page.getByText("Names a client that should not be there.")).toBeVisible();
    await page.getByRole("button", { name: /Restore Revision 2/ }).click();
    await expect(page.getByRole("button", { name: /Hide Revision 2/ })).toBeVisible();
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid/pages/bid-playbook/versions", "versions");
  });

  test("import wizard: format, file, check, classifier results as drafts", async ({ browser }) => {
    const archive = fileURLToPath(new URL("../.dev/v3-sample-vault.zip", import.meta.url));
    mkdirSync(fileURLToPath(new URL("../.dev/", import.meta.url)), { recursive: true });
    writeFileSync(archive, "PK synthetic");
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/import");
    await page.getByRole("radio", { name: /Obsidian vault/ }).check();
    await page.getByRole("button", { name: "Next" }).click();
    await page.locator("#imp-file").setInputFiles(archive);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Every page you import becomes a draft")).toBeVisible();
    // Verdicts come first (dry run): nothing is stored until the button is pressed.
    const preview = page.getByTestId("import-preview");
    await expect(preview).toContainText("Would import");
    await expect(preview).toContainText("Would skip");
    await expect(preview).toContainText("Edit proposal for an existing page");
    await page.screenshot({ path: `${SCREENS}v3-import-check-1280.png`, fullPage: true });
    await page.getByRole("button", { name: "Run the import" }).click();
    const res = page.getByTestId("import-results");
    await expect(res).toContainText("pages are waiting as drafts");
    await expect(res).toContainText("Ingest");
    await expect(res).toContainText("HR material is never imported.");
    await expect(res.getByText("Ask", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}v3-import-results-1280.png`, fullPage: true });
    await axe(page, "import results");
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid/import", "import");
  });

  test("structure coach: interview, proposed tree, apply", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/coach");
    await page.getByRole("button", { name: "Bid manager" }).click();
    await page.getByLabel("Your answers, separated by commas").fill("Acme, Globex");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByLabel("Your answers, separated by commas").fill("Weekly pipeline review");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("button", { name: "practice", exact: true }).click();
    await page.getByRole("button", { name: "Propose a structure" }).click();
    const tree = page.getByTestId("coach-preview");
    await expect(tree.locator("li.add", { hasText: "Methods" })).toContainText("Add");
    await expect(tree.locator("li.keep", { hasText: "Expertise" })).toContainText("Already there");
    await page.screenshot({ path: `${SCREENS}v3-coach-proposal-1280.png`, fullPage: true });
    await axe(page, "coach proposal");
    await page.getByRole("button", { name: "Apply this structure" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "collections created" }).first(),
    ).toBeVisible();
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid/coach", "coach");
  });

  test("coach is not offered to someone who does not manage the brain", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await open(page, "/brains/c_delivery");
    await expect(page.getByRole("link", { name: "Structure coach" })).toHaveCount(0);
    await open(page, "/brains/c_delivery/coach");
    await expect(
      page.getByText("Only people who manage this brain can apply a structure."),
    ).toBeVisible();
    await page.context().close();
  });

  test("journal: days list and a page of counts and links", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains/c_bid/journal");
    await expect(
      page.getByRole("navigation", { name: "Journal days" }).getByRole("button"),
    ).toHaveCount(5);
    await expect(page.getByRole("article")).toContainText("Counts and links only");
    await page.getByRole("button", { name: "Write yesterday's page" }).click();
    await expect(page.getByText("Journal page written.")).toBeVisible();
    await page.context().close();
    await sweep(browser, "head_bid", "/brains/c_bid/journal", "journal");
  });

  test("full path: directory, brain home, access, import, coach, journal", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/brains");
    await page.getByRole("link", { name: "Bid & Pre-sales" }).click();
    const tabs = page.getByRole("navigation", { name: "This brain" });
    await tabs.getByRole("link", { name: "Access" }).click();
    await expect(page.getByRole("heading", { name: "Members and roles" })).toBeVisible();
    await tabs.getByRole("link", { name: "Import" }).click();
    await expect(page.getByRole("heading", { name: "Import a wiki" })).toBeVisible();
    await tabs.getByRole("link", { name: "Structure coach" }).click();
    await expect(page.getByRole("heading", { name: "Structure coach", level: 3 })).toBeVisible();
    await tabs.getByRole("link", { name: "Journal" }).click();
    await expect(page.getByRole("heading", { name: "Journal", level: 3 })).toBeVisible();
    await page.context().close();
  });

  test("questions: search, filters, keyboard J/K/A/R, batch with per-item explanation", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const page = await as(browser, "ceo");
    await open(page, "/questions");
    await expect(page.getByTestId("kbd-hints")).toContainText("approve");
    await page.locator("#q-search").fill("renewal");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.locator("#q-search").fill("");
    await page.locator("#q-kind").selectOption("release");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.locator("#q-kind").selectOption("");
    await page.locator("#q-age").selectOption("1d");
    await expect(page.getByRole("article").first()).toBeVisible();
    await page.locator("#q-age").selectOption("");
    await expect(page.getByRole("article")).toHaveCount(6);
    // J moves to the first card, K stays at the first, then R on an ingest item skips it.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect(page.locator(".q-card.is-active")).toHaveCount(1);
    await page.screenshot({ path: `${SCREENS}v3-questions-keyboard-1280.png`, fullPage: true });
    const first = await page.locator(".q-card.is-active h3").innerText();
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await expect(page.locator(".q-card.is-active h3")).toHaveText(first);
    await page.getByRole("button", { name: "Select several" }).click();
    await page.getByRole("button", { name: /Select all approvable/ }).click();
    await page.getByRole("button", { name: /Review \d+ to approve/ }).click();
    const panel = page.getByTestId("batch-panel");
    await expect(panel).toContainText("First approval");
    await expect(panel).toContainText("Final approval");
    await page.screenshot({ path: `${SCREENS}v3-questions-batch-1280.png`, fullPage: true });
    await axe(page, "questions batch");
    await panel.getByRole("button", { name: /^Approve \d+$/ }).click();
    await expect(panel).toContainText("done");
    await page.context().close();
    await sweep(browser, "consultant", "/questions", "questions");
  });

  test("agents: six tabs, per-user command, live status, revoke needs a confirm", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/settings/agents");
    const tabs = page.getByRole("tablist", { name: "AI tools" });
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    await expect(page.getByTestId("host-state")).toHaveText("Connected");
    await expect(page.getByText(/claude mcp add --transport http/)).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).first().click();
    await expect(page.getByText("Copied").first()).toBeVisible();
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByRole("group", { name: "Revoke this connection?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await tabs.getByRole("tab", { name: /Claude.ai/ }).click();
    await expect(page.getByTestId("host-state")).toHaveText("Not connected");
    await expect(page.getByText("Add custom connector")).toBeVisible();
    await tabs.getByRole("tab", { name: /Claude Code/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /Claude.ai/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: /Codex/ }).click();
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await page.getByRole("button", { name: "Revoke now" }).click();
    await expect(page.getByTestId("host-state")).toHaveText("Not connected");
    await page.context().close();
    await sweep(browser, "head_bid", "/settings/agents", "agents");
  });

  test("pilot cohorts: admin creates one", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await open(page, "/settings/pilot");
    await expect(page.getByRole("heading", { name: "Bid circle pilot" })).toBeVisible();
    await page.getByRole("button", { name: "New cohort" }).click();
    await page.getByLabel("Cohort name").fill("Delivery pilot");
    await page.getByLabel("Members' emails").fill("consultant@example.invalid");
    await page.getByRole("checkbox", { name: /imports/ }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Delivery pilot" })).toBeVisible();
    await page.context().close();
    await sweep(browser, "platform_admin", "/settings/pilot", "pilot");
  });

  test("French: the directory and access page speak French", async ({ browser }) => {
    const page = await as(browser, "acme_lead");
    await page.addInitScript(() => window.localStorage.setItem("secondary.lang", "fr"));
    await open(page, "/brains/a_acme/access");
    await expect(page.getByText("Non autorisé ici").first()).toBeVisible();
    await page.screenshot({ path: `${SCREENS}v3-access-fr-1280.png`, fullPage: true });
    await axe(page, "access fr");
    await page.context().close();
  });
});
