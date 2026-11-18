/**
 * Check every reconstructed-manifest entry against the commit that contains its blob.
 * Not part of npm test. The source commits must be in this clone. If they are not,
 * the process exits 1 and says the tree is not readable. That is not a hash match.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
