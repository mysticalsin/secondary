// Landing Page Studio against the real stack: the web app, the real API, a real Durable Object store, the
// real pages worker and one shared local bucket (scripts/dev-all.mjs). Compose in French, edit in the
// preview, check, submit, approve as another person, publish, then open the public page in a browser and
// check what only a browser enforces: the CSP (by hash), the styles it allows, the consent that declines by
// default, the counts that start only after "Accept".

import { expect, type Page, test } from "@playwright/test";
import { api, asPersona, shot } from "./helpers.ts";
import { PAGES_URL } from "./ports.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status").filter({ hasText: /^Loading$/ })).toHaveCount(0);
};

let pageId = "";
let publicPath = "";

test("compose in French, edit in the preview, check, submit, review, approve, publish", async ({
  browser,
}) => {
  const page = await asPersona(browser, "ceo");
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto("/studio");
  await settle(page);
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Prospect first name (optional)").fill("Claire");
  await page.getByLabel("Prospect role").fill("CFO");
  await page.getByLabel("Company").fill("Contoso");
  await page.getByLabel("Angle").fill("Supply chain visibility");
  await page.getByLabel("Page language").selectOption("fr");
  await page.getByRole("button", { name: "Compose" }).click();
  await expect(page).toHaveURL(/\/studio\/lp\/lp_[0-9a-f]{16}$/, { timeout: 20_000 });
  pageId = /\/(lp_[0-9a-f]{16})$/.exec(page.url())?.[1] as string;
  await settle(page);

  // The preview is a frame of the app: its styles must survive the app's strict CSP (no inline style).
  const frame = page.frameLocator('iframe[title="Page preview"]');
  await expect(frame.locator("h1")).toBeVisible();
  const hero = (await frame.locator("h1").textContent()) as string;
  // One language, all of it: nothing of the English angle, nothing English around it.
  expect(hero).not.toMatch(/supply chain|visibility/i);
  const body = (await frame.locator("body").textContent()) as string;
  expect(body).toContain("Bonjour Claire.");
  expect(body).not.toMatch(/\b(Hello|Here is what|See related work|Write to)\b/);
  const bandBg = await frame
    .locator(".band")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bandBg, "the template's CSS reached the preview").toContain("linear-gradient");
  await page.screenshot({ path: shot("lp-real-editor") });

  // Edit the headline in place; it saves through the API.
  await frame.getByRole("button", { name: /Edit Headline/ }).click();
  const box = frame.getByRole("textbox", { name: "Headline" });
  await box.fill("Une visibilité de bout en bout pour Contoso.");
  await box.press("Enter");
  await expect(page.getByTestId("save-state")).toContainText("All changes saved");
  const saved = await api(page, "ceo", `/v1/lp/${pageId}`);
  expect(saved.json.slots.hero).toBe("Une visibilité de bout en bout pour Contoso.");
  expect(saved.json.lang).toBe("fr");

  // The checks run on the server; a name of another client blocks, and its one-click fix works.
  const bad = await api(page, "ceo", `/v1/lp/${pageId}`, {
    method: "PUT",
    body: {
      slots: {
        ...saved.json.slots,
        whyUs: "Nous l'avons fait pour Acme Synthetic SA l'an dernier.",
      },
      references: saved.json.references.map((r: { pageId: string }) => ({ pageId: r.pageId })),
      contact: saved.json.contact,
      revision: saved.json.revision,
    },
  });
  expect(bad.status).toBe(200);
  await page.reload();
  await settle(page);
  await page.getByRole("button", { name: /^Checks/ }).click();
  await expect(page.getByText(/Names a client/)).toBeVisible();
  await page.getByRole("button", { name: /Say it without the name/ }).click();
  await expect(page.getByText("All checks pass. This page can go to review.")).toBeVisible();
  const fixed = await api(page, "ceo", `/v1/lp/${pageId}`);
  expect(fixed.json.slots.whyUs).not.toMatch(/Acme/);
  expect(fixed.json.slots.whyUs).toContain("le client");

  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("waiting for a reviewer")).toBeVisible();
  await page.context().close();

  // Another person reads the page as the visitor sees it, with what changed, and approves that revision.
  const rev = await asPersona(browser, "reviewer");
  await rev.goto("/questions");
  await settle(rev);
  await rev.getByRole("button", { name: /Approvals/ }).click();
  const q = rev.getByRole("article", { name: /Landing page: CFO at Contoso/ });
  await expect(q.getByTestId("lp-review")).toBeVisible();
  await expect(q.frameLocator("iframe").locator("h1")).toContainText("Contoso");
  const reviewBg = await q
    .frameLocator("iframe")
    .locator(".band")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(reviewBg).toContain("linear-gradient");
  await rev.screenshot({ path: shot("lp-real-review") });
  await q.getByRole("button", { name: "Approve page" }).click();
  await expect(q).toHaveCount(0);
  await rev.context().close();

  // The author publishes. The address is the public host; the page itself is served by the local pages worker.
  const author = await asPersona(browser, "ceo");
  await author.goto(`/studio/lp/${pageId}`);
  await settle(author);
  await expect(author.getByText("Approved. Editing is locked.")).toBeVisible();
  await author.getByRole("button", { name: "Publish page" }).click();
  const link = author.getByLabel("Page link");
  await expect(link).toHaveValue(/\/p\/[0-9a-f]{32}$/);
  publicPath = new URL(await link.inputValue()).pathname;
  await author.screenshot({ path: shot("lp-real-published") });
  await author.context().close();
  expect(consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
});

test("the public page: CSP by hash, styles apply, consent declines by default, counts only after Accept", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const beacons: { url: string; body: string }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/e$/.test(r.url()))
      beacons.push({ url: r.url(), body: r.postData() ?? "" });
  });
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!/^(data:|blob:)/.test(r.url()) && u.origin !== new URL(PAGES_URL).origin)
      external.push(r.url());
  });

  const res = await page.goto(`${PAGES_URL}${publicPath}`);
  expect(res?.status()).toBe(200);
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
  expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  expect(csp).toContain("img-src 'self'");
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https:|\*/);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("h1")).toContainText("Contoso");

  // The hashed style was accepted: the band has its gradient, the type is the brand's.
  const bg = await page
    .locator(".band")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("linear-gradient");
  await expect(page.locator("body")).toContainText("Bonjour Claire.");
  await expect(page.locator("body")).not.toContainText(/Hello|Write to|See related work/);

  // Consent: the banner shows, "Refuser" comes first, nothing is counted before a choice.
  const banner = page.locator("#consent");
  await expect(banner).toBeVisible();
  const buttons = await banner.getByRole("button").allTextContents();
  expect(buttons).toEqual(["Refuser", "Accepter"]);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(400);
  expect(beacons).toEqual([]);
  await page.screenshot({ path: shot("lp-real-public-consent") });

  // Accept: now a view and the scroll depth are counted, with the consent flag, and nothing else leaves.
  await banner.getByRole("button", { name: "Accepter" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(() => beacons.length, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(beacons.every((b) => JSON.parse(b.body).c === true)).toBe(true);
  expect(beacons.map((b) => JSON.parse(b.body).k)).toContain("view");
  await page.locator("[data-cta]").first().click({ trial: true });
  expect(external).toEqual([]);
  expect(violations).toEqual([]);
  await page.screenshot({ path: shot("lp-real-public"), fullPage: true });

  // A new visitor who declines is never counted.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const b2: string[] = [];
  p2.on("request", (r) => {
    if (r.method() === "POST" && /\/e$/.test(r.url())) b2.push(r.postData() ?? "");
  });
  await p2.goto(`${PAGES_URL}${publicPath}`);
  await p2.locator("#consent").getByRole("button", { name: "Refuser" }).click();
  await p2.mouse.wheel(0, 3000);
  await p2.waitForTimeout(400);
  expect(b2).toEqual([]);
  await ctx2.close();
  await ctx.close();
});

test("unpublish: the public address is a 404 at once", async ({ browser }) => {
  const page = await asPersona(browser, "ceo");
  const off = await api(page, "ceo", `/v1/lp/${pageId}/unpublish`, { body: {} });
  expect(off.status).toBe(200);
  const gone = await page.request.get(`${PAGES_URL}${publicPath}`);
  expect(gone.status()).toBe(404);
  await page.context().close();
});
