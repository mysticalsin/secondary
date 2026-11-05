// Secondary v4 acceptance (docs/DESIGN-V4-BRAINS-UI.md section 6) against the web app in dev-mock mode.
// The API rules themselves (isolation, seen changes, MCP push) have their own tests in workers/*.
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
  o: { w?: number; h?: number; theme?: string; lang?: string } = {},
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1280, height: o.h ?? 800 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
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
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};
const shot = (page: Page, name: string, full = false) =>
  page.screenshot({ path: `${SCREENS}v4-${name}.png`, fullPage: full });
const side = (page: Page) => page.getByRole("complementary");

test.describe("shell and sidebar", () => {
  test("the sidebar lists only the brains the persona can read", async ({ browser }) => {
    const ceo = await as(browser, "ceo");
    await ceo.goto("/");
    await settle(ceo);
    const nav = side(ceo);
    for (const n of [
      "Home",
      "Waiting for you",
      "My Personal Brain",
      "Bid & Pre-sales",
      "Sales",
      "Accounts",
      "Acme Synthetic SA",
      "Delivery excellence",
      "Company Global",
      "All brains",
    ])
      await expect(nav.getByText(n, { exact: true }).first(), n).toBeVisible();
    await shot(ceo, "home-ceo");
    await ceo.context().close();

    const bid = await as(browser, "head_bid");
    await bid.goto("/");
    await settle(bid);
    const bn = side(bid);
    await expect(bn.getByText("Bid & Pre-sales", { exact: true })).toBeVisible();
    await expect(bn.getByText("Acme Synthetic SA")).toBeVisible();
    await expect(bn.getByText("Sales", { exact: true })).toHaveCount(0);
    await expect(bn.getByText("Delivery excellence")).toHaveCount(0);
    await bid.context().close();
  });

  test("the real Mantu logo shows top left, light and dark, and the sidebar collapses", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo");
    await page.goto("/");
    await settle(page);
    const logo = side(page).getByRole("img", { name: "Mantu" });
    await expect(logo).toHaveAttribute("src", "/brand/logo_main.png");
    expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth > 100)).toBe(true);
    const box = await logo.boundingBox();
    expect(box && box.y < 40 && box.x < 40 && box.height >= 20 && box.height <= 26).toBe(true);
    await side(page).getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect(side(page)).toBeHidden();
    await page.getByRole("button", { name: "Open the sidebar" }).click();
    await expect(side(page)).toBeVisible();
    await page.context().close();

    const dark = await as(browser, "ceo", { theme: "dark" });
    await dark.goto("/");
    await settle(dark);
    await expect(side(dark).getByRole("img", { name: "Mantu" })).toHaveAttribute(
      "src",
      "/brand/logo_main_white.png",
    );
    await shot(dark, "home-dark");
    await axe(dark, "home dark");
    await dark.context().close();
  });

  test("search bar, user menu and keyboard", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/");
    await settle(page);
    await page.keyboard.press("Control+k");
    await expect(
      page.getByRole("searchbox", { name: "Search pages in your brains" }).first(),
    ).toBeFocused();
    await page.keyboard.type("pricing");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=pricing/);
    await expect(page.getByRole("link", { name: "Pricing guide" })).toBeVisible();
    await shot(page, "search");
    // The user menu: Settings and language, reachable by keyboard.
    await side(page)
      .getByRole("button", { name: /Sam Rivera/ })
      .click();
    const menu = page.getByRole("menu", { name: "Your account" });
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.context().close();
  });
});

test.describe("home", () => {
  test("search, waiting summary, your brains, recent changes, a quiet Ask card", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Hello, Sam" })).toBeVisible();
    await expect(page.getByText("8 reviews are waiting for you.")).toBeVisible();
    const brains = page
      .getByRole("heading", { name: "Your brains" })
      .locator("xpath=ancestor::section");
    await expect(brains.getByRole("link", { name: /Bid & Pre-sales/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent changes in your brains" }),
    ).toBeVisible();
    await expect(page.getByText("Ask your brains")).toBeVisible();
    await axe(page, "home");
    await page.context().close();
  });
});

test.describe("brain page", () => {
  test("collections with counts, folders that open in place, loose pages with badges, filters", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Bid & Pre-sales", level: 1 })).toBeVisible();
    await expect(page.getByText("18 people can read · You manage this brain")).toBeVisible();
    await expect(page.getByRole("link", { name: "Activity" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Members and access" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import a wiki" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Trash" })).toBeVisible();
    await expect(page.getByText("Collections hold the big sections of this wiki.")).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "New collection" })
        .or(page.getByRole("link", { name: "New collection" })),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "New page" })).toBeVisible();
    // The loose page carries an Overview badge.
    const loose = page.getByRole("listitem").filter({ hasText: "Bid and Pre-sales: overview" });
    await expect(loose.getByText("Overview", { exact: true })).toBeVisible();
    // Inline expansion down to a page: Sources > Session reports > person.
    const list = page.getByRole("list", { name: "Contents" });
    await expect(list.getByText("3 pages").first()).toBeVisible();
    await list.getByRole("button", { name: "Open or close Sources" }).click();
    await list.getByRole("button", { name: "Open or close Session reports" }).click();
    await list.getByRole("button", { name: "Open or close Ada Lovelace" }).click();
    await expect(
      list.getByRole("link", { name: "Session report Ada Lovelace 2026-11-04", exact: true }),
    ).toBeVisible();
    await shot(page, "brain-tree");
    // The sidebar tree follows the same structure.
    await expect(side(page).getByRole("button", { name: "Sources" })).toBeVisible();
    // Filters.
    await page.getByLabel("Filter by title, summary or tag").fill("pricing");
    await expect(list.getByRole("link", { name: "Pricing guide", exact: true })).toBeVisible();
    await expect(
      list.getByRole("link", { name: "Bid qualification checklist", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Filter by title, summary or tag").fill("");
    await page.getByLabel("Status").selectOption("draft");
    await expect(list.getByRole("link", { name: "Pricing guide", exact: true })).toBeVisible();
    await axe(page, "brain page");
    await page.context().close();
  });

  test("a page opens for reading and New page sends a proposal to the brain's waiting list", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid");
    await settle(page);
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Tender debrief template");
    await page
      .getByLabel("Content (Markdown)")
      .fill("# Tender debrief template\n\n- What we learned");
    await page.getByRole("button", { name: "Send page" }).click();
    await expect(page.getByText("Sent. The page waits for a review.")).toBeVisible();
    // The dev mock keeps its state in memory, so move around inside the app.
    await side(page)
      .getByRole("link", { name: /Waiting for you/ })
      .click();
    await expect(page.getByRole("heading", { name: "Tender debrief template" })).toBeVisible();
    await page.goto("/brains/c_bid/pages/bid-playbook");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Bid playbook", level: 1 })).toBeVisible();
    await shot(page, "page");
    await axe(page, "page");
    await page.context().close();
  });

  test("the Personal Brain says only you can access it and has no sharing", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/me");
    await settle(page);
    await expect(page.getByText("Only you can access this brain")).toBeVisible();
    await expect(page.getByRole("link", { name: "Members and access" })).toHaveCount(0);
    await shot(page, "personal");
    await page.context().close();
  });
});

test.describe("members and access", () => {
  test("add by e-mail with a role, change and remove a role, policy-bounded publication, fields, hidden versions", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/brains/c_bid/access");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Members and access", level: 1 })).toBeVisible();
    await expect(page.getByPlaceholder("Add a name or Mantu e-mail")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Who has access/ })).toContainText("4 people");
    // Everyone at Mantu: policy-bounded, no access by default.
    const everyone = page.getByTestId("everyone-row");
    await expect(everyone).toContainText("Everyone at Mantu");
    await expect(everyone.getByRole("button", { name: /No access/ })).toBeVisible();
    // Role dropdown with descriptions and Remove access.
    await page.getByRole("button", { name: /Role of consultant@example.invalid/ }).click();
    const menu = page.getByRole("menu", { name: /Role of consultant@example.invalid/ });
    await expect(menu.getByText("Open and read every page")).toBeVisible();
    await expect(menu.getByText("Write and propose pages")).toBeVisible();
    await expect(menu.getByText("Members, rules and deleting the brain")).toBeVisible();
    await shot(page, "access-menu");
    await menu.getByRole("menuitemradio", { name: /Can read/ }).click();
    await expect(
      page.getByRole("button", { name: /Role of consultant@example.invalid: Can read/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Role of reviewer@example.invalid/ }).click();
    await page.getByRole("menuitem", { name: "Remove access" }).click();
    await expect(page.getByRole("heading", { name: /Who has access/ })).toContainText("3 people");
    // Add by e-mail.
    await page.getByPlaceholder("Add a name or Mantu e-mail").fill("acme_lead@example.invalid");
    await page.getByLabel("Role", { exact: true }).selectOption("contributor");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Who has access/ })).toContainText("4 people");
    // Publication, business fields and hidden versions.
    await expect(page.getByRole("heading", { name: "Publication" })).toBeVisible();
    await expect(page.getByText("3 still waiting")).toBeVisible();
    await expect(page.getByRole("link", { name: "Publish them" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business fields" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hidden versions" })).toBeVisible();
    await shot(page, "access", true);
    await axe(page, "access");
    await page.context().close();
  });

  test("a reader sees the page read-only", async ({ browser }) => {
    const page = await as(browser, "ceo");
    await page.goto("/brains/c_bid/access");
    await settle(page);
    await expect(page.getByText(/You can read these settings/)).toBeVisible();
    await page.context().close();
  });
});

test.describe("waiting for you", () => {
  test("find, group by brain, select all, badges, Review", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/waiting");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Waiting for you", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Find a review")).toBeVisible();
    const bid = page.getByRole("region", { name: "Bid & Pre-sales" });
    await expect(bid.getByRole("heading", { name: /Bid & Pre-sales/ })).toContainText("3");
    await expect(bid.getByText("Change", { exact: true })).toBeVisible();
    await expect(bid.getByText("New page", { exact: true })).toBeVisible();
    await expect(bid.getByRole("link", { name: /Review/ }).first()).toBeVisible();
    await bid.getByLabel("Select all").check();
    await expect(page.getByRole("region", { name: "Selected reviews" })).toContainText(
      "3 selected",
    );
    await shot(page, "waiting");
    await page.getByLabel("Find a review").fill("playbook");
    await expect(
      page.getByRole("heading", { name: "Bid playbook: price with a written range" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acme renewal date" })).toHaveCount(0);
    await axe(page, "waiting");
    await page.context().close();
  });

  test("the pending proposal: inline diff, change markers, Approve stays off until every change is seen", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/waiting");
    await page
      .getByRole("link", { name: /Review.*Bid playbook: price with a written range/ })
      .click();
    await settle(page);
    await expect(
      page.getByRole("heading", { name: "Bid playbook: price with a written range" }),
    ).toBeVisible();
    await expect(page.getByText("Change 1 of 3").first()).toBeVisible();
    await expect(
      page.getByText("Price with a second pair of eyes and a written range"),
    ).toBeVisible();
    const approve = page.getByRole("button", { name: /^Approve/ });
    await expect(approve).toBeDisabled();
    await expect(approve).toContainText(/changes? left to see/);
    await expect(page.getByText(/Seen \d of 3 changes/)).toBeVisible();
    await expect(page.getByText("See every change before you approve")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject…" })).toBeVisible();
    await shot(page, "proposal");
    await axe(page, "proposal");
    // Keyboard and screen reader users mark a change as seen from its marker.
    for (let guard = 0; guard < 6 && (await approve.isDisabled()); guard++) {
      const next = page.getByRole("button", { name: /Mark as seen/ }).first();
      if (await next.count()) await next.click();
    }
    await expect(page.getByText("Seen 3 of 3 changes")).toBeVisible();
    await expect(approve).toBeEnabled();
    await expect(approve).toHaveText("Approve");
    await shot(page, "proposal-ready");
    await approve.click();
    await expect(page).toHaveURL(/\/waiting$/);
    await expect(
      page.getByRole("heading", { name: "Bid playbook: price with a written range" }),
    ).toHaveCount(0);
    await page.context().close();
  });

  test("reject asks for a reason in a dialog", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/waiting/q_prop_2");
    await settle(page);
    await page.getByRole("button", { name: "Reject…" }).click();
    const dlg = page.getByRole("dialog", { name: "Reject this change" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel("Tell the author why (optional)")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await page.getByRole("button", { name: "Reject…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page).toHaveURL(/\/waiting$/);
    await page.context().close();
  });
});

test.describe("all brains", () => {
  test("a brain the person can see but not open offers a request", async ({ browser }) => {
    const page = await as(browser, "consultant");
    await page.goto("/brains");
    await settle(page);
    await expect(
      page.locator("#main").getByRole("link", { name: "Delivery excellence" }),
    ).toBeVisible();
    const sales = page.getByRole("listitem").filter({ hasText: "Sales" }).first();
    await expect(sales).toContainText("You cannot open it yet");
    await sales.getByRole("button", { name: /Request access/ }).click();
    await page.getByLabel("Why do you need it?").fill("Support the quarter close");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent to the people who manage it.")).toBeVisible();
    await shot(page, "all-brains");
    await axe(page, "all brains");
    await page.context().close();
  });
});

test.describe("settings", () => {
  test("profile from the Microsoft account, your brains, sections by role", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/settings");
    await settle(page);
    await expect(page).toHaveURL(/settings\/profile/);
    await expect(page.getByText("From your Microsoft account")).toBeVisible();
    for (const [k, v] of [
      ["E-mail", "head_bid@example.invalid"],
      ["Job title", "Head of Bid and Pre-sales"],
      ["Department", "Synthetic Group"],
      ["Office", "Montreal office"],
      ["Country", "Canada"],
    ])
      await expect(page.getByText(v as string).first(), k as string).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Settings" });
    for (const n of [
      "Profile",
      "Your brains",
      "Agents",
      "Sign-in and security",
      "Privacy",
      "Appearance",
      "Usage",
      "Journal",
    ])
      await expect(nav.getByRole("link", { name: n }), n).toBeVisible();
    await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
    await shot(page, "settings-profile");
    await axe(page, "settings profile");
    await page.context().close();

    const admin = await as(browser, "platform_admin");
    await admin.goto("/settings/members");
    await settle(admin);
    const an = admin.getByRole("navigation", { name: "Settings" });
    await expect(an.getByRole("link", { name: "Members" })).toBeVisible();
    await expect(an.getByRole("link", { name: "Pilot access" })).toBeVisible();
    await expect(admin.locator(".setbody")).not.toBeEmpty();
    await expect(admin.getByRole("tab").first()).toBeVisible();
    await admin.goto("/settings/pilot");
    await settle(admin);
    await expect(admin.locator(".setbody")).not.toBeEmpty();
    await axe(admin, "settings pilot");
    await admin.context().close();
  });

  test("agents: a tab per host, the command with Copy, what to say, live status and revoke", async ({
    browser,
  }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/settings/agents");
    await settle(page);
    await expect(page.getByText("Agents act with your rights and your name.")).toBeVisible();
    for (const h of ["Claude Code", "Codex", "Dust", "Copilot Studio", "Claude.ai", "ChatGPT"])
      await expect(
        page.getByRole("tab", { name: new RegExp(h.replace(".", "\\.")) }),
        h,
      ).toBeVisible();
    await expect(page.getByText("and authenticate with your Mantu account.")).toBeVisible();
    await expect(page.getByText(/claude mcp add --transport http/)).toBeVisible();
    await expect(page.getByText("Help me set up my Secondary wiki")).toBeVisible();
    await page.getByRole("button", { name: /Copy/ }).first().click();
    await expect(page.getByText("Copied").first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("claude mcp add");
    await expect(page.getByTestId("host-state")).toHaveText("Connected");
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByRole("group", { name: "Revoke this connection?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await page.getByRole("tab", { name: "Copilot Studio" }).click();
    await expect(
      page
        .getByRole("list")
        .filter({ hasText: /Copilot Studio/ })
        .first(),
    ).toBeVisible();
    await shot(page, "settings-agents");
    await axe(page, "settings agents");
    await page.context().close();
  });

  test("appearance: dark mode, language", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    await page.goto("/settings/appearance");
    await settle(page);
    await page.getByLabel("Dark").check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(side(page).getByRole("img", { name: "Mantu" })).toHaveAttribute(
      "src",
      "/brand/logo_main_white.png",
    );
    await shot(page, "settings-appearance-dark");
    await axe(page, "appearance dark");
    await page.getByLabel("Light").check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("Français").check();
    await expect(page.getByRole("heading", { name: "Apparence" })).toBeVisible();
    await page.context().close();
  });

  test("privacy, security and usage open", async ({ browser }) => {
    const page = await as(browser, "head_bid");
    for (const s of ["brains", "security", "privacy", "usage", "journal"]) {
      await page.goto(`/settings/${s}`);
      await settle(page);
      await axe(page, `settings ${s}`);
    }
    await page.context().close();
  });
});

test.describe("every view at 1280 and 400, in French", () => {
  const paths = [
    "/",
    "/waiting",
    "/waiting/q_prop_1",
    "/brains",
    "/brains/c_bid",
    "/brains/c_bid/access",
    "/brains/c_bid/pages/bid-playbook",
    "/settings/agents",
    "/search?q=bid",
  ];
  for (const [label, w] of [
    ["1280", 1280],
    ["400", 400],
  ] as const) {
    test(`axe and no horizontal scroll at ${label}`, async ({ browser }) => {
      const page = await as(browser, "head_bid", { w, h: 860 });
      for (const p of paths) {
        await page.goto(p);
        await settle(page);
        await axe(page, `${p} at ${label}`);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(over, `horizontal overflow on ${p} at ${label}`).toBeLessThanOrEqual(1);
        if (w === 400 && p === "/brains/c_bid") await shot(page, "brain-400");
      }
      await page.context().close();
    });
  }

  test("French", async ({ browser }) => {
    const page = await as(browser, "head_bid", { lang: "fr" });
    await page.goto("/");
    await settle(page);
    await expect(side(page).getByText("À traiter")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bonjour Sam" })).toBeVisible();
    await page.goto("/waiting/q_prop_1");
    await settle(page);
    await expect(page.getByText("Changement 1 sur 3").first()).toBeVisible();
    await shot(page, "proposal-fr");
    await axe(page, "proposal fr");
    await page.context().close();
  });

  test("on a phone the sidebar is a sheet", async ({ browser }) => {
    const page = await as(browser, "head_bid", { w: 400 });
    await page.goto("/");
    await settle(page);
    await expect(side(page)).not.toBeInViewport();
    await page.getByRole("button", { name: "Open the sidebar" }).click();
    await expect(side(page)).toBeInViewport();
    await side(page).getByRole("link", { name: "Waiting for you" }).click();
    await expect(page).toHaveURL(/\/waiting/);
    await expect(side(page)).not.toBeInViewport();
    await page.context().close();
  });
});

test.describe("removed from the product", () => {
  test("no Studio, Digest, Map, Today, Governances, Review or Routines route remains", async ({
    browser,
  }) => {
    const page = await as(browser, "ceo");
    for (const p of [
      "/map",
      "/today",
      "/governances",
      "/review",
      "/routines",
      "/studio",
      "/digest",
      "/lp",
    ]) {
      await page.goto(p);
      await expect(page.getByText("Page not found"), p).toBeVisible();
    }
    for (const n of ["Studio", "Digest", "Map", "Today", "Governances", "Routines"])
      await expect(side(page).getByRole("link", { name: n, exact: true }), n).toHaveCount(0);
    await page.context().close();
  });
});
