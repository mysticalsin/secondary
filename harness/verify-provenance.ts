/**
 * Check every reconstructed-manifest entry against the commit that contains its blob.
 * Not part of npm test. The source commits are not ancestors of main. They are in
 * this clone only as the annotated tags provenance/worker-119-db3e8548,
 * provenance/worker-119-be6eb37f, and provenance/worker-119-4ba133b0.
 * A missing object exits 1 and names the tag to fetch.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROVENANCE_TAGS: Record<string, string> = {
  db3e8548: "provenance/worker-119-db3e8548",
  be6eb37f: "provenance/worker-119-be6eb37f",
  "4ba133b0": "provenance/worker-119-4ba133b0",
};

function provenanceTag(sourceCommit: string): string {
  const prefix = sourceCommit.slice(0, 8);
  return PROVENANCE_TAGS[prefix] ?? `provenance/worker-119-${prefix}`;
}

type Entry = {
  path: string;
  sourceCommit: string;
  sourceBlob: string;
};

const manifest = JSON.parse(readFileSync("reconstructed-manifest.json", "utf8")) as {
  files: Entry[];
};

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

let failed = 0;

for (const file of manifest.files) {
  const label = `${file.path}: sourceCommit ${file.sourceCommit} sourceBlob ${file.sourceBlob}`;
  const objectType = git(["cat-file", "-t", file.sourceCommit]);
  if (objectType === null) {
    console.error(
      `missing provenance object ${file.sourceCommit}: git fetch origin tag ${provenanceTag(file.sourceCommit)}`,
    );
    failed += 1;
    continue;
  }
  const listing = git(["ls-tree", "-r", file.sourceCommit]);
  if (listing === null) {
    console.error(`provenance mismatch: ${label}: sourceCommit is not a readable tree`);
    failed += 1;
    continue;
  }
  const paths: string[] = [];
  for (const line of listing.split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const blob = line.slice(0, tab).split(" ")[2];
    if (blob === file.sourceBlob) paths.push(line.slice(tab + 1));
  }
  if (paths.length !== 1) {
    console.error(
      `provenance mismatch: ${label}: sourceCommit contains that blob at ${paths.length} paths`,
    );
    failed += 1;
    continue;
  }
  const sourcePath = paths[0];
  const resolvedRaw = git(["rev-parse", `${file.sourceCommit}:${sourcePath}`]);
  if (resolvedRaw === null) {
    console.error(
      `provenance mismatch: ${label}: git rev-parse ${file.sourceCommit}:${sourcePath} failed`,
    );
    failed += 1;
    continue;
  }
  const resolved = resolvedRaw.trim();
  if (resolved !== file.sourceBlob) {
    console.error(
      `provenance mismatch: ${label}: git rev-parse ${file.sourceCommit}:${sourcePath} is ${resolved}`,
    );
    failed += 1;
    continue;
  }
  console.log(`ok ${file.path}: git rev-parse ${file.sourceCommit}:${sourcePath} = ${resolved}`);
}

if (failed > 0) process.exit(1);
