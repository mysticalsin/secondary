// Secondary v8 Review desk (docs/DESIGN-V8-AMAZING.md section 1) against the web app in dev-mock
// mode: the dark strip and its table twin, three columns (stacked on a phone), keyboard flows,
// approve gating, snooze, request changes, reassign, the SLA line, axe at 1280 and 400 in English
// and French, dark, and reduced motion. Screenshots land in e2e/screens/v8-review-*.png.
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
  o: {
    w?: number;
    h?: number;
    theme?: string;
    lang?: string;
    motion?: "reduce" | "no-preference";
  } = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1440, height: o.h ?? 1900 },
    reducedMotion: o.motion ?? "reduce",
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

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^(Loading|Chargement)$/ })).toHaveCount(
    0,
  );
};
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SCREENS}v8-review-${name}.png` });
const rows = (page: Page) => page.getByTestId("rv-row");
const current = (page: Page) => page.locator('[data-testid="rv-row"][aria-current="true"]');

test.describe("the desk", () => {
  test("strip, three columns, sections, rows, table twin; axe and screenshot at 1440", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Review desk", level: 1 })).toBeVisible();
    const strip = page.getByTestId("rv-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByTestId("rv-kpi-waiting")).toContainText("Waiting");
    await expect(strip.getByTestId("rv-kpi-cleared")).toContainText("Cleared this week");
    // Three columns side by side: queue, focus, decision.
    const [q, f, d] = await Promise.all(
      [
        page.getByRole("navigation", { name: "Review queue" }),
        page.getByTestId("rv-focus"),
        page.getByTestId("rv-decide"),
      ].map((l) => l.boundingBox()),
    );
    expect(q && f && d).toBeTruthy();
    expect((q?.x ?? 0) < (f?.x ?? 0) && (f?.x ?? 0) < (d?.x ?? 0)).toBe(true);
    expect(Math.abs((q?.y ?? 0) - (f?.y ?? 0))).toBeLessThan(40);
    for (const h of ["Your decision", "Contradictions", "Mentions", "Snoozed", "FYI"])
      await expect(page.getByRole("heading", { name: new RegExp(`^${h}`) }).first()).toBeVisible();
    // Sorted by priority: the overdue change with risk flags first.
    await expect(rows(page).first()).toContainText("Pricing guide: payment terms");
    await expect(rows(page).first()).toContainText("Overdue");
    await expect(rows(page).first().getByText("Personal data")).toBeAttached();
    await expect(rows(page).first()).toContainText("~1 min");
    // What changed, risk panel, context, discussion.
    await expect(page.getByTestId("rv-summary")).toContainText("What changed");
    await expect(page.getByTestId("rv-risk")).toContainText("Client name detected");
    await expect(page.getByRole("heading", { name: "Context" })).toBeVisible();
    await expect(page.getByTestId("rv-thread")).toBeVisible();
    // Table twin of the strip.
    await strip.getByRole("button", { name: "Show as table" }).click();
    await expect(strip.getByRole("table")).toBeVisible();
    await expect(strip.getByRole("columnheader", { name: "Approved" })).toBeVisible();
    await strip.getByRole("button", { name: "Show as chart" }).click();
    await shot(page, "desk-1440");
    await axe(page, "desk 1280");
    await page.setViewportSize({ width: 1280, height: 1600 });
    await axe(page, "desk at 1280");
    await page.context().close();
  });

  test("a contradiction opens as a card, a release shows the two-person status", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review/q_con_1");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Acme renewal date", level: 2 })).toBeVisible();
    await expect(page.getByText("Which is right?").first()).toBeVisible();
    await shot(page, "contradiction-1440");
    await page.goto("/review/q_rel_1");
    await settle(page);
    await expect(page.getByTestId("two-person")).toContainText("1 of 2 approvals");
    await page.context().close();
  });
});

test.describe("keyboard", () => {
  test("J and K move, Enter opens, S snoozes, M writes, A waits for every change, ? helps", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review");
    await settle(page);
    const first = await current(page).getAttribute("data-id");
    await page.keyboard.press("j");
    await expect.poll(() => current(page).getAttribute("data-id")).not.toBe(first);
    await page.keyboard.press("k");
    await expect.poll(() => current(page).getAttribute("data-id")).toBe(first);
    await page.keyboard.press("Enter");
    await expect(page.locator("#rv-focus-h")).toBeFocused();
    // A is refused while changes are unseen, and says why.
    await page.goto("/review/q_prop_1");
    await settle(page);
    await page.locator("body").press("a");
    await expect(page.getByRole("button", { name: /^Approve/ })).toBeDisabled();
    await expect(page.getByText(/Read \d more changes before you approve/)).toBeVisible();
    await page.keyboard.press("m");
    await expect(page.getByLabel("Add a comment")).toBeFocused();
    // Typing does not trigger shortcuts.
    await page.keyboard.type("jks?a");
    await expect(page.getByLabel("Add a comment")).toHaveValue("jks?a");
    await page.getByLabel("Add a comment").blur();
    await page.keyboard.press("s");
    const snooze = page.getByRole("dialog", { name: "Snooze this review" });
    await expect(snooze).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(snooze).toBeHidden();
    await page.locator("body").press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await axe(page, "help dialog");
    await page.keyboard.press("Escape");
    await page.context().close();
  });
});

test.describe("decisions", () => {
  test("Approve stays disabled until every change is seen, then clears the item", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review/q_prop_1");
    await settle(page);
    const approve = page.getByTestId("rv-approve");
    await expect(approve).toBeDisabled();
    await expect(approve).toContainText(/changes? left to see/);
    for (let guard = 0; guard < 8 && (await approve.isDisabled()); guard++) {
      const next = page.getByRole("button", { name: /Mark as seen/ }).first();
      if (await next.count()) await next.click();
    }
    await expect(page.getByText("Seen 3 of 3 changes")).toBeVisible();
    await expect(approve).toBeEnabled();
    await shot(page, "ready-1440");
    await page.keyboard.press("a");
    await expect(
      rows(page).filter({ hasText: "Bid playbook: price with a written range" }),
    ).toHaveCount(0);
    await page.context().close();
  });

  test("snooze moves the item to Snoozed, request changes waits on the author", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review/q_prop_2");
    await settle(page);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Snooze this review" });
    await dlg.getByRole("button", { name: "In 3 days" }).click();
    await dlg.getByRole("button", { name: "Snooze", exact: true }).click();
    const snoozed = page.locator('[data-section="snoozed"]');
    await expect(
      snoozed.getByRole("button", { name: /Session report Grace Hopper/ }),
    ).toBeVisible();
    await page.goto("/review/q_v8_import");
    await settle(page);
    await page.getByRole("button", { name: "Request changes" }).click();
    const rc = page.getByRole("dialog", { name: "Request changes" });
    await expect(rc.getByRole("button", { name: "Send request" })).toBeDisabled();
    await rc
      .getByLabel("What should the author change?")
      .fill("Cite a source for the escalation rule.");
    await rc.getByRole("button", { name: "Send request" }).click();
    await expect(snoozed.getByRole("button", { name: /Delivery playbook/ })).toContainText(
      "Waiting for the author",
    );
    await page.context().close();
  });

  test("reassign lists only eligible reviewers and the thread warns about personal data", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review/q_prop_1");
    await settle(page);
    await page.getByRole("button", { name: "Reassign" }).click();
    const dlg = page.getByRole("dialog", { name: "Reassign this review" });
    await expect(dlg.getByRole("option")).toHaveText([
      "Chief Executive",
      "Head of Bid",
      "Knowledge Reviewer",
    ]);
    await dlg.getByLabel("Reviewer").selectOption({ label: "Knowledge Reviewer" });
    await dlg.getByRole("button", { name: "Reassign", exact: true }).click();
    await expect(page.getByText("Assigned to Knowledge Reviewer")).toBeVisible();
    const box = page.getByLabel("Add a comment");
    await box.fill("Ask Jane on +1 514 555 0199 @reviewer");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "personal data" })).toBeVisible();
    await page.getByRole("button", { name: "Send anyway" }).click();
    await expect(page.getByTestId("rv-thread").getByRole("list")).toContainText("@reviewer");
    await page.context().close();
  });

  test("the SLA shows on Members and access and a manager changes it", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid/access");
    await settle(page);
    const sla = page.getByTestId("review-sla");
    await expect(sla).toContainText("2 business days");
    await sla.getByLabel("Due within").selectOption("3");
    await expect(sla).toContainText("3 business days");
    await page.context().close();
  });
});

test.describe("phone, French, dark, reduced motion", () => {
  test("at 400 px the columns stack, nothing scrolls sideways, axe is clean", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid", { w: 400, h: 3000 });
    await page.goto("/review/q_prop_1");
    await settle(page);
    const [q, f, d] = await Promise.all(
      [
        page.getByRole("navigation", { name: "Review queue" }),
        page.getByTestId("rv-focus"),
        page.getByTestId("rv-decide"),
      ].map((l) => l.boundingBox()),
    );
    expect((q?.y ?? 0) < (f?.y ?? 0) && (f?.y ?? 0) < (d?.y ?? 0)).toBe(true);
    expect(Math.abs((q?.x ?? 0) - (f?.x ?? 99))).toBeLessThan(2);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(1);
    await shot(page, "desk-400");
    await axe(page, "desk at 400");
    await page.context().close();
  });

  test("French at 1280 and 400, axe clean", async ({ browser }) => {
    const page = await as(browser, "head_bid", { lang: "fr", w: 1280, h: 1900 });
    await page.goto("/review");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Bureau de révision", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Votre décision/ }).first()).toBeVisible();
    await expect(page.getByTestId("rv-strip")).toContainText("Propositions entrantes");
    await shot(page, "desk-fr");
    await axe(page, "desk fr 1280");
    await page.setViewportSize({ width: 400, height: 2600 });
    await axe(page, "desk fr 400");
    await page.context().close();
  });

  test("dark mode keeps the desk readable", async ({ browser }) => {
    const page = await as(browser, "head_bid", { theme: "dark" });
    await page.goto("/review/q_v8_mention");
    await settle(page);
    await expect(page.getByTestId("rv-thread")).toContainText("can you check the gate wording");
    await shot(page, "desk-dark");
    await axe(page, "desk dark");
    await page.context().close();
  });

  test("reduced motion: nothing animates", async ({ browser }) => {
    const page = await as(browser, "head_bid", { motion: "reduce" });
    await page.goto("/review");
    await settle(page);
    const name = await page
      .getByTestId("rv-focus")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe("none");
    await page.context().close();
  });

  test("an empty filter says so, with an illustration", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/review?brain=nowhere");
    await settle(page);
    await expect(page.getByTestId("rv-empty")).toContainText("No review matches");
    await expect(page.getByTestId("rv-empty").locator("svg.rv-art")).toHaveCount(1);
    await axe(page, "empty desk");
    await page.context().close();
  });
});
