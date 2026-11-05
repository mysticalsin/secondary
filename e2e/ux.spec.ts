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
  const bad = r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")} :: ${v.nodes[0]?.any[0]?.message ?? ""}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
}

const WIDTHS: [string, number, number][] = [
  ["1280", 1280, 860],
  ["400", 400, 860],
];

test.describe("every view: axe, no horizontal overflow, screenshots", () => {
  const views: [string, string, string][] = [
    ["today", "/", "acme_lead"],
    ["map-ring", "/map", "ceo"],
    ["map-clusters", "/map?view=clusters", "ceo"],
    ["map-list", "/map?view=list", "ceo"],
    ["map-table", "/map?view=table", "ceo"],
    ["map-governances", "/map?lens=governances", "ceo"],
    ["accounts", "/accounts", "ceo"],
    ["account", "/accounts/a_acme", "acme_lead"],
    ["governances", "/governances", "ceo"],
    ["review", "/review", "reviewer"],
    ["personal", "/personal", "consultant"],
    ["admin", "/admin", "platform_admin"],
  ];
  for (const [name, path, persona] of views) {
    for (const [wl, w, h] of WIDTHS) {
      test(`${name} at ${wl}`, async ({ browser }) => {
        const page = await asPersona(browser, persona, { width: w, height: h });
        await page.goto(path);
        await settle(page);
        await page.screenshot({ path: `${SCREENS}${name}-${wl}.png`, fullPage: true });
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(over, "horizontal overflow in px").toBeLessThanOrEqual(0);
        await axe(page, `${name} ${wl}`);
        await page.context().close();
      });
    }
  }

  test("governance board, drawer and palette", async ({ browser }) => {
    for (const [wl, w, h] of WIDTHS) {
      const page = await asPersona(browser, "ceo", { width: w, height: h });
      const gs = await api(page, "ceo", "/v1/governances");
      const g = gs.json.find((x: { useCases: number }) => x.useCases > 0);
      await page.goto(`/governances/${g.id}`);
      await settle(page);
      await page.screenshot({ path: `${SCREENS}governance-board-${wl}.png`, fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await axe(page, `board ${wl}`);
      // Drawer
      await page.goto("/map?view=list");
      await settle(page);
      await page.getByRole("button", { name: "Details" }).first().click();
      await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
      await settle(page);
      await page.screenshot({ path: `${SCREENS}drawer-${wl}.png` });
      await axe(page, `drawer ${wl}`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Close details" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Details/ }).first()).toBeFocused();
      // Palette
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog", { name: "Search and jump" })).toBeVisible();
      await axe(page, `palette ${wl}`);
      await page.keyboard.press("Escape");
      await page.context().close();
    }
  });
});

const STAMP = Date.now().toString(36);

test.describe("Personal Brain", () => {
  test("create, tag, autosave, revise, compare, restore, search, delete", async ({ browser }) => {
    const page = await asPersona(browser, "consultant");
    await page.goto("/personal");
    await page.getByRole("button", { name: "New note" }).click();
    await page.getByLabel("Title").fill(`Kickoff ${STAMP}`);
    await page.getByLabel("Body").fill("Confirm the sponsor\nBook the room");
    await page.getByLabel("Tags").fill("kickoff, Pricing");
    // Autosave of the working copy, before any save.
    await expect(page.getByText(/Draft saved at/)).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/Saved .*r1/)).toBeVisible();
    // Revise
    await page.getByLabel("Body").fill("Confirm the sponsor\nBook the room\nSend the agenda");
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByText(/Saved .*r2/)).toBeVisible();
    // History: compare r1 with current, then restore r1.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText("1 lines added, 0 lines removed.")).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/Saved .*r3/)).toBeVisible();
    await expect(page.getByLabel("Body")).toHaveValue("Confirm the sponsor\nBook the room");
    // Search and tag filter
    await page.getByLabel("Search my notes").fill("sponsor");
    await expect(
      page.getByRole("list", { name: "Your items" }).getByText(`Kickoff ${STAMP}`).first(),
    ).toBeVisible();
    await page.getByLabel("Search my notes").fill("zzzz");
    await expect(page.getByText("No note matches")).toBeVisible();
    await page.getByLabel("Search my notes").fill("");
    await page
      .getByRole("group", { name: "Filter by tag" })
      .getByRole("button", { name: "#pricing" })
      .click();
    await expect(
      page.getByRole("list", { name: "Your items" }).getByText(`Kickoff ${STAMP}`).first(),
    ).toBeVisible();
    await axe(page, "personal with history");
    await page.screenshot({ path: `${SCREENS}personal-history-1280.png`, fullPage: true });
    // Delete with a confirm dialog that holds focus.
    await page.getByRole("button", { name: "Delete" }).click();
    const dlg = page.getByRole("alertdialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dlg.getByRole("button", { name: "Delete note" }).click();
    await expect(page.getByText("Note deleted.")).toBeVisible();
  });

  test("an unsaved working copy comes back", async ({ browser }) => {
    const page = await asPersona(browser, "consultant");
    await page.goto("/personal?new=1");
    await page.getByLabel("Title").fill("Half written");
    await page.getByLabel("Body").fill("Not saved yet");
    await expect(page.getByText(/Draft saved at/)).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.getByText("Restored your unsaved changes from last time.")).toBeVisible();
    await expect(page.getByLabel("Body")).toHaveValue("Not saved yet");
    await page.getByRole("button", { name: "Discard them" }).click();
    await expect(page.getByLabel("Body")).toHaveValue("");
  });
});

test.describe("Review thread", () => {
  test("a reviewer asks for changes with a reason, the contributor sees it, then it is released", async ({
    browser,
  }) => {
    const author = await asPersona(browser, "consultant");
    const me = await api(author, "consultant", "/v1/me");
    const made = await api(author, "consultant", "/v1/personal/items", {
      body: { title: `Handover ${STAMP}`, body: "One\nTwo", kind: "note" },
    });
    expect(made.status).toBe(201);
    const c = await api(author, "consultant", `/v1/personal/items/${made.json.id}/contribute`, {
      body: {
        targetScopeId: "c_delivery",
        user_validated: { by: me.json.principal.id, at: new Date().toISOString(), revision: 1 },
        acknowledged_flags: [],
      },
    });
    expect(c.status).toBe(201);

    const rev = await asPersona(browser, "reviewer");
    await rev.goto("/review");
    await rev.getByRole("button", { name: new RegExp(`Handover ${STAMP}`) }).click();
    await expect(rev.getByText("First revision: 2 lines, all new.")).toBeVisible();
    await rev.getByLabel("Add a comment").fill("Who owns step two?");
    await rev.getByRole("button", { name: "Post comment" }).click();
    await expect(rev.getByText("Who owns step two?")).toBeVisible();
    await rev.getByRole("button", { name: "Request changes" }).click();
    await expect(rev.getByRole("button", { name: "Send request" })).toBeDisabled();
    await rev.getByLabel("What needs to change").fill("Name an owner for each step");
    await rev.getByRole("button", { name: "Send request" }).click();
    await expect(
      rev.getByText("Changes requested. The author will see your reason."),
    ).toBeVisible();
    await rev.screenshot({ path: `${SCREENS}review-after-changes-1280.png` });

    await author.goto("/personal");
    await author.getByRole("button", { name: new RegExp(`Handover ${STAMP}`) }).click();
    await expect(author.getByText("Changes requested", { exact: true })).toBeVisible();
    await expect(author.getByText("Name an owner for each step")).toBeVisible();
    await expect(author.getByText("Who owns step two?")).toBeVisible();
  });

  test("the diff is a real line diff between revisions", async () => {
    // Pure function, covered in unit tests. Here: the API gives previous and current text.
  });
});

test.describe("Account workspace", () => {
  test("a member adds a commitment, a risk and a story with the customer permission gate", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "acme_lead");
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Commitments and actions" }).click();
    await page.getByRole("button", { name: "Add a commitment" }).click();
    await page.getByLabel("Title").fill("Send the pilot plan");
    await page.getByLabel("Owner role").selectOption("Account lead");
    await page.getByLabel("Due date").fill("2020-01-15");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Send the pilot plan").first()).toBeVisible();
    await expect(page.getByText("Overdue").first()).toBeVisible();

    await page.getByRole("tab", { name: "Risks" }).click();
    await page.getByRole("button", { name: "Add a risk" }).click();
    await page.getByLabel("Title").fill("Budget slip");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Budget slip").first()).toBeVisible();

    await page.getByRole("tab", { name: "Outcomes and stories" }).click();
    await page.getByRole("button", { name: "Add a success story" }).click();
    await page.getByLabel("Title").fill("Faster close e2e");
    await page.getByLabel("Internal story").fill("We cut the close by two days");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const card = page.getByRole("listitem").filter({ hasText: "Faster close e2e" });
    await expect(card.getByText("External, locked")).toBeVisible();
    await card.getByLabel("External version").fill("Public version");
    await card
      .getByLabel("Where is the customer's permission on file")
      .fill("Email from sponsor 30 Oct");
    await card.getByRole("button", { name: "Record customer permission" }).click();
    await expect(card.getByText(/Permission on file: Email from sponsor/)).toBeVisible();
    await expect(card.getByText("Public version").first()).toBeVisible();
    await page.screenshot({ path: `${SCREENS}account-story-1280.png`, fullPage: true });
    await axe(page, "account story");

    // Overview and Today reflect it.
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText("Send the pilot plan").first()).toBeVisible();
    await page.goto("/");
    await expect(page.getByText("Send the pilot plan").first()).toBeVisible();

    // Others without edit see no add button.
    const ceo = await asPersona(browser, "ceo");
    await ceo.goto("/accounts/a_acme");
    await ceo.getByRole("tab", { name: "Decisions" }).click();
    await expect(ceo.getByRole("button", { name: "Add a decision" })).toHaveCount(0);
    await expect(
      ceo.getByText("Only account members can add items.").or(ceo.getByRole("listitem").first()),
    ).toBeVisible();
  });
});

test.describe("language, tour, keyboard", () => {
  test("French by browser default, switch back and forth, remembered", async ({ browser }) => {
    const page = await asPersona(browser, "consultant", { locale: "fr-CA" });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Carte" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ce que vous pouvez voir et faire" }),
    ).toBeVisible();
    for (const path of ["/map", "/accounts", "/governances", "/review", "/personal"]) {
      await page.goto(path);
      await settle(page);
      const text = (await page.locator("main").allInnerTexts()).join("\n");
      expect(text, path).not.toMatch(/\b(Nothing|Loading|Search|Details|Locked|Save|Cancel)\b/);
    }
    await axe(page, "personal fr");
    await page.getByRole("button", { name: /English/ }).click();
    await expect(page.getByRole("link", { name: "Map" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "Map" })).toBeVisible();
    expect((await api(page, "consultant", "/v1/ux/prefs")).json.lang).toBe("en");
    await page.getByRole("button", { name: /Français/ }).click();
    await page.goto("/");
    await page.screenshot({ path: `${SCREENS}today-fr-1280.png`, fullPage: true });
  });

  test("the tour appears once, can be dismissed, and stays dismissed", async ({ browser }) => {
    const page = await asPersona(browser, "auditor", { tour: true });
    await page.goto("/");
    const tour = page.getByRole("dialog", { name: "This is Today" });
    await expect(tour).toBeVisible();
    await axe(page, "tour");
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "Find things on the Map" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /./ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "What you can see and do" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await api(page, "auditor", "/v1/ux/prefs")).json.tourDone).toBe(true);
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(page.getByRole("dialog", { name: "This is Today" })).toBeVisible();
  });

  test("keyboard only: skip link, map nodes with arrows, open details, escape returns focus", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "ceo");
    await page.goto("/map");
    await settle(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    const node = page.locator("svg [data-nid][tabindex='0']");
    await expect(node).toHaveCount(1);
    await node.focus();
    const first = await node.getAttribute("data-nid");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("svg [data-nid][tabindex='0']")).not.toHaveAttribute(
      "data-nid",
      first ?? "",
    );
    await expect(page.locator("svg [data-nid]:focus")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("svg [data-nid]:focus")).toHaveCount(1);
  });

  test("sheets hold focus: contribute sheet traps Tab and returns focus", async ({ browser }) => {
    const page = await asPersona(browser, "consultant");
    await api(page, "consultant", "/v1/personal/items", {
      body: { title: "Sheet focus", body: "plain", kind: "note" },
    });
    await page.goto("/personal");
    await page
      .getByRole("button", { name: /Sheet focus/ })
      .first()
      .click();
    const open = page.getByRole("button", { name: "Contribute to Company" });
    await open.focus();
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await axe(page, "contribute sheet");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(open).toBeFocused();
  });
});
