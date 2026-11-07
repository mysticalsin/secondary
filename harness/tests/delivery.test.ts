/**
 * Preserved delivered CSS/JS text. Reads and hashes only. Does not import or run the assets.
 * No HTML shell is in these archives, so none is invented here.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mainSurface } from "../../reconstruction/delivery/read-main.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const delivery = path.join(root, "recovered-delivery");

const SHELL_SHA = "64622e1c8e5504636f7dace883edfa39b60e186ae282895718e9eef0ecd8ef79";
const LAZY_SHA = "803132fda13db3a662c441c4722ac797a2084cae1aa28c9958479f8a8bbd8296";
const FINAL_SHA = "9afe572e0bc07b483196d42e8f7df4cdd7f3c8ca2aa535ba619b3a086916dae3";
const FINAL_JS_SHA = "0c99a1cb3e8d42334cd5deb1641abd3212a56b21d0bab828e44eec67d498bb01";
const MAIN_JS = "index-PLmoiPYI.js";
const FINAL_JS = "index-DZRyvnzT.js";

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sliceHash(text: string, start: number, end: number): string {
  return sha256(Buffer.from([...text].slice(start, end).join(""), "utf8"));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { recursive: true }).map(String)) {
    const full = path.join(dir, name);
    if (statSync(full).isFile()) out.push(name);
  }
  return out.sort();
}

test("three delivered archives match their reviewed bytes", () => {
  const archives = [
    ["shell-six/secondary-six-frontend-dom-code-private-candidate.tar.gz", 61301, SHELL_SHA],
    ["lazy-six/secondary-lazy-six-dom-code-private-candidate.tar.gz", 39254, LAZY_SHA],
    ["final-code/secondary-final-js-dom-code-private-candidate.tar.gz", 7372, FINAL_SHA],
  ] as const;
  for (const [rel, size, hash] of archives) {
    const bytes = readFileSync(path.join(delivery, rel));
    assert.equal(bytes.length, size, rel);
    assert.equal(sha256(bytes), hash, rel);
  }
  const shell = JSON.parse(readFileSync(path.join(delivery, "shell-six/manifest.json"), "utf8")) as {
    assets: { name: string; sha256: string; codepoints: number; utf8_bytes: number; ranges: { start: number; endExclusive: number; text_utf8_sha256: string }[] }[];
  };
  assert.equal(shell.assets.length, 6);
  for (const asset of shell.assets) {
    const bytes = readFileSync(path.join(delivery, "shell-six/assets", asset.name));
    assert.equal(sha256(bytes), asset.sha256, asset.name);
    assert.equal(bytes.length, asset.utf8_bytes);
    const text = bytes.toString("utf8");
    assert.equal([...text].length, asset.codepoints);
    let cursor = 0;
    for (const range of asset.ranges) {
      assert.equal(range.start, cursor);
      assert.equal(sliceHash(text, range.start, range.endExclusive), range.text_utf8_sha256);
      cursor = range.endExclusive;
    }
    assert.equal(cursor, asset.codepoints);
  }
});

test("lazy ranges and the Thread overlap are exact, and the dynamic import is one missing file", () => {
  const manifest = JSON.parse(readFileSync(path.join(delivery, "lazy-six/manifest.json"), "utf8")) as {
    known_privacy_flags_unresolved?: number;
    assets: { name: string; sha256: string; codepoints: number; ranges: { start: number; endExclusive: number; text_utf8_sha256: string }[]; unresolved_known_privacy_flags: number }[];
    thread_overlap: { start: number; endExclusive: number; codepoints: number; exact_match: boolean; utf8_sha256: string };
    dependency_summary: { literal_code_set_closed: boolean; missing_declared_code_assets: { literal: string }[]; missing_fonts: number; missing_images: string[] };
  };
  for (const asset of manifest.assets) {
    assert.equal(asset.unresolved_known_privacy_flags, 0, asset.name);
    const text = readFileSync(path.join(delivery, "lazy-six/assets", asset.name), "utf8");
    assert.equal(sha256(Buffer.from(text, "utf8")), asset.sha256);
    assert.equal([...text].length, asset.codepoints);
    for (const range of asset.ranges) {
      assert.equal(sliceHash(text, range.start, range.endExclusive), range.text_utf8_sha256, asset.name);
    }
  }
  const thread = readFileSync(path.join(delivery, "lazy-six/assets/Thread-eq9OCIoK.js"), "utf8");
  const overlap = manifest.thread_overlap;
  assert.equal(overlap.exact_match, true);
  assert.equal(overlap.codepoints, 10000);
  assert.equal(sliceHash(thread, overlap.start, overlap.endExclusive), overlap.utf8_sha256);
  const dynamic = [...thread.matchAll(/import\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(dynamic, ["./index-DZRyvnzT.js"]);
  assert.equal(manifest.dependency_summary.literal_code_set_closed, false);
  assert.deepEqual(
    manifest.dependency_summary.missing_declared_code_assets.map((item) => item.literal),
    ["./index-DZRyvnzT.js"],
  );
  assert.equal(manifest.dependency_summary.missing_fonts, 40);
  assert.equal(manifest.dependency_summary.missing_images.length, 2);
});

test("the final module closes the declared import and does not add another code import", () => {
  const manifest = JSON.parse(readFileSync(path.join(delivery, "final-code/manifest.json"), "utf8")) as {
    sha256: string;
    codepoints: number;
    utf8_bytes: number;
    ranges: { start: number; endExclusive: number; utf8_sha256: string }[];
    privacy: { pattern_counts: Record<string, number> };
    dependency_closure: { captured_count: number; literal_code_set_closed: boolean; missing_code: unknown[]; missing_fonts: number; missing_images: string[]; sourceMappingURL_comments: unknown[] };
  };
  const text = readFileSync(path.join(delivery, "final-code/assets", FINAL_JS), "utf8");
  assert.equal(sha256(Buffer.from(text, "utf8")), FINAL_JS_SHA);
  assert.equal(manifest.sha256, FINAL_JS_SHA);
  assert.equal([...text].length, 5704);
  assert.equal(Buffer.byteLength(text), manifest.utf8_bytes);
  assert.equal(manifest.ranges.length, 8);
  let cursor = 0;
  for (const range of manifest.ranges) {
    assert.equal(range.start, cursor);
    assert.equal(sliceHash(text, range.start, range.endExclusive), range.utf8_sha256);
    cursor = range.endExclusive;
  }
  assert.equal(cursor, 5704);
  for (const count of Object.values(manifest.privacy.pattern_counts)) assert.equal(count, 0);
  assert.equal(text.includes("sourceMappingURL"), false);
  assert.equal(/from\s*["'][^"']+["']/.test(text), false);
  assert.equal(text.includes("import("), false);
  const closure = JSON.parse(readFileSync(path.join(delivery, "final-code/dependency-closure-14.json"), "utf8")) as {
    declared_literal_code_set_closed: boolean;
    missing_declared_code_assets: unknown[];
    missing_font_urls: string[];
    missing_image_urls: string[];
    captured_assets: { name: string }[];
  };
  assert.equal(closure.declared_literal_code_set_closed, true);
  assert.equal(manifest.dependency_closure.literal_code_set_closed, true);
  assert.equal(manifest.dependency_closure.captured_count, 14);
  assert.deepEqual(closure.missing_declared_code_assets, []);
  assert.equal(closure.missing_font_urls.length, 40);
  assert.equal(closure.missing_image_urls.length, 2);
  assert.equal(closure.captured_assets.some((asset) => asset.name === MAIN_JS), true);
  assert.equal(
    filesUnder(delivery).some((name) => path.basename(name) === "index-PLmoiPYI.dom-captured.js"),
    true,
  );
});

test("local bytes are not a closed shell and the renderer catalog is not the view-plan catalog", () => {
  const onDisk = filesUnder(delivery);
  assert.equal(onDisk.some((name) => /\.(html|woff2?|png)$/i.test(name)), false);
  const renderer = readFileSync(path.join(delivery, "shell-six/assets/Renderer-0G0MSIPy.js"), "utf8");
  const leaf = renderer.match(/pt=\[((?:"[A-Za-z]+",)*"[A-Za-z]+")\]/);
  assert.ok(leaf);
  const leaves = [...leaf[1].matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
  const plan = readFileSync(path.join(root, "reconstruction/packages/contracts/src/view-plan.ts"), "utf8");
  const planned = [...plan.matchAll(/type: "([A-Za-z]+)"/g)].map((match) => match[1]);
  const shared = leaves.filter((name) => planned.includes(name)).sort();
  assert.deepEqual(shared, ["Callout", "Table"]);
  assert.equal(leaves.includes("KpiTile"), true);
  assert.equal(planned.includes("KpiRow"), true);
  assert.equal(leaves.includes("KpiRow"), false);
});

const MAIN_ARCHIVE_SHA = "c57b5e2b505f60936fbe583eda5de2244e7442a9c3c0641ecfde40d82c7dd69d";
const MAIN_JS_SHA = "0acf56bc36d5dbfed072cc12ceb38abb9750bab36203f9f38bf5243315df33bd";

test("the main bundle archive matches the reviewed DOM text", () => {
  const archive = readFileSync(
    path.join(delivery, "main-js/secondary-main-frontend-dom-code-private-candidate.tar.gz"),
  );
  assert.equal(archive.length, 177509);
  assert.equal(sha256(archive), MAIN_ARCHIVE_SHA);
  const manifest = JSON.parse(readFileSync(path.join(delivery, "main-js/manifest.json"), "utf8")) as {
    sha256: string;
    codepoints: number;
    utf8_bytes: number;
    contiguous_complete: boolean;
    privacy: { known_unresolved_flags: number };
    sourceMappingURL_comments: unknown[];
    range_proof: { start: number; endExclusive: number; text_sha256: string; utf8_bytes: number }[];
  };
  const text = readFileSync(path.join(delivery, "main-js/index-PLmoiPYI.dom-captured.js"), "utf8");
  assert.equal(sha256(Buffer.from(text, "utf8")), MAIN_JS_SHA);
  assert.equal(manifest.sha256, MAIN_JS_SHA);
  assert.equal([...text].length, 578596);
  assert.equal(Buffer.byteLength(text), 581692);
  assert.equal(manifest.contiguous_complete, true);
  assert.equal(manifest.privacy.known_unresolved_flags, 0);
  assert.deepEqual(manifest.sourceMappingURL_comments, []);
  assert.equal(text.includes("sourceMappingURL"), false);
  let cursor = 0;
  for (const range of manifest.range_proof) {
    assert.equal(range.start, cursor);
    const slice = [...text].slice(range.start, range.endExclusive).join("");
    assert.equal(Buffer.byteLength(slice), range.utf8_bytes);
    assert.equal(sha256(Buffer.from(slice, "utf8")), range.text_sha256);
    cursor = range.endExclusive;
  }
  assert.equal(cursor, manifest.codepoints);
  const workerCopy = path.join(root, "recovered-source");
  assert.equal(filesUnder(workerCopy).some((name) => name.includes("index-PLmoiPYI")), false);
});

test("main-bundle literals name the person switch and do not call the view-plan route", () => {
  const text = readFileSync(path.join(delivery, "main-js/index-PLmoiPYI.dom-captured.js"), "utf8");
  const surface = mainSurface(text);
  assert.deepEqual(surface.dynamicImports, [
    "./AgentPage-DHJmJKpV.js",
    "./AgentPanel-Dn16YgEH.js",
    "./BrainViews-DoMdPJUS.js",
    "./PinnedGrid-CuaLdMPY.js",
    "./SettingsSection-f2wwgrYJ.js",
    "./SharedView-CEqhSdzS.js",
  ]);
  assert.equal(surface.personaKey, true);
  assert.equal(surface.personaDefaultCeo, true);
  assert.equal(surface.demoHeader, true);
  assert.equal(surface.sameOrigin, true);
  assert.equal(surface.callsMe, true);
  assert.equal(surface.callsGenuiPlan, false);
  assert.deepEqual(surface.logos, ["/brand/logo_main.png", "/brand/logo_main_white.png"]);
  assert.equal(surface.assetLiterals.includes("assets/index-DiBYRwP4.css"), false);
  assert.equal(surface.assetLiterals.includes("assets/index-DZRyvnzT.js"), false);
  const auth = readFileSync(path.join(root, "recovered-source/worker/src/auth.ts"), "utf8");
  assert.equal(auth.includes('c.env.ENVIRONMENT !== "dev"'), true);
  assert.equal(auth.includes('c.req.header("X-Demo-Persona")'), true);
  const worker = filesUnder(path.join(root, "recovered-source/worker/src"))
    .map((name) => readFileSync(path.join(root, "recovered-source/worker/src", name), "utf8"))
    .join("\n");
  for (const route of ["/v1/me", "/v1/activity", "/v1/ux/prefs", "/v1/brains/nav", "/v1/brain/tree", "/v1/ask", "/v1/genui/plan"]) {
    assert.equal(worker.includes(`"${route.slice(3)}"`) || worker.includes(`"${route}"`), true, route);
  }
  assert.equal(worker.includes('"/genui/plan"'), true);
});
