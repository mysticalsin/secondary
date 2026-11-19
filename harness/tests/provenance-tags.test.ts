import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("a missing provenance object names the tag to fetch", () => {
  const dir = mkdtempSync(join(tmpdir(), "provenance-missing-"));
  const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(
    join(dir, "reconstructed-manifest.json"),
    readFileSync(join(root, "reconstructed-manifest.json")),
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(root, "harness/verify-provenance.ts")],
    { cwd: dir, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  const err = `${result.stdout}${result.stderr}`;
  assert.match(
    err,
    /missing provenance object db3e8548: git fetch origin tag provenance\/worker-119-db3e8548/,
  );
  assert.match(
    err,
    /missing provenance object be6eb37f31e62f0f04a610202cca120aa4d9302f: git fetch origin tag provenance\/worker-119-be6eb37f/,
  );
  assert.match(
    err,
    /missing provenance object 4ba133b04e49cfb20abe0a22b5ca367284456356: git fetch origin tag provenance\/worker-119-4ba133b0/,
  );
  assert.equal((err.match(/missing provenance object /g) ?? []).length, 5);
  assert.equal(err.includes("not a readable tree"), false);
  assert.equal(err.includes("provenance mismatch"), false);
});
