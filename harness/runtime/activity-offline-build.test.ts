import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("the offline activity page is one file and contains no review records", () => {
  const dir = mkdtempSync(join(tmpdir(), "activity-offline-"));
  const htmlPath = join(dir, "index.html");
  execFileSync(process.execPath, ["reconstruction/activity/build-offline.mjs", htmlPath], { cwd: process.cwd() });
  const html = readFileSync(htmlPath, "utf8");
  const frozen = readFileSync("reconstruction/activity/offline/index.html", "utf8");
  assert.equal(createHash("sha256").update(frozen).digest("hex"), "d089ce6272f02ae8a0df129a710a9c98c47a76f6627ff199739fb301c8d5ce94");
  assert.match(html, /not authentication/);
  assert.match(html, /not the signed-in Settings/);
  assert.match(html, /7ec06819c880305c91c7eba47b383715c765810c4dcbe4e8380f0d6348993fbb/);
  assert.equal(html.includes("relay-synthetic"), false);
  assert.equal(html.includes("PRIVATE KEY"), false);
  assert.equal(html.includes("x-dev-email"), false);
  assert.equal(html.includes("fetch("), false);
  assert.equal(html.includes("import "), false);
  assert.equal(frozen.includes("Buffer.byteLength"), false);
  assert.equal(html.includes("Buffer.byteLength"), false);
  assert.match(html, /ignoreBOM: false/);
});
