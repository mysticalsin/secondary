import { expect, test } from "@playwright/test";
import { api, asPersona, shot } from "./helpers.ts";

test.describe("web app against the real API", () => {
  test("Today renders for the CEO", async ({ browser }) => {
    const page = await asPersona(browser, "ceo");
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you can see and do" })).toBeVisible();
    await expect(page.getByText("Full: Company Global")).toBeVisible();
    await expect(page.getByText("Env DEV")).toBeVisible();
    await expect(page.getByText(/Signed in as/)).toContainText("CEO");
    await expect(page.getByText("Mock data")).toHaveCount(0);
    await page.screenshot({ path: shot("today-ceo") });
  });

  test("switching persona to Head of Bid shows locked departments", async ({ browser }) => {
    const page = await asPersona(browser, "ceo");
    await page.goto("/map?view=list");
    await expect(page.getByText(/nodes in your view/)).toBeVisible();
    // The CEO has every department open.
    await expect(page.getByText("Locked", { exact: true })).toHaveCount(0);
    await page.getByLabel("Demo persona (dev only)").selectOption("head_bid");
    await expect(page.getByText(/Signed in as/)).toContainText("Head of Bid");
    await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();
    expect(await page.getByText("Locked", { exact: true }).count()).toBeGreaterThan(0);
  });

  test("Platform admin sees structure only", async ({ browser }) => {
    const page = await asPersona(browser, "platform_admin");
    await page.goto("/admin");
    // The governance console: the admin holds configure, so Roles opens first.
    await expect(page.getByRole("tab", { name: "Roles", selected: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roles and grants" })).toBeVisible();
    await expect(page.locator("table").getByText(/^CEO/).first()).toBeVisible();
    // Counts are hidden on the map for this role.
    const me = await api(page, "platform_admin", "/v1/map?lens=departments");
    expect(me.status).toBe(200);
    expect(me.json.hubs.every((h: { counts: unknown }) => h.counts === null)).toBe(true);
  });

  test("account workspace: Acme lead has the Contacts tab, the CEO does not", async ({
    browser,
  }) => {
    const lead = await asPersona(browser, "acme_lead");
    await lead.goto("/accounts/a_acme");
    await expect(lead.getByRole("heading", { name: "Acme Synthetic SA" })).toBeVisible();
    await expect(lead.getByRole("tab", { name: "Contacts" })).toBeVisible();
    const ceo = await asPersona(browser, "ceo");
    await ceo.goto("/accounts/a_acme");
    await expect(ceo.getByRole("heading", { name: "Acme Synthetic SA" })).toBeVisible();
    await expect(ceo.getByRole("tab", { name: "Engagements" })).toBeVisible();
    await expect(ceo.getByRole("tab", { name: "Contacts" })).toHaveCount(0);
  });

  test("an NDA account is absent for the CEO without a grant", async ({ browser }) => {
    const ceo = await asPersona(browser, "ceo");
    await ceo.goto("/accounts");
    await expect(ceo.getByRole("heading", { name: "Acme Synthetic SA" })).toBeVisible();
    await expect(ceo.getByText("Calypso Demo Srl")).toHaveCount(0);
    expect((await api(ceo, "ceo", "/v1/accounts/a_calypso")).status).toBe(404);
    // Search does not leak it either.
    const hits = await api(ceo, "ceo", "/v1/search?q=calypso");
    expect(JSON.stringify(hits.json)).not.toMatch(/calypso/i);
  });

  test("Personal Brain: create a note, contribute shows the sensitivity sheet and needs confirmation", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "head_bid");
    await page.goto("/personal?new=1");
    await page.getByLabel("Title").fill("Renewal pricing lessons");
    await page
      .getByLabel("Body")
      .fill("Lead with run-cost savings. Contact: pat.sample@example.invalid");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved \w{3} \d/)).toBeVisible();

    await page.getByRole("button", { name: /Contribute to Company/ }).click();
    const sheet = page.getByRole("dialog", { name: "Contribute to Company" });
    await expect(sheet).toBeVisible();
    // The server's flags, shown before anything is sent.
    await expect(sheet.getByText("pat.sample@example.invalid")).toBeVisible();
    await expect(sheet.getByText("Email address")).toBeVisible();
    const send = sheet.getByRole("button", { name: "Send for review" });
    await expect(send).toBeDisabled();
    await sheet.getByLabel("Company scope").selectOption({ label: "Circle: Bid & Pre-sales" });
    await expect(send).toBeDisabled(); // still needs the confirmation
    await sheet.getByRole("checkbox").check();
    await expect(send).toBeEnabled();
    await page.screenshot({ path: shot("contribute-sheet") });
    await send.click();
    await expect(page.getByText(/Sent to review in Bid & Pre-sales/)).toBeVisible();
  });

  test("Review: a steward cannot approve their own contribution, another reviewer can", async ({
    browser,
  }) => {
    const steward = await asPersona(browser, "head_bid");
    // Make a candidate as the Head of Bid (a steward of the Bid circle).
    const note = await api(steward, "head_bid", "/v1/personal/items", {
      body: { title: "Bid playbook update", body: "Use the rate card bands.", kind: "note" },
    });
    expect(note.status).toBe(201);
    const contributed = await api(
      steward,
      "head_bid",
      `/v1/personal/items/${note.json.id}/contribute`,
      {
        body: {
          targetScopeId: "c_bid",
          user_validated: {
            by: (await api(steward, "head_bid", "/v1/me")).json.principal.id,
            at: new Date().toISOString(),
            revision: note.json.revision,
          },
          acknowledged_flags: [],
        },
      },
    );
    expect(contributed.status).toBe(201);
    const candidateId = contributed.json.candidateId as string;

    // The contributor's own queue does not carry it, and the server refuses a direct approval.
    await steward.goto("/review");
    await expect(steward.getByText("Bid playbook update")).toHaveCount(0);
    const self = await api(steward, "head_bid", "/v1/actions", {
      body: { nodeId: candidateId, action: "approve_release", revision: 1 },
    });
    expect(self.status).toBe(403);
    expect(self.json.reason).toMatch(/self-approval|wrote or edited/i);
    // The Knowledge reviewer sees it and approves the exact revision in the UI.
    const reviewer = await asPersona(browser, "reviewer");
    await reviewer.goto("/review");
    await reviewer.getByRole("button", { name: /Bid playbook update/ }).click();
    await expect(reviewer.getByText("Exact revision r1.")).toBeVisible();
    await reviewer.screenshot({ path: shot("review") });
    await reviewer.getByRole("button", { name: "Approve r1" }).click();
    await expect(reviewer.getByText(/Approved r1/)).toBeVisible();
  });

  test("the Map ring labels are legible and the ring fills the panel", async ({ browser }) => {
    const page = await asPersona(browser, "ceo");
    await page.goto("/map?view=ring");
    const box = page.locator(".mapbox");
    await expect(box).toBeVisible();
    await expect(box.locator("svg text.svg-label").first()).toBeVisible();
    const m = await page.evaluate(() => {
      const root = document.querySelector(".mapbox") as HTMLElement;
      const svg = root.querySelector("svg") as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      const scale = Math.min(svg.clientWidth / vb.width, svg.clientHeight / vb.height);
      const sizes = [...svg.querySelectorAll("text.svg-label")]
        .filter((t) => (t.textContent ?? "").trim().length > 0)
        .map((t) => ({
          t: (t.textContent ?? "").trim().slice(0, 24),
          px:
            parseFloat(t.getAttribute("font-size") ?? "0") *
            scale *
            (parseFloat(getComputedStyle(t).fontSize) ? 1 : 1),
          bold: t.getAttribute("font-weight"),
        }));
      // Drawn content bounds vs the panel.
      const g = svg.querySelector(".zoomable") as SVGGraphicsElement;
      const b = g.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      return {
        sizes,
        fillW: b.width / r.width,
        fillH: b.height / r.height,
        panel: { w: r.width, h: r.height },
      };
    });
    const labels = m.sizes.filter((s) => s.t !== "");
    expect(labels.length).toBeGreaterThan(5);
    for (const s of labels) expect(s.px, s.t).toBeGreaterThanOrEqual(11.95);
    const hubs = labels.filter((s) => s.bold === "700");
    expect(hubs.length).toBeGreaterThan(0);
    for (const s of hubs) expect(s.px, s.t).toBeGreaterThanOrEqual(13.95);
    // The ring uses most of the panel on its tighter axis.
    expect(Math.max(m.fillW, m.fillH)).toBeGreaterThan(0.85);
    await page.screenshot({ path: shot("map-ring") });
    // Resize: it refits.
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const root = document.querySelector(".mapbox") as HTMLElement;
      const g = root.querySelector(".zoomable") as SVGGraphicsElement;
      const b = g.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      return Math.max(b.width / r.width, b.height / r.height);
    });
    expect(after).toBeGreaterThan(0.85);
  });
});
