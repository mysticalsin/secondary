// Secondary v8 against the real local stack: a proposal reaches the Review desk, approve stays disabled
// until every change is seen (and the server refuses without proof), reassign and snooze answer for real,
// an unknown Ask becomes a gap on the brain's Gaps tab, Start page puts a draft into review, and a
// question with personal data leaves no gap. Screenshots land in e2e/screens/v8-real-*.png.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { api, asPersona } from "./helpers.ts";

const SCREENS = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const STAMP = Date.now().toString(36);
const TITLE = `V8 real ${STAMP}`;
const GAP = `zorblatic ${STAMP} escalation grid`;

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
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SCREENS}v8-real-${name}.png`, fullPage: true });

test.describe.configure({ mode: "serial" });

let proposalId = "";

test.describe("Review desk on the real API", () => {
  test("a proposal shows with its score, approve waits for every change, the server agrees", async ({
    browser,
  }) => {
    const author = await asPersona(browser, "head_bid");
    const made = await api(author, "head_bid", "/v1/wiki/c_bid/propose", {
      body: {
        title: TITLE,
        markdown: `# ${TITLE}\n\n## Summary\n- Qualify within two days.\n- Record the reason for every no-go.\n`,
      },
    });
    expect(made.status).toBe(201);
    proposalId = made.json.proposalId;
    await author.context().close();

    const page = await asPersona(browser, "reviewer");
    await page.goto(`/review/${encodeURIComponent(proposalId)}`);
    await settle(page);
    await expect(
      page
        .getByRole("heading", { name: TITLE, level: 2 })
        .or(page.getByRole("heading", { name: TITLE, level: 1 }))
        .first(),
    ).toBeVisible();
    await expect(page.getByTestId("rv-approve")).toBeDisabled();
    await shot(page, "desk");
    await axe(page, "desk (real)");

    const desk = await api(page, "reviewer", "/v1/review-desk");
    const row = [...desk.json.sections.decision, ...desk.json.sections.contradictions].find(
      (x: { id: string }) => x.id === proposalId,
    );
    expect(row.summary.source).toBe("rules");
    const bare = await api(page, "reviewer", `/v1/questions/${encodeURIComponent(proposalId)}`, {
      body: { action: "approve", revisionHash: "0".repeat(64) },
    });
    expect([400, 409]).toContain(bare.status);
    await page.context().close();
  });

  test("snooze, reassign and comments answer for real", async ({ browser }) => {
    const page = await asPersona(browser, "reviewer");
    const id = encodeURIComponent(proposalId);
    const detail = await api(page, "reviewer", `/v1/review-desk/${id}`);
    expect(detail.status).toBe(200);
    const bad = await api(page, "reviewer", `/v1/review-desk/${id}/reassign`, {
      body: { to: "u_consultant" },
    });
    expect(bad.status).toBe(403);
    const warn = await api(page, "reviewer", `/v1/review-desk/${id}/comments`, {
      body: { text: "Call +1 514 555 0199 first" },
    });
    expect(warn.status).toBe(409);
    expect(warn.json.error).toBe("personal_data_warning");
    const snooze = await api(page, "reviewer", `/v1/review-desk/${id}/snooze`, {
      body: { until: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(snooze.status).toBe(200);
    await page.goto("/review");
    await settle(page);
    await expect(page.getByText("Snoozed").first()).toBeVisible();
    await api(page, "reviewer", `/v1/review-desk/${id}/snooze`, { body: { until: null } });
    await page.context().close();
  });
});

test.describe("Gaps on the real API", () => {
  test("an Ask the brain cannot answer is a gap, Start page sends a draft to review", async ({
    browser,
  }) => {
    const page = await asPersona(browser, "head_bid");
    const ask = await page.request.fetch("/v1/ask", {
      method: "POST",
      headers: { "X-Demo-Persona": "head_bid", "Content-Type": "application/json" },
      data: JSON.stringify({ q: GAP, scope: "c_bid" }),
    });
    expect(ask.status()).toBe(200);
    await ask.text();
    // Personal data leaves nothing behind.
    const pd = await page.request.fetch("/v1/ask", {
      method: "POST",
      headers: { "X-Demo-Persona": "head_bid", "Content-Type": "application/json" },
      data: JSON.stringify({
        q: `Why was jane@example.invalid ${STAMP}pd refused`,
        scope: "c_bid",
      }),
    });
    await pd.text();
    const list = await api(page, "head_bid", "/v1/brains/c_bid/gaps");
    expect(list.json.gaps.some((g: { text: string }) => g.text.includes(`${STAMP}pd`))).toBe(false);

    await page.goto("/brains/c_bid?tab=gaps");
    await settle(page);
    const row = page.getByTestId("gap-row").filter({ hasText: STAMP });
    await expect(row).toBeVisible();
    await shot(page, "gaps");
    await axe(page, "gaps (real)");
    await row.getByRole("button", { name: /^Start page:/ }).click();
    const dlg = page.getByRole("dialog", { name: "Start a page from this gap" });
    await dlg.getByRole("button", { name: "Send draft to review" }).click();
    await expect(page.getByText("Draft sent to review")).toBeVisible();
    await expect(row).toContainText("Draft in review");
    await page.context().close();

    // Another reviewer finds the draft on the desk.
    const rev = await asPersona(browser, "reviewer");
    const desk = await api(rev, "reviewer", "/v1/review-desk");
    const titles = desk.json.sections.decision.map((x: { title: string }) => x.title).join("|");
    expect(titles).toContain(STAMP);
    await rev.context().close();
  });
});
