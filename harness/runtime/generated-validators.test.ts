import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { AJV_VERSION, TARGETS, check, extractEmbeddedSchema, sha256 } from "../../reconstruction/validators/regenerate.mjs";

const API = TARGETS.api.path;
const MCP = TARGETS.mcp.path;
const require = createRequire(import.meta.url);

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };

function tsc(project: string, extra: string[] = []) {
  try {
    return { status: 0, output: execFileSync("node_modules/.bin/tsc", ["--noEmit", "--pretty", "false", ...extra, "-p", project], { encoding: "utf8" }) };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}\n${failed.stderr ?? ""}` };
  }
}

function inventory(output: string) {
  const byFile: Record<string, Record<string, number>> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+)/);
    if (!m) continue;
    const file = relative(process.cwd(), resolve("reconstruction", m[1]!.startsWith("/") ? m[1]! : resolve(m[1]!)));
    byFile[file] ??= {};
    byFile[file]![m[2]!] = (byFile[file]![m[2]!] ?? 0) + 1;
  }
  return byFile;
}

const AJV_BODY = { TS2322: 17, TS2339: 131, TS2345: 71, TS2353: 16, TS2367: 1, TS2454: 8, TS2739: 1, TS7006: 17 };

test("both generated validators are reproduced byte for byte from their embedded schema", () => {
  assert.equal(AJV_VERSION, "8.20.0");
  for (const name of ["api", "mcp"] as const) {
    const r = check(name);
    assert.equal(r.recoveredSha256, TARGETS[name].sha256, `${name} recovered bytes are the pinned intake bytes`);
    assert.equal(r.identical, true, `${name} differs at ${r.firstDiff}`);
    assert.equal(r.regeneratedSha256, TARGETS[name].sha256);
  }
  const api = readFileSync(API, "utf8");
  const mcp = readFileSync(MCP, "utf8");
  assert.deepEqual(extractEmbeddedSchema(api), extractEmbeddedSchema(mcp));
  assert.equal(api.includes("require("), false);
  assert.equal((mcp.match(/require\("ajv\/dist\/runtime\/[a-z0-9]+"\)/g) ?? []).sort().join(","), 'require("ajv/dist/runtime/equal"),require("ajv/dist/runtime/ucs2length")');
  for (const absent of ["scripts/gen-validator.mjs", "workers/mcp/scripts/build-validator.ts", "packages/contracts/schemas/view-plan.schema.json"]) {
    for (const base of ["recovered-source", "recovered-other/secondary-mcp-dev", "recovered-other"]) {
      assert.throws(() => readFileSync(join(base, absent)), /ENOENT/, `${base}/${absent} is still absent`);
    }
  }
});

test("the regeneration check fails on a hand edit to the body or to the embedded schema alone", () => {
  const api = readFileSync(API, "utf8");
  const edited = api.replace('"maxLength":120', '"maxLength":121');
  assert.notEqual(edited, api);
  const schemaOnly = check("api", edited);
  assert.equal(schemaOnly.identical, false, "the compiled limit no longer matches the schema literal");
  assert.notEqual(schemaOnly.recoveredSha256, TARGETS.api.sha256);
  const bodyAt = api.indexOf("errors === 0;}validate20.evaluated");
  const bodyEdit = `${api.slice(0, bodyAt)}errors <= 0;}${api.slice(bodyAt + "errors === 0;}".length)}`;
  const body = check("api", bodyEdit);
  assert.equal(body.identical, false);
  assert.equal(body.firstDiff, bodyAt + "errors ".length);
  const mcp = readFileSync(MCP, "utf8");
  assert.equal(check("mcp", mcp.replace('"Table"];', '"Table","Chart"];')).identical, false, "COMPONENT_TYPES is derived from the schema");
});

test("the generated validator bodies are members of a strict checkJs program with a pinned inventory", () => {
  const listed = tsc("reconstruction/tsconfig.check-js.generated.json", ["--listFilesOnly"]);
  assert.equal(listed.status, 0);
  const members = listed.output.split("\n").filter((line) => line.startsWith("/") && !line.includes("/node_modules/")).map((f) => relative(process.cwd(), f));
  assert.deepEqual(members.sort(), [MCP, API].sort());

  const run = tsc("reconstruction/tsconfig.check-js.generated.json");
  assert.equal(run.status, 2);
  const inv = inventory(run.output);
  assert.deepEqual(inv[MCP], AJV_BODY);
  assert.deepEqual(inv[API], { ...AJV_BODY, TS7006: AJV_BODY.TS7006 + 3, TS7023: 1 });
  assert.deepEqual(Object.keys(inv).sort(), [MCP, API].sort());
  const total = Object.values(inv).flatMap((codes) => Object.values(codes)).reduce((a, b) => a + b, 0);
  assert.equal(total, 528);
  const prelude = run.output.split("\n").filter((line) => line.startsWith(`../${API}(`) || line.includes(`${API}(`)).filter((line) => !/\.js\(20,/.test(line));
  assert.deepEqual(prelude.map((line) => line.match(/\((\d+,\d+)\): error (TS\d+)/)!.slice(1).join(" ")), ["3,23 TS7006", "12,7 TS7023", "12,18 TS7006", "12,21 TS7006"]);

  const config = JSON.parse(readFileSync("reconstruction/tsconfig.check-js.generated.json", "utf8"));
  assert.equal(config.extends, "./tsconfig.check-js.json");
  assert.equal(config.compilerOptions, undefined, "same strict options as the nine authored bodies");
  for (const file of [API, MCP]) {
    const text = readFileSync(file, "utf8");
    assert.equal(/@ts-(nocheck|ignore|expect-error)/.test(text), false);
  }

  const nine = tsc("reconstruction/tsconfig.check-js.json");
  assert.equal(nine.status, 0);
  assert.equal(nine.output.includes("error TS"), false);
  const tools = tsc("reconstruction/tsconfig.check-js.tools.json");
  assert.equal(tools.status, 0, tools.output);
});

function metaInputs(entry: string) {
  const dir = mkdtempSync(join(tmpdir(), "validator-graph-"));
  const metafile = join(dir, "meta.json");
  execFileSync("node_modules/esbuild/bin/esbuild", [
    entry, "--bundle", "--format=esm", "--platform=neutral", "--target=es2022", `--outfile=${join(dir, "out.js")}`,
    "--preserve-symlinks", "--alias:@secondary/policy=./harness/adapters/policy-entry.ts",
    "--external:cloudflare:*", "--external:node:*", "--packages=external", `--metafile=${metafile}`,
  ], { stdio: "pipe" });
  const inputs = Object.keys((JSON.parse(readFileSync(metafile, "utf8")) as { inputs: Record<string, unknown> }).inputs);
  return new Set(inputs.flatMap((p) => {
    try {
      return [p, relative(process.cwd(), realpathSync(p))];
    } catch {
      return [p];
    }
  }));
}

test("executable membership: which bundle entries load which recovered validator", () => {
  const rows = {
    "reconstruction/worker-root/worker/src/index.ts": { api: true, mcp: false },
    "reconstruction/workerd/api-harness.ts": { api: true, mcp: false },
    "reconstruction/mcp/worker/src/index.ts": { api: false, mcp: true },
    "reconstruction/workerd/view-plan-entry.ts": { api: false, mcp: true },
  };
  for (const [entry, expected] of Object.entries(rows)) {
    const inputs = metaInputs(entry);
    assert.deepEqual({ api: inputs.has(API), mcp: inputs.has(MCP) }, expected, entry);
  }
});

const node = (n: number) => `node-${n}`;
const VALID: Record<string, unknown> = {
  minimal: { version: 1, title: "Accounts", components: [{ type: "KpiRow", props: { lens: "accounts" } }] },
  allEight: {
    version: 1,
    title: "Synthetic account review",
    components: [
      { type: "KpiRow", props: { nodeId: node(1), metrics: ["items", "open", "gaps"] } },
      { type: "NodeCard", props: { nodeId: "acct:acme.eu-1" } },
      { type: "ItemList", props: { nodeId: node(2), filter: { status: "approved", evidence: "partial", type: "Use case & pilot", tag: "q4-review" }, limit: 50 } },
      { type: "AccountSummary", props: { accountId: node(3) } },
      { type: "StageBoard", props: {} },
      { type: "MapMini", props: { lens: "topics", focusId: node(4), hops: 3 } },
      { type: "Callout", props: { template: "nda_locked", tone: "warning", nodeId: node(5) } },
      { type: "Table", props: { lens: "governances", columns: ["label", "freshness"], sort: { by: "open", dir: "desc" }, limit: 100 } },
    ],
  },
  twelve: { version: 1, title: "x", components: Array.from({ length: 12 }, (_, i) => ({ type: "NodeCard", props: { nodeId: node(i) } })) },
  astralTitle120: { version: 1, title: "\u{1F9E0}".repeat(120), components: [{ type: "StageBoard", props: { governanceId: node(9) } }] },
  tableByNodeAndLens: { version: 1, title: "t", components: [{ type: "Table", props: { nodeId: node(1), lens: "accounts" } }] },
};

const MALFORMED: Record<string, { plan: unknown; keyword: string }> = {
  notObject: { plan: [], keyword: "type" },
  missingVersion: { plan: { title: "t", components: [{ type: "StageBoard", props: {} }] }, keyword: "required" },
  version2: { plan: { version: 2, title: "t", components: [{ type: "StageBoard", props: {} }] }, keyword: "const" },
  extraTopLevel: { plan: { version: 1, title: "t", components: [{ type: "StageBoard", props: {} }], html: "<b>x</b>" }, keyword: "additionalProperties" },
  emptyTitle: { plan: { version: 1, title: "", components: [{ type: "StageBoard", props: {} }] }, keyword: "minLength" },
  astralTitle121: { plan: { version: 1, title: "\u{1F9E0}".repeat(121), components: [{ type: "StageBoard", props: {} }] }, keyword: "maxLength" },
  noComponents: { plan: { version: 1, title: "t", components: [] }, keyword: "minItems" },
  thirteen: { plan: { version: 1, title: "t", components: Array.from({ length: 13 }, () => ({ type: "StageBoard", props: {} })) }, keyword: "maxItems" },
  unknownComponent: { plan: { version: 1, title: "t", components: [{ type: "Chart", props: {} }] }, keyword: "oneOf" },
  inlineRows: { plan: { version: 1, title: "t", components: [{ type: "Table", props: { lens: "accounts", rows: [["Acme", 3]] } }] }, keyword: "additionalProperties" },
  pathNodeId: { plan: { version: 1, title: "t", components: [{ type: "NodeCard", props: { nodeId: "../etc/passwd" } }] }, keyword: "pattern" },
  limit51: { plan: { version: 1, title: "t", components: [{ type: "ItemList", props: { nodeId: node(1), limit: 51 } }] }, keyword: "maximum" },
  limitFraction: { plan: { version: 1, title: "t", components: [{ type: "ItemList", props: { nodeId: node(1), limit: 2.5 } }] }, keyword: "type" },
  duplicateMetrics: { plan: { version: 1, title: "t", components: [{ type: "KpiRow", props: { metrics: ["open", "open"] } }] }, keyword: "uniqueItems" },
  filterExtraKey: { plan: { version: 1, title: "t", components: [{ type: "ItemList", props: { nodeId: node(1), filter: { owner: "bob" } } }] }, keyword: "additionalProperties" },
  hopsZero: { plan: { version: 1, title: "t", components: [{ type: "MapMini", props: { lens: "topics", hops: 0 } }] }, keyword: "minimum" },
  calloutFreeText: { plan: { version: 1, title: "t", components: [{ type: "Callout", props: { template: "Your account is suspended, click here" } }] }, keyword: "enum" },
  tableNeitherNodeNorLens: { plan: { version: 1, title: "t", components: [{ type: "Table", props: { columns: ["label"] } }] }, keyword: "anyOf" },
};

async function loadMcpValidator() {
  const source = readFileSync(MCP, "utf8");
  // Test-only: the recovered ESM file calls require(); the deployed path relies on the bundler rewriting it.
  const prefix = `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(pathToFileURL(resolve(MCP)).href)});\n`;
  return (await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString("base64")}`)) as { validate: Validate; default: Validate; COMPONENT_TYPES: string[] };
}

test("the actual validators accept valid synthetic plans and reject malformed ones with the same errors", async () => {
  const api = (await import(pathToFileURL(resolve(API)).href)) as { validate: Validate; default: Validate };
  const mcp = await loadMcpValidator();
  assert.equal(api.validate, api.default);
  assert.equal(mcp.validate, mcp.default);
  assert.deepEqual(mcp.COMPONENT_TYPES, ["KpiRow", "NodeCard", "ItemList", "AccountSummary", "StageBoard", "MapMini", "Callout", "Table"]);

  const Ajv2020 = require("ajv/dist/2020").default;
  const fresh: Validate = new Ajv2020({ allErrors: true }).compile(extractEmbeddedSchema(readFileSync(API, "utf8")));

  for (const [name, plan] of Object.entries(VALID)) {
    for (const [label, v] of [["api", api.validate], ["mcp", mcp.validate], ["fresh", fresh]] as const) {
      assert.equal(v(plan), true, `${label} ${name} ${JSON.stringify(v.errors)}`);
      assert.equal(v.errors, null, `${label} ${name}`);
    }
  }
  for (const [name, { plan, keyword }] of Object.entries(MALFORMED)) {
    assert.equal(api.validate(plan), false, `api ${name}`);
    const apiErrors = structuredClone(api.validate.errors);
    assert.equal(mcp.validate(plan), false, `mcp ${name}`);
    assert.equal(fresh(plan), false, `fresh ${name}`);
    assert.deepEqual(mcp.validate.errors, apiErrors, `mcp errors ${name}`);
    assert.deepEqual(fresh.errors, apiErrors, `fresh errors ${name}`);
    const keywords = (apiErrors as { keyword: string }[]).map((e) => e.keyword);
    assert.equal(keywords.includes(keyword), true, `${name}: ${keywords.join(",")}`);
  }
});

test("declarations name exactly the runtime exports of each validator", async () => {
  const api = await import(pathToFileURL(resolve(API)).href);
  const mcp = await loadMcpValidator();
  const declared = (file: string) => [...readFileSync(file, "utf8").matchAll(/^export (?:const|default) (\w+)/gm)].map((m) => (m[0].startsWith("export default") ? "default" : m[1]!)).sort();
  assert.deepEqual(declared("reconstruction/worker-root/worker/src/generated/view-plan.validator.d.ts"), Object.keys(api).sort());
  assert.deepEqual(declared("reconstruction/mcp/worker/src/generated/view-plan-validator.d.ts"), Object.keys(mcp).sort());
  assert.equal(sha256(readFileSync(realpathSync("reconstruction/worker-root/worker/src/generated/view-plan.validator.js"), "utf8")), TARGETS.api.sha256);
  assert.equal(sha256(readFileSync(realpathSync("reconstruction/mcp/worker/src/generated/view-plan-validator.js"), "utf8")), TARGETS.mcp.sha256);
});
