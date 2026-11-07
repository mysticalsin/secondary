import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { renderHome } from "../../reconstruction/ui/pages.mjs";

const links: [string, string][] = [
  ["index.html", "Home"],
  ["personal.html", "Personal brain"],
  ["import.html", "Import"],
  ["observability.html", "Observability"],
  ["activity.html", "Activity"],
];

test("the home dashboard names unknown measures and does not invent figures", () => {
  const denied = renderHome({
    surface: "release",
    who: "ada@tenant-a.test",
    tenant: "tenant_alpha",
    links,
    currentHref: "index.html",
    brain: { state: "denied", shown: null, total: null, coverage: null, detail: "That brain is not open to this session. Nothing from another owner is shown." },
    activity: { state: "unavailable", count: null, detail: "Review activity did not load (500)." },
    usage: { state: "unavailable", detail: "Usage did not load (503). Cost stays unknown." },
    notice: "The personal brain did not load.",
  });
  assert.equal(denied.includes("Second Brain"), true);
  assert.equal(denied.includes("That brain is not open to this session"), true);
  assert.equal(denied.includes("Review activity did not load (500)."), true);
  assert.equal(denied.includes(">Unknown<"), true);
  assert.equal(denied.includes("relay-"), false);
  assert.equal(denied.includes("99%"), false);
  assert.equal(denied.includes("$"), false);
  const empty = renderHome({
    surface: "preview",
    who: "Not signed in",
    tenant: "Not connected",
    links,
    currentHref: "index.html",
    brain: { state: "empty", shown: null, total: null, coverage: null, detail: "No personal brain is loaded in this file. Nothing has been imported here." },
    activity: { state: "empty", count: null, detail: "No review records are in this file." },
    usage: { state: "unknown", detail: "Usage was not loaded. Cost is unknown. Unknown is not zero." },
    notice: "",
  });
  assert.equal(empty.includes("No account was contacted"), true);
  assert.equal(empty.includes("activity.html"), true);
  assert.equal(empty.includes("observability.html"), true);
  const dir = mkdtempSync(join(tmpdir(), "home-preview-"));
  execFileSync(process.execPath, ["reconstruction/home/build-preview.mjs", dir], { cwd: process.cwd() });
  const index = readFileSync(join(dir, "index.html"), "utf8");
  assert.equal(index, empty);
  assert.equal(readFileSync(join(dir, "activity.html"), "utf8").includes("Nothing has been imported"), true);
  assert.equal(readFileSync(join(dir, "observability.html"), "utf8").includes("Unknown"), true);
});
