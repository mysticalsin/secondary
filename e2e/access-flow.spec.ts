// The access-request loop against the real stack: a person asks for a locked space from its drawer,
// a steward approves in the console, and the person then sees the space. Also the review inbox.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { api, asPersona } from "./helpers.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe on ${label}`,
  ).toEqual([]);
}

const STAMP = Date.now().toString(36);

test.describe("access request loop", () => {
  test("drawer request, steward approval, the requester sees the space; review notices reach the bell", async ({
    browser,
  }) => {
    const me = await asPersona(browser, "consultant");
    await me.goto("/");
    await me.waitForLoadState("networkidle");
    const map = await api(me, "consultant", "/v1/map?lens=departments");
    const locked = map.json.hubs.find((h: { access: string }) => h.access === "locked");
    expect(locked, "the consultant has a locked department").toBeTruthy();
    expect((await api(me, "consultant", `/v1/nodes/${locked.id}`)).json.node.access).toBe("locked");

    // The drawer: "Request access" opens the governance request form, not a bare action.
    await me.keyboard.press("Control+k");
    await expect(me.getByRole("dialog", { name: "Search and jump" })).toBeVisible();
    await me.getByRole("combobox", { name: "Search" }).fill(locked.label);
    await me
      .getByRole("option")
      .filter({ hasText: locked.label })
      .filter({ hasText: /^.*department$/i })
      .first()
      .click();
    await me.getByRole("button", { name: "Request access" }).click();
    await expect(me.getByLabel(/Why do you need it/)).toBeVisible();
    await axe(me, "drawer request form");
    await me.getByLabel(/Why do you need it/).fill(`Support the quarter close ${STAMP}`);
    await me.getByRole("button", { name: "Send request" }).click();
    await expect(me.getByText("Request sent to the steward queue.").first()).toBeVisible();

    // The steward sees it and approves.
    const admin = await asPersona(browser, "platform_admin");
    await admin.goto("/admin?tab=requests");
    await expect(admin.getByText(`Support the quarter close ${STAMP}`)).toBeVisible();
    await axe(admin, "admin requests");
    await admin
      .getByRole("listitem")
      .filter({ hasText: `Support the quarter close ${STAMP}` })
      .getByRole("button", { name: "Approve" })
      .click();

    // The approval is real: the same person now sees the space.
    await expect
      .poll(async () => (await api(me, "consultant", `/v1/nodes/${locked.id}`)).json.node.access)
      .toBe("full");

    // A contribution reaches the reviewer's bell without any content in the notice.
    // Each persona has its own address on the local stack, so the validation names this one.
    const mine = (await api(me, "consultant", "/v1/me")).json.principal.email as string;
    const made = await api(me, "consultant", "/v1/actions", {
      body: {
        nodeId: "c_delivery",
        action: "contribute",
        payload: {
          title: "Runbook for handover",
          body: "Step one",
          user_validated: { by: mine, at: new Date().toISOString(), revision: 1 },
        },
      },
    });
    expect(made.status).toBe(201);
    const reviewer = await asPersona(browser, "reviewer");
    await reviewer.goto("/today");
    await reviewer.getByRole("button", { name: /Notifications/ }).click();
    await expect(reviewer.getByText(/waiting for review/).first()).toBeVisible();
    await expect(reviewer.getByText("Runbook for handover")).toHaveCount(0);
    await me.context().close();
    await admin.context().close();
    await reviewer.context().close();
  });
});
