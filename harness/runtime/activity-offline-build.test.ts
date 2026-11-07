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
  assert.equal(html, readFileSync("reconstruction/activity/offline/index.html", "utf8"));
  assert.match(html, /not authentication/);
  assert.match(html, /not the signed-in Settings/);
  assert.match(html, /7ec06819c880305c91c7eba47b383715c765810c4dcbe4e8380f0d6348993fbb/);
  assert.equal(html.includes("relay-synthetic"), false);
  assert.equal(html.includes("PRIVATE KEY"), false);
  assert.equal(html.includes("x-dev-email"), false);
  assert.equal(html.includes("fetch("), false);
  assert.equal(html.includes("import "), false);
  assert.equal(createHash("sha256").update(readFileSync("reconstruction/activity/offline/index.html")).digest("hex"), "a4d35e2a54430fd8d10606f87ad5672c86427e8d82e3f0c44514537784622e0c");
  assert.equal(html.includes("Buffer.byteLength"), false);
});
