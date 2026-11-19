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
  "src/worker/ai/anthropic.ts",
  "src/worker/agent/stream.ts",
  "src/worker/ai/budget.ts",
  "src/worker/tenant-policy.ts",
  "src/worker/wiki/seed.ts",
  "src/worker/agent/loop.ts",
  "src/worker/workspace.ts",
  "src/worker/internal-auth.ts",
  "src/worker/replay.ts",
  "recovered-source/shared/packages/contracts/src/signed-call.ts",
  "recovered-source/shared/packages/contracts/src/ops-auth.ts",
  "recovered-source/shared/packages/policy/src/roles.ts",
  "src/worker/auth/routes.ts",
  "src/worker/auth.ts",
  "src/worker/connector.ts",
  "src/worker/ops-internal.ts",
  "src/worker/brains/data.ts",
  "src/worker/brains/routes.ts",
  "src/worker/brains/store.ts",
  "src/worker/brains/shared.ts",
  "src/worker/brains/open.ts",
  "src/worker/brains/fields.ts",
  "src/worker/wiki/routes.ts",
  "src/worker/wiki/store.ts",
  "src/worker/uxv2/index.ts",
  "src/worker/uxv2/questions.ts",
  "src/worker/observe.ts",
  "src/worker/ops-admin.ts",
  "src/worker/switches.ts",
  "src/worker/ai/routes.ts",
  "src/worker/agent/turn.ts",
  "src/worker/uxv2/routines.ts",
  "src/worker/uxv2/tree.ts",
  "src/worker/uxv2/ask.ts",
  "src/worker/ops-rights.ts",
  "src/worker/audit.ts",
  "src/worker/security-journal.ts",
  "src/worker/security.ts",
  "src/worker/admin/store.ts",
  "src/worker/admin/routes.ts",
  "src/worker/auth/identity-store.ts",
  "src/worker/scim/routes.ts",
  "src/worker/auth/oidc.ts",
  "src/worker/auth/config.ts",
  "src/worker/org.ts",
  "src/worker/routes.ts",
  "src/worker/brains/agents.ts",
  "src/worker/ux/personal.ts",
  "src/worker/ux/review.ts",
  "src/worker/ux/util.ts",
  "src/worker/wiki/review.ts",
  "src/worker/brains/open.ts",
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

type ReconstructedEntry = {
  path: string;
  sourceCommit: string;
  sourceBlob: string;
  n: number;
  sha256: string;
  byteEdits: { before: string; after: string }[];
};

type ReconstructedManifest = { files: ReconstructedEntry[] };

const UNLISTED_RECOVERED = "recovered-source/shared/__unlisted__.ts";
const WORKER_PREFIX = "recovered-source/worker/src/";

function located(manifestPath: string): string {
  if (manifestPath.startsWith(WORKER_PREFIX)) return `src/worker/${manifestPath.slice(WORKER_PREFIX.length)}`;
  return manifestPath;
}

function asIntakeBytes(manifestPath: string, data: Buffer): Buffer {
  if (!manifestPath.startsWith(WORKER_PREFIX)) return data;
  const rel = manifestPath.slice(WORKER_PREFIX.length);
  const depth = rel.split("/").length - 1;
  const text = data.toString("utf8");
  const restored = text
    .split("../".repeat(depth + 1) + "state/").join("../".repeat(depth + 3) + "src/state/")
    .split("../".repeat(depth + 2) + "packages/").join("../".repeat(depth + 3) + "packages/");
  return Buffer.from(restored);
}

function loadReconstructed(): ReconstructedManifest {
  return JSON.parse(readFileSync(path.join(root, "reconstructed-manifest.json"), "utf8")) as ReconstructedManifest;
}

function recoveredWalk(): string[] {
  return walk(path.join(root, "recovered-source")).map((full) =>
    path.relative(root, full).split(path.sep).join("/"),
  );
}

function assertRecoveredUnion(
  present: readonly string[],
  candidatePaths: readonly string[],
  reconstructed: ReconstructedManifest,
): void {
  const reconstructedPaths = reconstructed.files
    .map((file) => file.path)
    .filter((file) => file.startsWith("recovered-source/"));
  const candidate = new Set(candidatePaths);
  const overlap = reconstructedPaths.filter((rel) => candidate.has(rel));
  assert.deepEqual(overlap, []);
  for (const file of reconstructed.files) {
    if (!file.path.startsWith("recovered-source/")) continue;
    assert.equal(sha256(path.join(root, file.path)), file.sha256, file.path);
  }
  for (const file of reconstructed.files) {
    if (!file.path.startsWith("src/worker/")) continue;
    assert.equal(sha256(path.join(root, file.path)), file.sha256, file.path);
  }
  const union = [...candidatePaths, ...reconstructedPaths];
  assert.deepEqual([...present].sort(), union.sort());
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
    const full = path.join(root, located(file.path));
    const data = readFileSync(full);
    if (PATCHED_RECOVERED.has(located(file.path))) {
      const hash = createHash("sha256").update(data).digest("hex");
      assert.notEqual(hash, file.sha256, `${file.path} still matches the intake bytes`);
      bytes += file.bytes;
      continue;
    }
    const intake = asIntakeBytes(file.path, data);
    bytes += intake.length;
    assert.equal(intake.length, file.bytes, file.path);
    assert.equal(createHash("sha256").update(intake).digest("hex"), file.sha256, file.path);
  }
  for (const rel of PATCHED_RECOVERED) {
    const manifestPath = rel.startsWith("src/worker/")
      ? `${WORKER_PREFIX}${rel.slice("src/worker/".length)}`
      : rel;
    assert.equal(expected.has(manifestPath), true, rel);
  }
  assert.equal(bytes, manifest.counts.source_bytes);

  const pinned = JSON.parse(
    readFileSync(new URL("./patched-sha256.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  const patched = [...new Set(PATCHED_RECOVERED)].sort();
  assert.deepEqual(Object.keys(pinned).sort(), patched);
  for (const rel of patched) assert.equal(sha256(path.join(root, rel)), pinned[rel], rel);

  const present = recoveredWalk();
  const stayed = [...expected].filter((rel) => !rel.startsWith(WORKER_PREFIX));
  assertRecoveredUnion(present, stayed, loadReconstructed());
});

test("the packages symlink resolves unchanged Worker import paths onto recovered contracts", () => {
  const link = path.join(root, "packages");
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  const fromAudit = path.resolve(
    root,
    "src/worker",
    "../../packages/contracts/src/audit-receipt.ts",
  );
  const fromAgent = path.resolve(
    root,
    "src/worker/agent",
    "../../../packages/contracts/src/agent-ui/schemas.ts",
  );
  assert.equal(sha256(fromAudit), sha256(path.join(root, "recovered-source/shared/packages/contracts/src/audit-receipt.ts")));
  assert.equal(sha256(fromAgent), sha256(path.join(root, "recovered-source/shared/packages/contracts/src/agent-ui/schemas.ts")));

  const reconstructed = loadReconstructed();
  const missing = [
    {
      read: "packages/contracts/src/agent-ui/index.ts",
      listed: "recovered-source/shared/packages/contracts/src/agent-ui/index.ts",
    },
    {
      read: "packages/contracts/src/view-plan.ts",
      listed: "recovered-source/shared/packages/contracts/src/view-plan.ts",
    },
    {
      read: "src/worker/types.ts",
      listed: "src/worker/types.ts",
    },
  ];
  for (const item of missing) {
    const entry = reconstructed.files.find((file) => file.path === item.listed);
    if (entry) {
      assert.equal(sha256(path.join(root, item.read)), entry.sha256, item.read);
    } else {
      assert.throws(() => readFileSync(path.join(root, item.read)), { code: "ENOENT" });
    }
  }
});

test("an unlisted recovered path fails the manifest union", () => {
  assert.throws(() => readFileSync(path.join(root, UNLISTED_RECOVERED)), { code: "ENOENT" });
  const manifest = JSON.parse(readFileSync(path.join(root, "candidate-manifest.json"), "utf8")) as {
    files: { path: string }[];
  };
  const reconstructed = loadReconstructed();
  const present = recoveredWalk();
  assert.equal(present.includes(UNLISTED_RECOVERED), false);
  assert.throws(() =>
    assertRecoveredUnion([...present, UNLISTED_RECOVERED], manifest.files.map((file) => file.path), reconstructed),
  );
  assert.throws(() => readFileSync(path.join(root, UNLISTED_RECOVERED)), { code: "ENOENT" });
});
