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

/** Approve a wiki proposal as `persona`: read it, then name the revision that was read. */
async function approveVia(page: Page, persona: string, ws: string, id: string) {
  const path = `/v1/wiki/${ws}/proposals/${encodeURIComponent(id)}`;
  const read = await api(page, persona, path);
  expect(read.status).toBe(200);
  return api(page, persona, `${path}/decide`, {
    body: { decision: "approve", revisionHash: read.json.revisionHash },
  });
}

test.describe("Living Wiki: ingest, review, page", () => {
  test("a recorded meeting becomes a cited diff, a person approves it, and the page appears", async ({
    browser,
  }) => {
    // The person who records the meeting never approves what is drawn from it: a reviewer does.
    const page = await asPersona(browser, "head_bid");
    await page.goto("/wiki/c_bid");
    await settle(page);
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

    // The diff is in the reviewer's queue, with its kind, and every added line names its source.
    await page.context().close();
    const rev = await asPersona(browser, "reviewer");
    await rev.goto("/review");
    await settle(rev);
    const item = rev.getByRole("button", { name: /Ingest: Steering committee/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(rev.getByRole("group", { name: "Changes to Decision log" })).toContainText(
      "Adopt fixed fee for phase 2",
    );
    await expect(rev.getByText(/Proposed by Wiki agent/)).toBeVisible();
    await rev.screenshot({ path: shot("wiki-review"), fullPage: true });
    await axe(rev, "wiki review");
    await rev.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(rev.getByText("Approved. The wiki is updated.")).toBeVisible();

    // The page is visible, with its citation resolving to the meeting.
    await rev.goto("/wiki/c_bid");
    await settle(rev);
    await rev
      .getByRole("button", { name: /Decision log/ })
      .first()
      .click();
    const art = rev.getByRole("article");
    await expect(art).toContainText("Adopt fixed fee for phase 2");
    await expect(art.getByRole("link", { name: /Source 1: Steering committee/ })).toBeVisible();
    await expect(art.getByRole("list", { name: "Sources" })).toContainText("Steering committee");
    await rev.screenshot({ path: shot("wiki-page"), fullPage: true });
    await axe(rev, "wiki page");

    // History, facts over time and the log.
    await art.getByRole("button", { name: "Page history" }).click();
    await expect(art.getByRole("group", { name: /Changes to r1/ })).toBeVisible();
    await rev.getByRole("tab", { name: "Facts over time" }).click();
    await expect(
      rev.getByRole("cell", { name: /Adopt fixed fee for phase 2/ }).first(),
    ).toBeVisible();
    await axe(rev, "wiki facts");
    await rev.getByRole("tab", { name: "Log" }).click();
    await expect(rev.getByText("wiki_ingest.applied")).toBeVisible();
    await rev.context().close();
  });

  test("a changed decision ends the old fact and the timeline keeps both", async ({ browser }) => {
    const page = await asPersona(browser, "head_bid");
    const mtg = await api(page, "head_bid", "/v1/wiki/c_bid/meetings", {
      body: {
        title: "Follow-up",
        date: "2026-11-10",
        decisions: [{ title: "Adopt fixed fee for phase 2", status: "reversed" }],
      },
    });
    expect(mtg.status).toBe(201);
    const run = await api(page, "head_bid", "/v1/wiki/c_bid/run", { body: {} });
    const id = run.json.results.find((r: { triage: string }) => r.triage === "proposed").id;
    // A reviewer approves: the author of the meeting never decides what is drawn from it.
    expect((await approveVia(page, "reviewer", "c_bid", id)).status).toBe(200);
    await page.goto("/wiki/c_bid");
    await settle(page);
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
      expect((await approveVia(rev, "reviewer", "c_bid", p.json.proposalId)).status).toBe(200);
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
