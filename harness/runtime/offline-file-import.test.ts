import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const chrome = "/opt/google/chrome/chrome";
const playwright = "/home/ubuntu/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.js";
const pageUrl = "file:///workspace/reconstruction/activity/offline/index.html";

function record(notes: string) {
  return {
    schema_version: "relay.codex-review-run/1",
    record_id: "relay-synthetic-browser",
    capture: "historical-manual",
    agent: "Relay",
    tool: { name: "codex-cli", version: null, machine_label: null, model: null, reasoning_effort: null, sandbox: null },
    session_id: null,
    started_at: "2026-11-01T10:00:00-03:00",
    finished_at: "2026-11-01T11:00:00-03:00",
    timezone: "America/Sao_Paulo",
    analysis_kind: "static",
    target: { label: "synthetic fixture café", archive_sha256: null, bundle_sha256: null, tree: null, baseline_head: null, patch_sha256: null },
    outcome: { completed: true, exit_code: null, overall_verdict: null, counts: { high: null, medium: null, low: null, fixed: null, cannot_determine: null } },
    tokens_used: null,
    writes_detected: false,
    context_scope: { usual_notes_loaded: null, out_of_folder_reads_observed: null, artifact_only_enforced: false },
    evidence_paths: ["/workspace/synthetic/evidence.txt"],
    notes,
  };
}

test("the file:// activity page imports a synthetic UTF-8 record without Buffer", async () => {
  const { chromium } = createRequire(import.meta.url)(playwright);
  const dir = mkdtempSync(join(tmpdir(), "offline-ndjson-"));
  const file = join(dir, "synthetic-review.ndjson");
  const notes = "synthetic fixture café 日本語";
  writeFileSync(file, `${JSON.stringify(record(notes))}\n`, "utf8");
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const remote: string[] = [];
  page.on("request", (request: { url: () => string }) => {
    const url = request.url();
    if (!url.startsWith("file:")) remote.push(url);
  });
  try {
    await page.goto(pageUrl);
    assert.equal(await page.evaluate(() => typeof (globalThis as { Buffer?: unknown }).Buffer), "undefined");
    await page.getByText("not authentication").waitFor();
    await page.locator("#activity-file").setInputFiles(file);
    await page.waitForFunction(() => {
      const area = document.querySelector("#ndjson");
      return area instanceof HTMLTextAreaElement && area.value.includes("relay-synthetic-browser");
    });
    await page.locator("#import").click();
    await page.getByText("Imported. Coverage is the supplied records only.").waitFor();
    await page.locator("#q").fill("日本語");
    await page.locator("#filters").locator("button").click();
    await page.getByRole("button", { name: "relay-synthetic-browser" }).click();
    await page.getByText(notes).waitFor();
    assert.equal(await page.locator("a[href^='/workspace']").count(), 0);
    await page.reload();
    await page.getByRole("button", { name: "relay-synthetic-browser" }).waitFor();
    await page.getByRole("button", { name: "relay-synthetic-browser" }).click();
    await page.getByText(notes).waitFor();
    const kept = await page.locator("#list").innerText();
    await page.locator("#ndjson").fill("{not json\n");
    await page.locator("#import").click();
    await page.getByText("Not imported (malformed_record). Nothing was written.").waitFor();
    assert.equal(await page.locator("#list").innerText(), kept);
    const huge = record("x");
    huge.notes = "x".repeat(70_000);
    await page.locator("#ndjson").fill(`${JSON.stringify(huge)}\n`);
    await page.locator("#import").click();
    await page.getByText("Not imported (record_too_large). Nothing was written.").waitFor();
    assert.equal(await page.locator("#list").innerText(), kept);
    assert.deepEqual(remote, []);
  } finally {
    await browser.close();
  }
});

test("a 390px file:// detail wraps a synthetic SHA inside the card", async () => {
  const { chromium } = createRequire(import.meta.url)(playwright);
  const hex = "0123456789abcdef".repeat(4);
  const notes = `Supplement SHA256 ${hex}`;
  const title = `Synthetic long title ${hex}`;
  const evidence = `/workspace/synthetic/${hex}/evidence.txt`;
  const id = `relay-synthetic-${hex.slice(0, 24)}`;
  const dir = mkdtempSync(join(tmpdir(), "offline-wrap-"));
  const file = join(dir, "synthetic-review.ndjson");
  writeFileSync(file, `${JSON.stringify({ ...record(notes), record_id: id, target: { ...record(notes).target, label: title }, evidence_paths: [evidence] })}\n`, "utf8");
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 985 } });
  try {
    await page.goto(pageUrl);
    await page.locator("#activity-file").setInputFiles(file);
    await page.waitForFunction((needle) => {
      const area = document.querySelector("#ndjson");
      return area instanceof HTMLTextAreaElement && area.value.includes(needle);
    }, id);
    await page.locator("#import").click();
    await page.getByRole("button", { name: id }).click();
    await page.getByText(notes).waitFor();
    const measure = () => page.evaluate(({ hex, id }) => {
      const view = document.documentElement.clientWidth;
      const toolbar = document.querySelector(".toolbar")?.getBoundingClientRect();
      const hosts = [...document.querySelectorAll(".run, .detail-card, .import-card")];
      const cards = hosts.map((el) => {
        const box = el.getBoundingClientRect();
        return { right: box.right, left: box.left, scroll: el.scrollWidth, client: el.clientWidth };
      });
      const lines = [...document.querySelectorAll("p, h2, strong, .id, .path")].filter((el) => el.textContent?.includes(hex) || el.textContent?.includes(id));
      const text = lines.map((el) => {
        const card = el.closest(".detail-card, .run");
        const cardBox = card?.getBoundingClientRect();
        const rects = [...el.getClientRects()];
        return {
          clipped: el.scrollWidth > el.clientWidth + 1,
          outsideCard: !cardBox || rects.some((box) => box.right > cardBox.right + 1 || box.left < cardBox.left - 1),
          outsideView: rects.some((box) => box.right > view + 1 || box.left < -1),
        };
      });
      return {
        overflow: document.documentElement.scrollWidth - view,
        toolbarRight: toolbar?.right ?? 0,
        cards,
        text,
      };
    }, { hex, id });
    const narrow = await measure();
    assert.equal(narrow.overflow <= 1, true, JSON.stringify(narrow));
    assert.equal(narrow.text.length > 0, true);
    assert.equal(narrow.text.every((item) => !item.clipped && !item.outsideCard && !item.outsideView), true, JSON.stringify(narrow));
    assert.equal(narrow.cards.every((card) => card.right <= narrow.toolbarRight + 1 && card.scroll <= card.client + 1), true, JSON.stringify(narrow));
    await page.setViewportSize({ width: 1280, height: 900 });
    const wide = await measure();
    assert.equal(wide.overflow <= 1, true, JSON.stringify(wide));
    assert.equal(wide.text.every((item) => !item.clipped && !item.outsideCard && !item.outsideView), true, JSON.stringify(wide));
    assert.equal(wide.cards.every((card) => card.right <= wide.toolbarRight + 1), true, JSON.stringify(wide));
  } finally {
    await browser.close();
  }
});
