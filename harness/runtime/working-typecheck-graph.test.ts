import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const roots = [
  "reconstruction/worker-root/",
  "reconstruction/release/",
  "reconstruction/workerd/",
  "reconstruction/mcp/",
  "reconstruction/audit/",
  "reconstruction/connector/",
  "reconstruction/ops/",
  "reconstruction/pages/",
  "reconstruction/packages/",
  "reconstruction/import/",
  "reconstruction/ledger/",
  "reconstruction/personal/",
  "reconstruction/activity/",
  "reconstruction/ui/",
  "harness/adapters/",
  "recovered-source/shared/packages/",
];

const entries = [
  "reconstruction/worker-root/worker/src/index.ts",
  "reconstruction/workerd/api-harness.ts",
  "reconstruction/mcp/worker/src/import-entry.ts",
  "reconstruction/audit/worker/src/index.ts",
  "reconstruction/connector/worker/src/index.ts",
  "reconstruction/ops/worker/src/index.ts",
  "reconstruction/pages/worker/src/index.ts",
  "reconstruction/workerd/connector-refresh-harness.ts",
  "reconstruction/workerd/view-plan-entry.ts",
];
const textEntries = new Set(["reconstruction/release/entry.ts"]);

function metaFor(entry: string) {
  const dir = mkdtempSync(join(tmpdir(), "graph-"));
  const outfile = join(dir, "out.js");
  const metafile = join(dir, "meta.json");
  execFileSync("node_modules/esbuild/bin/esbuild", [
    entry,
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    `--outfile=${outfile}`,
    "--preserve-symlinks",
    "--alias:@secondary/policy=./harness/adapters/policy-entry.ts",
    "--external:cloudflare:*",
    "--external:node:*",
    "--packages=external",
    `--metafile=${metafile}`,
    ...(textEntries.has(entry) ? ["--loader:.html=text", "--loader:.css=text", "--loader:.js=text"] : []),
  ], { stdio: "pipe" });
  return JSON.parse(readFileSync(metafile, "utf8")) as { inputs: Record<string, unknown> };
}

test("the original API snapshot command still compiles the recovered tree", () => {
  const config = JSON.parse(readFileSync("tsconfig.worker.json", "utf8")) as { include: string[] };
  assert.equal(config.include.includes("recovered-source/worker/src/**/*.ts"), true);
  const script = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(script.scripts["typecheck:worker"], "tsc --noEmit -p tsconfig.worker.json");
});

test("snapshot errors are the missing Env, types, agent-ui, and view-plan modules", () => {
  let text = "";
  try {
    execFileSync("node_modules/typescript/bin/tsc", ["--noEmit", "--pretty", "false", "-p", "tsconfig.worker.json"], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    assert.equal(failed.status, 2);
    text = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }
  const lines = text.split("\n").filter((line) => line.includes("error TS"));
  assert.equal(lines.length, 119);
  const env = lines.filter((line) => line.includes("Cannot find name 'Env'")).length;
  const missing = lines.filter((line) => line.includes("error TS2307")).length;
  assert.equal(env, 68);
  assert.equal(missing, 43);
  assert.equal(lines.some((line) => line.includes("types.ts")), true);
  assert.equal(lines.some((line) => line.includes("agent-ui")), true);
  assert.equal(lines.some((line) => line.includes("view-plan.ts")), true);
  assert.equal(text.includes("recovered-source/"), true);
  assert.equal(text.includes("reconstruction/"), false);
});

test("runtime bundles stay inside the working typecheck and derived modules have declarations", () => {
  const inputs = new Set<string>();
  for (const entry of [...entries, ...textEntries]) {
    for (const file of Object.keys(metaFor(entry).inputs)) inputs.add(file);
  }
  const project = [...inputs].filter((file) => !file.startsWith("node_modules/") && file !== "<runtime>");
  const outside = project.filter((file) => !roots.some((root) => file.startsWith(root)) && !file.startsWith("recovered-delivery/"));
  assert.deepEqual(outside, []);
  const undeclared = project.filter((file) => {
    if (file.endsWith(".mjs")) return !existsSync(file.replace(/\.mjs$/, ".d.mts"));
    if (file.endsWith(".js") && !file.startsWith("recovered-delivery/")) return !existsSync(file.replace(/\.js$/, ".d.ts"));
    return false;
  });
  assert.deepEqual(undeclared, []);
});
