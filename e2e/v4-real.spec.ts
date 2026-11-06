// Secondary v4 against the real local stack (`pnpm dev:all`): isolation in the sidebar, an MCP proposal that
// lands in the right brain's waiting list, the seen-changes rule, request access, axe and screenshots.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { api, asPersona } from "./helpers.ts";
import { getToken, rpc } from "./mcp-flow.ts";
import { MCP_URL } from "./ports.ts";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const STAMP = Date.now().toString(36);

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(bad, `axe on ${label}`).toEqual([]);
}
const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};
const shot = (page: Page, name: string, full = false) =>
  page.screenshot({ path: `${SCREENS}v4-real-${name}.png`, fullPage: full });
const side = (page: Page) => page.getByRole("complementary");

test.describe.configure({ mode: "serial" });

test.describe("isolation in the sidebar", () => {
  test("each persona sees the brains the policy admits, and no others", async ({ browser }) => {
    const ceo = await asPersona(browser, "ceo");
    await ceo.goto("/");
    await settle(ceo);
    for (const n of [
      "Bid & Pre-sales",
      "Sales",
      "Accounts",
      "Delivery",
      "Company Global",
      "All brains",
    ])
      await expect(side(ceo).getByText(n, { exact: true }).first(), n).toBeVisible();
    await shot(ceo, "home-ceo");
    await ceo.context().close();

    const bid = await asPersona(browser, "head_bid");
    await bid.goto("/");
    await settle(bid);
    await expect(side(bid).getByText("Bid & Pre-sales", { exact: true })).toBeVisible();
    await expect(side(bid).getByText("Accounts", { exact: true })).toBeVisible();
    await expect(side(bid).getByText("Sales", { exact: true })).toHaveCount(0);
    await expect(side(bid).getByText("Delivery", { exact: true })).toHaveCount(0);
    await bid.context().close();

    const cons = await asPersona(browser, "consultant");
    await cons.goto("/");
    await settle(cons);
    await expect(side(cons).getByText("Delivery", { exact: true })).toBeVisible();
    await expect(side(cons).getByText("Bid & Pre-sales", { exact: true })).toHaveCount(0);
    // A brain outside the view is not found, and the page says nothing about it.
    await cons.goto("/brains/c_bid");
    await expect(cons.getByRole("alert")).toBeVisible();
    await expect(cons.getByRole("heading", { name: "Bid & Pre-sales", level: 1 })).toHaveCount(0);
    await cons.context().close();

    const nav = await api(await asPersona(browser, "auditor"), "auditor", "/v1/brains/nav");
    expect(nav.json.items.map((i: { id: string }) => i.id)).toEqual(["me"]);
  });
});

test.describe("brain page and reading", () => {
  test("collections open in place and a page reads with its citations", async ({ browser }) => {
    const page = await asPersona(browser, "head_bid");
    await page.goto("/brains/c_bid");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Bid & Pre-sales", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Members and access" })).toBeVisible();
    const list = page.getByRole("list", { name: "Contents" });
    const first = list.getByRole("button", { name: /Open or close/ }).first();
    await first.click();
    const row = list.locator("li.page").first();
    await expect(row).toBeVisible();
    await shot(page, "brain");
    await axe(page, "brain page");
    await row.getByRole("link").first().click();
    await settle(page);
    await expect(page.getByRole("article")).toBeVisible();
    await shot(page, "page");
    await axe(page, "page");
    await page.context().close();
  });
});

test.describe("MCP push lands in the right brain, and is read change by change", () => {
  const title = `Session report ${STAMP}`;
  let proposalId = "";

  test("an agent proposes a page through MCP into Bid and Pre-sales", async ({ browser }) => {
    const token = await getToken(MCP_URL, "head_bid", `agent.${STAMP}@example.invalid`);
    await rpc(MCP_URL, token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scripted-host", version: "1" },
    });
    const call = (name: string, args: object) =>
      rpc(MCP_URL, token, "tools/call", { name, arguments: args });
    const brains = await call("list_brains", {});
    const text = JSON.stringify(brains.structuredContent ?? brains.content);
    expect(text).toContain("c_bid");
    expect(text).not.toContain("c_sales");
    const made = await call("propose_page", {
      brainId: "c_bid",
      title,
      markdown: `# ${title}\n\n- Qualified two tenders\n- Reviewed the pricing guide\n`,
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    const out =
      made.structuredContent?.result ?? made.structuredContent ?? JSON.parse(made.content[0].text);
    proposalId = out.proposalId;
    expect(proposalId).toBeTruthy();
    // A session report goes to Sources > Session reports > <person>.
    const rep = await call("write_session_report", {
      brainId: "c_bid",
      markdown: `Worked on ${STAMP}`,
    });
    expect(rep.isError, JSON.stringify(rep.content)).toBeFalsy();
    // Nothing is published: no direct publishing from an agent in a shared brain.
    const admin = await asPersona(browser, "head_bid");
    const idx = await api(admin, "head_bid", "/v1/wiki/c_bid/index");
    expect(idx.json.pages.some((p: { title: string }) => p.title === title)).toBe(false);
    // The proposal is in that brain's waiting list and in no other brain's.
    const rev = await api(admin, "reviewer", "/v1/questions");
    const mine = rev.json.filter((q: { id: string }) => q.id === proposalId);
    expect(mine).toHaveLength(1);
    expect(mine[0].workspaceId).toBe("c_bid");
    const cons = await api(admin, "consultant", "/v1/questions");
    expect(cons.json.some((q: { id: string }) => q.id === proposalId)).toBe(false);
    await admin.context().close();
  });

  test("the reviewer cannot approve before every change is seen, and approves after", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "reviewer");
    await page.goto("/waiting");
    await settle(page);
    const group = page.getByRole("region", { name: "Bid & Pre-sales" });
    await expect(group.getByRole("heading", { name: title })).toBeVisible();
    await shot(page, "waiting");
    await axe(page, "waiting");
    await group.getByRole("link", { name: new RegExp(`Review.*${title}`) }).click();
    await settle(page);
    const approve = page.getByRole("button", { name: /^Approve/ });
    await expect(page.getByText(/Seen \d of \d changes/)).toBeVisible();
    await shot(page, "proposal");
    await axe(page, "proposal");
    // The server enforces it too: an approval with no acknowledgement is refused.
    const bare = await api(page, "reviewer", `/v1/questions/${proposalId}`, {
      body: { action: "approve", revisionHash: "0".repeat(64) },
    });
    expect([400, 409]).toContain(bare.status);
    for (let guard = 0; guard < 12 && (await approve.isDisabled()); guard++) {
      const next = page.getByRole("button", { name: /Mark as seen/ }).first();
      if (await next.count()) await next.click();
    }
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page).toHaveURL(/\/waiting$/);
    await page.goto("/brains/c_bid");
    await settle(page);
    await page.getByLabel("Filter by title, summary or tag").fill(STAMP);
    await expect(
      page.getByRole("list", { name: "Contents" }).getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
    await page.context().close();
  });
});

test.describe("request access", () => {
  test("ask from All brains, a steward approves in Settings, the person sees the brain", async ({
    browser,
  }) => {
    const me = await asPersona(browser, "consultant");
    const dir = await api(me, "consultant", "/v1/brains?scope=all");
    const closed = dir.json.brains.find(
      (b: { canOpen: boolean; canRequestAccess: boolean }) => !b.canOpen && b.canRequestAccess,
    );
    expect(closed, "the consultant can see a brain they cannot open").toBeTruthy();
    await me.goto("/brains");
    await settle(me);
    const row = me.getByRole("listitem").filter({ hasText: closed.name }).first();
    await expect(row).toContainText("You cannot open it yet");
    await row.getByRole("button", { name: /Request access/ }).click();
    await me.getByLabel("Why do you need it?").fill(`Support the quarter close ${STAMP}`);
    await axe(me, "request access dialog");
    await me.getByRole("button", { name: "Send request" }).click();
    await expect(me.getByText("Request sent to the people who manage it.")).toBeVisible();
    await shot(me, "all-brains");

    const admin = await asPersona(browser, "platform_admin");
    await admin.goto("/settings/members?tab=requests");
    await settle(admin);
    await expect(admin.getByText(`Support the quarter close ${STAMP}`)).toBeVisible();
    await shot(admin, "settings-members");
    await axe(admin, "settings members");
    await admin
      .getByRole("listitem")
      .filter({ hasText: `Support the quarter close ${STAMP}` })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect
      .poll(async () => {
        const d = await api(me, "consultant", "/v1/brains?scope=all");
        return d.json.brains.find((b: { id: string }) => b.id === closed.id)?.canOpen;
      })
      .toBe(true);
    await me.context().close();
    await admin.context().close();
  });
});

test.describe("settings and the rest, on real data", () => {
  test("agents: the exact command with the MCP URL, copy, and the live status", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "head_bid");
    await page.goto("/settings/agents");
    await settle(page);
    await expect(
      page.getByText(
        new RegExp(
          `claude mcp add --transport http .* ${MCP_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/mcp`,
        ),
      ),
    ).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: /Copy/ }).first().click();
    await expect(page.getByText("Copied").first()).toBeVisible();
    await shot(page, "settings-agents");
    await axe(page, "settings agents");
    await page.context().close();
  });

  for (const [label, w] of [
    ["1280", 1280],
    ["400", 400],
  ] as const) {
    test(`axe and no horizontal scroll at ${label}`, async ({ browser }) => {
      const page = await asPersona(browser, "head_bid", { width: w, height: 860 });
      for (const p of [
        "/",
        "/waiting",
        "/brains",
        "/brains/c_bid",
        "/brains/c_bid/access",
        "/settings/profile",
        "/settings/appearance",
        "/search?q=bid",
      ]) {
        await page.goto(p);
        await settle(page);
        await axe(page, `${p} at ${label}`);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(over, `horizontal overflow on ${p} at ${label}`).toBeLessThanOrEqual(1);
      }
      await page.context().close();
    });
  }

  test("French and dark", async ({ browser }) => {
    const page = await asPersona(browser, "head_bid", { locale: "fr-CA" });
    await page.goto("/");
    await settle(page);
    await expect(side(page).getByText("À traiter")).toBeVisible();
    await axe(page, "home fr");
    await page.goto("/settings/appearance");
    await settle(page);
    await page.getByLabel("Sombre").check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await axe(page, "appearance dark fr");
    await shot(page, "settings-dark-fr");
    await page.context().close();
  });
});
