import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");

const projects = [
  "reconstruction/tsconfig.json",
  "reconstruction/audit/tsconfig.json",
  "reconstruction/connector/tsconfig.json",
  "reconstruction/mcp/tsconfig.json",
  "reconstruction/ops/tsconfig.json",
  "reconstruction/pages/tsconfig.json",
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
  return JSON.parse(readFileSync(metafile, "utf8")) as {
    inputs: Record<string, unknown>;
    outputs: Record<string, { imports?: { path: string; external?: boolean }[] }>;
  };
}

function programFiles(configPath: string) {
  const dir = dirname(resolve(configPath));
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const files = new Set<string>();
  for (const source of program.getSourceFiles()) {
    if (source.fileName.includes("/node_modules/")) continue;
    const abs = resolve(source.fileName);
    files.add(relative(process.cwd(), abs));
    try {
      files.add(relative(process.cwd(), realpathSync(abs)));
    } catch {
      // The path is already the file the compiler opened.
    }
  }
  return files;
}

function namesOf(file: string) {
  const abs = resolve(file);
  const names = new Set([relative(process.cwd(), abs), file]);
  try {
    names.add(relative(process.cwd(), realpathSync(abs)));
  } catch {
    // Keep the bundle path when the file is generated during the build.
  }
  return names;
}

function listed(file: string, programs: Set<string>[]) {
  const names = namesOf(file);
  return programs.some((program) => [...names].some((name) => program.has(name)));
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

test("bundled TypeScript files are members of a compiler program", () => {
  const programs = projects.map((project) => programFiles(project));
  const bundled = new Set<string>();
  const external = new Set<string>();
  for (const entry of [...entries, ...textEntries]) {
    const meta = metaFor(entry);
    for (const file of Object.keys(meta.inputs)) bundled.add(file);
    for (const output of Object.values(meta.outputs)) {
      for (const item of output.imports ?? []) if (item.external) external.add(item.path);
    }
  }
  const project = [...bundled].filter((file) => !file.startsWith("node_modules/") && file !== "<runtime>").sort();
  const bundledTs = project.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const missing = bundledTs.filter((file) => !listed(file, programs)).sort();
  const staticAssets = project.filter((file) => file.startsWith("recovered-delivery/") || /\.(html|css|woff2?)$/.test(file)).sort();
  const uncheckedJs = project.filter((file) => (file.endsWith(".mjs") || file.endsWith(".js")) && !staticAssets.includes(file)).sort();
  const bodyInProgram = uncheckedJs.filter((file) => listed(file, programs));
  const castFiles = [
    "reconstruction/workerd/api-harness.ts",
    "reconstruction/release/entry.ts",
    "reconstruction/mcp/worker/src/jwt-consent.ts",
    "reconstruction/mcp/worker/src/import-entry.ts",
  ];
  const remainingCasts = castFiles.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    if (!line.includes(" as ") || line.includes(" as const")) return [];
    return [{ file, line: index + 1, text: line.trim().slice(0, 180) }];
  }));
  const report = {
    note: "TypeScript program membership covers bundled .ts files. A sibling .d.mts does not typecheck the .mjs body. The original 119-line snapshot remains a separate failing compile, and its 8 non-missing-module diagnostics are not proven to be only missing-module fallout.",
    programs: projects,
    bundledTsInProgram: bundledTs.filter((file) => listed(file, programs)).sort(),
    bundledTsMissingFromPrograms: missing,
    externalLibraries: [...external].sort(),
    staticAssets,
    uncheckedDeclaredJs: uncheckedJs.map((file) => ({
      body: file,
      bodyInProgram: false,
      declaration: file.endsWith(".mjs") ? file.replace(/\.mjs$/, ".d.mts") : file.replace(/\.js$/, ".d.ts"),
    })),
    remainingDerivedCasts: remainingCasts,
  };
  mkdirSync("reconstruction/coverage", { recursive: true });
  writeFileSync("reconstruction/coverage/bundle-programs.json", `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(missing, []);
  assert.deepEqual(bodyInProgram, []);
  assert.equal(report.uncheckedDeclaredJs.length > 0, true);
  assert.equal(readFileSync("reconstruction/workerd/api-harness.ts", "utf8").includes("as Parameters<typeof viewRecord>"), false);
  assert.equal(readFileSync("reconstruction/ledger/policy.d.mts", "utf8").includes("inputTokens: number | null"), true);
});
