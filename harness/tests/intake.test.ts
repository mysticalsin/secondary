/**
 * Checks the intake archive and that recovered-source still matches the manifest.
 * New harness files must stay outside recovered-source.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ARCHIVE_SHA256 = "7a1c16daa666f635ca5bffc08feae0f81fc1ff21334d64678b17613446323dce";
const ARCHIVE_BYTES = 341428;
const PROVENANCE_SHA256 = "f15f392226ab8350386ac2f1e8e21faf08dcd9a17decf36b420e10a7c4d5df10";
const MANIFEST_SHA256 = "330452d57b8704a69da263b64342b26c8b7fb1d828f111590a256ddff76cea77";

/**
 * Recovered files this branch patches so a lifecycle has one reducer.
 * The manifest still records the intake bytes. These paths must exist there
 * and must no longer match those bytes. Every other recovered file must match.
 */
const PATCHED_RECOVERED = new Set<string>([
  "recovered-source/worker/src/ai/anthropic.ts",
  "recovered-source/worker/src/agent/stream.ts",
]);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (name.isFile()) out.push(full);
  }
  return out;
}

test("the intake archive and provenance records match the reviewed bytes", () => {
  const archive = path.join(root, "intake/secondary-api-private-source-candidate.tar.gz");
  const archiveBytes = readFileSync(archive);
  assert.equal(archiveBytes.length, ARCHIVE_BYTES);
  assert.equal(createHash("sha256").update(archiveBytes).digest("hex"), ARCHIVE_SHA256);
  assert.equal(sha256(path.join(root, "PROVENANCE.md")), PROVENANCE_SHA256);
  assert.equal(sha256(path.join(root, "candidate-manifest.json")), MANIFEST_SHA256);
});

test("every recovered file matches the manifest, and nothing else is in recovered-source", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "candidate-manifest.json"), "utf8")) as {
    counts: { files: number; source_bytes: number; third_party_files_excluded: number };
    files: { path: string; bytes: number; sha256: string }[];
  };
  assert.equal(manifest.counts.files, 117);
  assert.equal(manifest.counts.source_bytes, 1_227_833);
  assert.equal(manifest.counts.third_party_files_excluded, 165);
  assert.equal(manifest.files.length, 117);

  let bytes = 0;
  const expected = new Set<string>();
  for (const file of manifest.files) {
    expected.add(file.path);
    const full = path.join(root, file.path);
    const data = readFileSync(full);
    if (PATCHED_RECOVERED.has(file.path)) {
      const hash = createHash("sha256").update(data).digest("hex");
      assert.notEqual(hash, file.sha256, `${file.path} still matches the intake bytes`);
      bytes += file.bytes;
      continue;
    }
    bytes += data.length;
    assert.equal(data.length, file.bytes, file.path);
    assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256, file.path);
  }
  for (const rel of PATCHED_RECOVERED) assert.equal(expected.has(rel), true, rel);
  assert.equal(bytes, manifest.counts.source_bytes);

  const present = walk(path.join(root, "recovered-source")).map((full) =>
    path.relative(root, full).split(path.sep).join("/"),
  );
  assert.deepEqual(present.sort(), [...expected].sort());
});

test("the packages symlink resolves unchanged Worker import paths onto recovered contracts", () => {
  const link = path.join(root, "packages");
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  const fromAudit = path.resolve(
    root,
    "recovered-source/worker/src",
    "../../../packages/contracts/src/audit-receipt.ts",
  );
  const fromAgent = path.resolve(
    root,
    "recovered-source/worker/src/agent",
    "../../../../packages/contracts/src/agent-ui/schemas.ts",
  );
  assert.equal(sha256(fromAudit), sha256(path.join(root, "recovered-source/shared/packages/contracts/src/audit-receipt.ts")));
  assert.equal(sha256(fromAgent), sha256(path.join(root, "recovered-source/shared/packages/contracts/src/agent-ui/schemas.ts")));

  const missing = [
    "packages/contracts/src/agent-ui/index.ts",
    "packages/contracts/src/view-plan.ts",
    "recovered-source/worker/src/types.ts",
  ];
  for (const rel of missing) {
    assert.throws(() => readFileSync(path.join(root, rel)), { code: "ENOENT" });
  }
});
