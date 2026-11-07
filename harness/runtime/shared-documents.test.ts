import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { projectRegister, validateRegister, visibleRows } from "../../reconstruction/shared-documents/register.mjs";
import { renderSharedDocuments } from "../../reconstruction/ui/pages.mjs";

const fixture = readFileSync("reconstruction/shared-documents/SYNTHETIC-FIXTURE.json", "utf8");

test("the synthetic shared-document register imports without becoming trusted", () => {
  const parsed = validateRegister(fixture);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const view = projectRegister(parsed.register);
  assert.equal(view.trust, "supplied");
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows.reduce((sum, row) => sum + row.events.length, 0), 3);
  assert.equal(view.conflicts.length, 1);
  assert.equal(view.counts.verified_unique_underlying_documents, null);
  assert.equal(view.rows[0].title.includes("<b>"), true);
  assert.equal(visibleRows(view, "Document B", "all").length, 1);
  assert.equal(visibleRows(view, "", "variants").length, 1);
  assert.equal(visibleRows(view, "", "shared-link").length, 1);
  const claimed = JSON.parse(fixture);
  claimed.source_provenance.manifest_checksum_verified = true;
  const forged = validateRegister(JSON.stringify(claimed));
  assert.equal(forged.ok, true);
  if (!forged.ok) return;
  assert.equal(projectRegister(forged.register).trust, "supplied");
  assert.equal(projectRegister(forged.register).manifestClaim, true);
});

test("a bad shared-document import does not replace the previous register", () => {
  const good = validateRegister(fixture);
  assert.equal(good.ok, true);
  if (!good.ok) return;
  const kept = projectRegister(good.register);
  const broken = JSON.parse(fixture);
  broken.records[0].provided_title = "See the SharePoint library";
  const rejected = validateRegister(JSON.stringify(broken));
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.error, "sharepoint_excluded");
  assert.equal(kept.rows[0].title.includes("<b>"), true);
  broken.records[0].provided_title = kept.rows[0].title;
  broken.counts.retained_occurrences = 9;
  assert.equal(validateRegister(JSON.stringify(broken)).ok, false);
  assert.equal(validateRegister("{").ok, false);
  const page = renderSharedDocuments({
    surface: "preview",
    links: [["shared-documents.html", "Shared documents"]],
    currentHref: "shared-documents.html",
    who: "Not signed in",
  });
  assert.equal(page.includes("No account was contacted"), true);
  assert.equal(page.includes("<b>text only</b>"), false);
  assert.equal(page.includes("4328764a"), false);
});

test("the shared-documents page imports, filters, and keeps state after a bad paste", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-docs-"));
  execFileSync(process.execPath, ["reconstruction/home/build-preview.mjs", dir], { cwd: process.cwd() });
  const require = createRequire("/home/ubuntu/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.js");
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(join(dir, "shared-documents.html")).href);
    await page.locator("#reg-paste").fill(fixture);
    await page.getByRole("button", { name: "Import in this browser" }).click();
    await page.getByText("SYNTHETIC <b>text only</b> document").waitFor();
    const html = await page.locator("#reg-view").innerHTML();
    assert.equal(html.includes("<b>"), false);
    await page.locator("#reg-q").fill("Document B");
    await page.getByText("SYNTHETIC Document B").waitFor();
    assert.equal(await page.getByText("SYNTHETIC <b>text only</b> document").count(), 0);
    await page.locator("#reg-q").fill("");
    await page.locator("#reg-filter").selectOption("variants");
    await page.getByRole("cell", { name: /variant group/ }).waitFor();
    await page.locator("#reg-paste").fill("{");
    await page.getByRole("button", { name: "Import in this browser" }).click();
    await page.getByText("Not imported (invalid_json)").waitFor();
    assert.equal(await page.getByRole("cell", { name: /variant group/ }).count(), 1);
    const box = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    assert.equal(box, true);
  } finally {
    await browser.close();
  }
});
