// UX v2 acceptance (docs/DESIGN-UX-V2.md section 6) against the dev-mock web app.
import { mkdirSync } from "node:fs";
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
  });
  const page = await ctx.newPage();
  await page.addInitScript((p) => window.localStorage.setItem("secondary.persona", p), persona);
  return page;
}

/** Open a path and dismiss the first-run tour, which the mock shows once per page load. */
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

test.describe("acceptance", () => {
  test("a first-time sales user lands on Ask and gets a cited answer in one step", async ({
    browser,
  }) => {
    const page = await as(browser, "consultant");
    await open(page, "/");
    await expect(page.getByRole("heading", { name: "What do you need to know?" })).toBeVisible();
    await page.getByRole("button", { name: "How do we run a project handover?" }).click();
    await expect(page.getByTestId("answer")).toContainText("Delivery handbook");
    const chip = page
      .getByRole("group", { name: "Sources" })
      .getByRole("link", { name: "Delivery handbook" });
    await expect(chip).toBeVisible();
    await expect(page.getByTestId("usage-foot")).toContainText("tokens used");
    await expect(page.getByTestId("usage-foot")).toContainText("Saved");
    await page.screenshot({ path: `${SCREENS}ask-answer-1280.png`, fullPage: true });
    await chip.click();
    await expect(page).toHaveURL(/\/brain\?ws=core&page=delivery-handbook/);
    await expect(page.getByRole("heading", { level: 2, name: "Delivery handbook" })).toBeVisible();
    await page.context().close();
  });

  test("an unanswerable question shows the unknown state", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await open(page, "/");
    await page.locator("#ask-input").fill("Zebra quantum xylophone budget");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByTestId("unknown")).toContainText("does not know this yet");
    await expect(
      page.getByTestId("unknown").getByRole("link", { name: /Capture what you know/ }),
    ).toBeVisible();
    await page.screenshot({ path: `${SCREENS}ask-unknown-1280.png`, fullPage: true });
    await page.context().close();
  });

  test("the Brain tree shows only admitted folders: locked by name, hidden absent", async ({
    browser,
  }) => {
    const consultant = await as(browser, "consultant");
    await open(consultant, "/brain");
    const tree = consultant.getByRole("navigation", { name: "Brain folders" });
    await expect(tree.getByRole("button", { name: /Offers/ })).toBeVisible();
    await expect(tree.getByTestId("tree-locked").filter({ hasText: "Bids" })).toBeVisible();
    await expect(tree.getByText("Acme")).toHaveCount(0);
    await consultant.context().close();

    const auditor = await as(browser, "auditor");
    await open(auditor, "/brain");
    const t2 = auditor.getByRole("navigation", { name: "Brain folders" });
    await expect(t2.getByRole("button", { name: /Offers/ })).toBeVisible();
    await expect(t2.getByText("Bids")).toHaveCount(0);
    await auditor.context().close();
  });

  test("reading, paper mode, history, facts and export", async ({ browser }) => {
    const page = await as(browser, "acme_lead");
    await open(page, "/brain?ws=a_acme&page=acme-overview");
    await expect(page.getByRole("heading", { level: 2, name: "Acme overview" })).toBeVisible();
    await expect(page.getByRole("img", { name: "How an answer is built" })).toBeVisible();
    await page.getByRole("tab", { name: "Facts over time" }).click();
    await expect(page.getByRole("list", { name: "Facts over time" })).toContainText("2027-03-31");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("Revision r2")).toBeVisible();
    await page.getByRole("tab", { name: "Linked from" }).click();
    await expect(page.getByRole("link", { name: "Data platform health check" })).toBeVisible();
    await page.getByRole("button", { name: "Paper" }).click();
    await expect(page.locator(".reading.paper")).toBeVisible();
    await page.screenshot({ path: `${SCREENS}brain-paper-1280.png`, fullPage: true });
    await axe(page, "brain paper");
    await page.getByRole("button", { name: "Export brain" }).click();
    const down = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download .zip" }).click();
    expect((await down).suggestedFilename()).toMatch(/^brain-a_acme/);
    await page.context().close();
  });

  test("Questions resolves an ingest question and a contradiction; the badge follows", async ({
    browser,
  }) => {
    const page = await as(browser, "consultant");
    await open(page, "/questions");
    const rail = page.getByRole("navigation", { name: "Main" });
    await expect(rail.getByRole("link", { name: /Questions/ })).toContainText("3");
    await page.screenshot({ path: `${SCREENS}questions-1280.png`, fullPage: true });
    const ingest = page.getByRole("article", { name: "Include the Q4 pricing thread?" });
    await expect(ingest).toContainText("Why you are asked");
    await ingest.getByRole("button", { name: "Include" }).click();
    await expect(ingest).toHaveCount(0);
    const contra = page.getByRole("article", { name: "Acme renewal date" });
    await expect(contra.getByText("Renewal is due 2027-03-31.")).toBeVisible();
    await expect(contra.getByText("Renewal moved to 2027-06-30.")).toBeVisible();
    await contra.getByRole("button", { name: "This one is right: New source" }).click();
    await expect(contra).toHaveCount(0);
    await expect(rail.getByRole("link", { name: /Questions/ })).toContainText("1");
    await page.context().close();
  });

  test("approvals show the two-person rule and refuse self-approval with the reason", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await open(page, "/questions");
    await page.getByRole("button", { name: /Approvals/ }).click();
    const card = page.getByRole("article", { name: /Release to Company Global/ });
    await expect(card.getByTestId("two-person")).toContainText("1 of 2 approvals");
    await card.getByRole("button", { name: "Approve release" }).click();
    await expect(card.getByRole("alert")).toContainText("different person");
    await page.context().close();
  });

  test("Studio: digest links open, the draft says nothing is sent, Landing Page Studio offers a new page", async ({
    browser,
  }) => {
    const page = await as(browser, "consultant");
    await open(page, "/studio");
    await expect(page.getByTestId("draft-note")).toContainText("Nothing is sent");
    await expect(
      page.getByTestId("lp-card").getByRole("button", { name: "New page" }),
    ).toBeVisible();
    await expect(page.getByTestId("lp-card")).not.toContainText("Coming soon");
    await page.screenshot({ path: `${SCREENS}studio-1280.png`, fullPage: true });
    const links = page.locator(".digest-sec a");
    const n = await links.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const href = (await links.nth(i).getAttribute("href")) as string;
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expect(page.getByText("Not found")).toHaveCount(0);
      await page.goBack();
    }
    await open(page, "/studio");
    await page.getByRole("button", { name: "Create email draft" }).click();
    await expect(page.getByTestId("draft-done")).toContainText("Nothing was sent");
    await page.context().close();
  });

  test("Routines: guided wizard creates one and the run history explains each verdict", async ({
    browser,
  }) => {
    const page = await as(browser, "reviewer");
    await open(page, "/routines");
    await page.getByRole("button", { name: /Run history/ }).click();
    await expect(page.getByText("Personal. Excluded by your guardrails.")).toBeVisible();
    await expect(page.getByText("Asked you").first()).toBeVisible();
    await page.screenshot({ path: `${SCREENS}routines-1280.png`, fullPage: true });
    await page.getByRole("button", { name: "New routine" }).click();
    await page.getByLabel(/SharePoint folder/).check();
    await page.getByLabel("Site or folder name").fill("Delivery");
    await page.screenshot({ path: `${SCREENS}routines-wizard-1280.png`, fullPage: true });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Daily").check();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByLabel("Personal content")).toBeDisabled();
    await page.getByRole("button", { name: "Create routine" }).click();
    await expect(page.getByRole("heading", { name: "SharePoint folder routine" })).toBeVisible();
    await page.context().close();
  });

  test("Usage shows the tokens of the last answer", async ({ browser }) => {
    const page = await as(browser, "platform_admin");
    await open(page, "/usage");
    const read = async () =>
      Number(
        ((await page.locator(".usage-stats dd").first().textContent()) ?? "0").replace(/\D/g, ""),
      );
    const before = await read();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask" }).click();
    await page
      .getByRole("button", { name: /bid playbook/i })
      .first()
      .click();
    await expect(page.getByTestId("usage-foot")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Usage" })
      .click();
    await expect.poll(read).toBeGreaterThan(before);
    await page.getByRole("tab", { name: "Whole company" }).click();
    await page.screenshot({ path: `${SCREENS}usage-1280.png`, fullPage: true });
    await page.context().close();

    const c = await as(browser, "consultant");
    await open(c, "/usage");
    await expect(c.getByRole("tab", { name: "Whole company" })).toHaveCount(0);
    await c.context().close();
  });

  test("the rail defaults follow the role and nothing is unreachable", async ({ browser }) => {
    const names = async (persona: string) => {
      const p = await as(browser, persona);
      await open(p, "/");
      const rail = p.getByRole("navigation", { name: "Main" });
      const t = (await rail.locator("a .lbl-long").allTextContents()).map((s) => s.trim());
      await p.context().close();
      return t;
    };
    const cons = await names("consultant");
    expect(cons.slice(0, 5)).toEqual(["Ask", "Brain", "Questions", "Studio", "My Secondary"]);
    expect(cons).toEqual(
      expect.arrayContaining([
        "Today",
        "Map",
        "Accounts",
        "Governances",
        "Review",
        "Routines",
        "Usage",
      ]),
    );
    expect(cons).not.toContain("Admin");
    const steward = await names("reviewer");
    expect(steward.slice(0, 7)).toEqual([
      "Ask",
      "Brain",
      "Questions",
      "Studio",
      "My Secondary",
      "Map",
      "Routines",
    ]);
    const admin = await names("platform_admin");
    expect(admin).toEqual(expect.arrayContaining(["Admin", "Usage"]));
    expect(admin.indexOf("Usage")).toBeLessThan(admin.indexOf("Today"));
  });

  test("at 400px Ask and Brain are fully usable", async ({ browser }) => {
    const page = await as(browser, "consultant", 400, 860);
    await open(page, "/");
    await page.getByRole("button", { name: "How do we run a project handover?" }).click();
    await expect(page.getByTestId("answer")).toContainText("Delivery handbook");
    await noOverflow(page);
    await page.getByRole("link", { name: "Delivery handbook" }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: "Delivery handbook" })).toBeVisible();
    await page.getByRole("button", { name: "Folders" }).click();
    await page.getByRole("button", { name: /Offers/ }).click();
    await page.getByRole("button", { name: "Analytics retainer offer" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Analytics retainer offer" }),
    ).toBeVisible();
    await noOverflow(page);
    // Every other view sits behind More.
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("group", { name: "More" }).getByRole("link", { name: "Map" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("French: every new view renders in French", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await open(page, "/");
    await page.getByRole("button", { name: "FR Français" }).click();
    await expect(page.getByRole("heading", { name: "Que voulez-vous savoir ?" })).toBeVisible();
    for (const [path, h] of [
      ["/brain", "Le cerveau de l'entreprise, en dossiers"],
      ["/questions", "Votre cerveau a des questions pour vous"],
      ["/studio", "Mettez le cerveau au travail"],
      ["/routines", "Des routines qui nourrissent votre cerveau"],
      ["/usage", "Ce que coûtent vos questions, et ce qu'elles ont économisé"],
    ] as const) {
      await page.getByRole("navigation", { name: "Principal" }).getByRole("link").first().focus();
      await page.evaluate((p) => {
        window.history.pushState({}, "", p);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, path);
      await expect(page.getByRole("heading", { name: h })).toBeVisible();
    }
    await page.context().close();
  });
});

test.describe("every new view: axe, no horizontal overflow, screenshots", () => {
  const views: [string, string, string][] = [
    ["ask", "/", "consultant"],
    ["brain", "/brain?ws=core&page=bid-playbook", "head_bid"],
    ["brain-tree", "/brain", "consultant"],
    ["questions", "/questions", "reviewer"],
    ["studio", "/studio", "acme_lead"],
    ["routines", "/routines", "consultant"],
    ["usage", "/usage", "platform_admin"],
  ];
  for (const [name, path, persona] of views) {
    for (const [wl, w, h] of SIZES) {
      test(`${name} at ${wl}`, async ({ browser }) => {
        const page = await as(browser, persona, w, h);
        await open(page, path);
        await page.screenshot({ path: `${SCREENS}${name}-${wl}.png`, fullPage: true });
        await noOverflow(page);
        await axe(page, `${name} ${wl}`);
        await page.context().close();
      });
    }
  }
});
