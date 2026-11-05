import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { api, asPersona, shot } from "./helpers.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
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

test.describe.configure({ mode: "serial" });

test.describe("Living Wiki: ingest, review, page", () => {
  test("a recorded meeting becomes a cited diff, a person approves it, and the page appears", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "acme_lead");
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await expect(page.getByText("No wiki pages yet")).toBeVisible();
    await page.getByRole("button", { name: "Record a meeting" }).click();
    await page.getByLabel("Meeting title").fill("Steering committee");
    await page.getByLabel("Date", { exact: true }).fill("2026-11-03");
    await page.getByLabel("Decisions, one per line").fill("Adopt fixed fee for phase 2");
    await page
      .getByLabel(/Commitments, one per line/)
      .fill("Send revised proposal | Bid manager | 2026-11-12");
    await page.getByLabel(/Risks, one per line/).fill("Budget approval slips | high");
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(
      page.getByText("Meeting saved. The wiki drafted its changes for review."),
    ).toBeVisible();

    // Nothing is published yet.
    await expect(page.getByText("No wiki pages yet")).toBeVisible();

    // The diff is in the Review queue, with its kind, and every added line names its source.
    await page.goto("/review");
    await settle(page);
    const item = page.getByRole("button", { name: /Ingest: Steering committee/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole("group", { name: "Changes to Decision log" })).toContainText(
      "Adopt fixed fee for phase 2",
    );
    await expect(page.getByText(/Proposed by Wiki agent/)).toBeVisible();
    await page.screenshot({ path: shot("wiki-review"), fullPage: true });
    await axe(page, "wiki review");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved. The wiki is updated.")).toBeVisible();

    // The page is visible, with its citation resolving to the meeting.
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page
      .getByRole("button", { name: /Decision log/ })
      .first()
      .click();
    const art = page.getByRole("article");
    await expect(art).toContainText("Adopt fixed fee for phase 2");
    await expect(art.getByRole("link", { name: /Source 1: Steering committee/ })).toBeVisible();
    await expect(art.getByRole("list", { name: "Sources" })).toContainText("Steering committee");
    await page.screenshot({ path: shot("wiki-page"), fullPage: true });
    await axe(page, "wiki page");

    // History, facts over time and the log.
    await art.getByRole("button", { name: "Page history" }).click();
    await expect(art.getByRole("group", { name: /Changes to r1/ })).toBeVisible();
    await page.getByRole("tab", { name: "Facts over time" }).click();
    await expect(
      page.getByRole("cell", { name: /Adopt fixed fee for phase 2/ }).first(),
    ).toBeVisible();
    await axe(page, "wiki facts");
    await page.getByRole("tab", { name: "Log" }).click();
    await expect(page.getByText("wiki_ingest.applied")).toBeVisible();
    await page.context().close();
  });

  test("a changed decision ends the old fact and the timeline keeps both", async ({ browser }) => {
    const page = await asPersona(browser, "acme_lead");
    const mtg = await api(page, "acme_lead", "/v1/wiki/a_acme/meetings", {
      body: {
        title: "Follow-up",
        date: "2026-11-10",
        decisions: [{ title: "Adopt fixed fee for phase 2", status: "reversed" }],
      },
    });
    expect(mtg.status).toBe(201);
    const run = await api(page, "acme_lead", "/v1/wiki/a_acme/run", { body: {} });
    const id = run.json.results.find((r: { triage: string }) => r.triage === "proposed").id;
    expect(
      (
        await api(page, "acme_lead", `/v1/wiki/a_acme/proposals/${encodeURIComponent(id)}/decide`, {
          body: { decision: "approve" },
        })
      ).status,
    ).toBe(200);
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.getByRole("tab", { name: "Facts over time" }).click();
    const rows = page.getByRole("row", { name: /Adopt fixed fee for phase 2/ });
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("Ended").first()).toBeVisible();
    await page.context().close();
  });

  test("lint and dreaming file review items, and the map shows the wiki health signal", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "head_bid");
    for (const [title, markdown] of [
      [
        "Fixed fee pricing playbook",
        "# Fixed fee pricing playbook\n\n## Summary\n- Quote a fixed fee when scope is stable\n",
      ],
      [
        "Fixed fee pricing playbook guide",
        "# Guide\n\n## Summary\n- Add a buffer to every quote\n",
      ],
    ]) {
      const p = await api(page, "head_bid", "/v1/wiki/c_bid/propose", {
        body: { title, markdown },
      });
      expect(p.status).toBe(201);
      const rev = await asPersona(browser, "reviewer");
      await api(
        rev,
        "reviewer",
        `/v1/wiki/c_bid/proposals/${encodeURIComponent(p.json.proposalId)}/decide`,
        { body: { decision: "approve" } },
      );
      await rev.context().close();
    }
    const run = await api(page, "head_bid", "/v1/wiki/c_bid/run", {
      body: { jobs: ["lint", "dream"] },
    });
    expect(run.status).toBe(200);
    const kinds = (await api(page, "head_bid", "/v1/review")).json.map(
      (r: { kind?: string }) => r.kind,
    );
    expect(kinds).toEqual(expect.arrayContaining(["wiki_lint", "wiki_dream"]));

    await page.goto("/wiki/c_bid");
    await settle(page);
    await expect(page.getByText(/Wiki health \d+ of 100/)).toBeVisible();
    await page.getByRole("tab", { name: /Review/ }).click();
    await expect(page.getByRole("button", { name: /Merge/ })).toBeVisible();
    await axe(page, "wiki circle review");

    await page.goto("/map");
    await settle(page);
    await expect(page.locator('[aria-label*="Wiki health"]').first()).toBeAttached();
    await page.context().close();
  });

  test("My Secondary has its own wiki, and nobody else can open it", async ({ browser }) => {
    const page = await asPersona(browser, "consultant");
    await page.goto("/personal");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await expect(page.getByText("Your own wiki. Only you can see it.")).toBeVisible();
    await axe(page, "personal wiki");
    for (const who of ["ceo", "platform_admin", "auditor"]) {
      const r = await api(page, who, "/v1/wiki/pb:u_consultant/index");
      expect(r.status, who).toBe(404);
    }
    await page.context().close();
  });

  test("the wiki reads in French", async ({ browser }) => {
    const page = await asPersona(browser, "acme_lead", { locale: "fr-CA" });
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await expect(page.getByRole("button", { name: "Enregistrer une réunion" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Faits dans le temps" })).toBeVisible();
    await page.context().close();
  });

  test("the wiki tab fits a phone", async ({ browser }) => {
    const page = await asPersona(browser, "acme_lead", { width: 400, height: 860 });
    await page.goto("/accounts/a_acme");
    await page.getByRole("tab", { name: "Wiki" }).click();
    await settle(page);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    await axe(page, "wiki 400");
    await page.context().close();
  });
});
