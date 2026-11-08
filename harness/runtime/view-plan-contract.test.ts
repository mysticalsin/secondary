/**
 * The missing `packages/contracts/src/view-plan.ts` class of the raw recovered-API program.
 *
 * The raw program is rebuilt from tsconfig.worker.json with the same root files and options.
 * The only change is that the one missing module is served from memory at the path the
 * recovered imports resolve to. Nothing is written to the intake directory.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";

import { planView, validateViewPlan } from "../../recovered-source/worker/src/genui.ts";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");

const DERIVED = "reconstruction/packages/contracts/src/view-plan.ts";
const BEFORE_COMMIT = "4ba133b04e49cfb20abe0a22b5ca367284456356";
const MISSING = [resolve("packages/contracts/src/view-plan.ts"), resolve("recovered-source/shared/packages/contracts/src/view-plan.ts")];
const CLASS = [
  "recovered-source/worker/src/genui.ts(9,50): TS2307",
  "recovered-source/worker/src/ai/planner.ts(7,31): TS2307",
  "recovered-source/worker/src/ai/planner.ts(38,33): TS7006",
];

const before = execFileSync("git", ["show", `${BEFORE_COMMIT}:${DERIVED}`], { encoding: "utf8" });
const after = readFileSync(DERIVED, "utf8");

function rawConfig() {
  const read = ts.readConfigFile("tsconfig.worker.json", ts.sys.readFile);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, process.cwd());
}

function diagnose(viewPlan: string | null, extraRoots: Record<string, string> = {}) {
  const parsed = rawConfig();
  const virtual = new Map<string, string>(Object.entries(extraRoots).map(([k, v]) => [resolve(k), v]));
  if (viewPlan !== null) for (const p of MISSING) virtual.set(p, viewPlan);
  const host = ts.createCompilerHost(parsed.options);
  const { fileExists, readFile, getSourceFile, realpath } = host;
  host.fileExists = (f) => virtual.has(resolve(f)) || fileExists.call(host, f);
  host.readFile = (f) => virtual.get(resolve(f)) ?? readFile.call(host, f);
  host.realpath = (f) => (virtual.has(resolve(f)) ? f : realpath ? realpath.call(host, f) : f);
  host.getSourceFile = (f, lang, onError, create) => {
    const text = virtual.get(resolve(f));
    return text !== undefined ? ts.createSourceFile(f, text, lang) : getSourceFile.call(host, f, lang, onError, create);
  };
  const program = ts.createProgram({ rootNames: [...parsed.fileNames, ...Object.keys(extraRoots).map((k) => resolve(k))], options: parsed.options, host });
  const out = ts.getPreEmitDiagnostics(program).map((d) => {
    if (!d.file) return `global: TS${d.code}`;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    return `${relative(process.cwd(), d.file.fileName)}(${line + 1},${character + 1}): TS${d.code}`;
  });
  const members = program.getSourceFiles().map((s) => relative(process.cwd(), s.fileName)).filter((f) => !f.includes("node_modules"));
  return { diagnostics: out, members };
}

test("the raw program, rebuilt unchanged, still has the historical 119", () => {
  const raw = diagnose(null);
  assert.equal(raw.diagnostics.length, 119);
  for (const d of CLASS) assert.equal(raw.diagnostics.includes(d), true, d);
  let cli = 0;
  try {
    execFileSync("node_modules/.bin/tsc", ["--noEmit", "--pretty", "false", "-p", "tsconfig.worker.json"], { encoding: "utf8" });
  } catch (error) {
    cli = (error as { status: number }).status;
    assert.equal(((error as { stdout: string }).stdout.match(/error TS/g) ?? []).length, 119);
  }
  assert.equal(cli, 2);
});

test("supplying only view-plan.ts removes exactly this class and adds nothing, before and after the correction", () => {
  const raw = diagnose(null);
  for (const [label, source] of [["before", before], ["after", after]] as const) {
    const r = diagnose(source);
    assert.equal(r.diagnostics.length, 116, `${label}: ${r.diagnostics.filter((d) => !raw.diagnostics.includes(d)).join("; ")}`);
    assert.deepEqual(raw.diagnostics.filter((d) => !r.diagnostics.includes(d)).sort(), [...CLASS].sort(), label);
    assert.deepEqual(r.diagnostics.filter((d) => !raw.diagnostics.includes(d)), [], `${label} adds no diagnostic`);
    assert.deepEqual(raw.members.filter((m) => !r.members.includes(m)), [], `${label} drops no member`);
    assert.equal(r.members.includes("packages/contracts/src/view-plan.ts") || r.members.includes("recovered-source/shared/packages/contracts/src/view-plan.ts"), true);
  }
});

test("the recovered bodies constrain the contract: a non-empty components tuple is rejected by genui.ts", () => {
  const tuple = after.replace("components: ViewPlanComponent[];", "components: NonEmpty<ViewPlanComponent>;");
  assert.notEqual(tuple, after);
  const r = diagnose(tuple);
  const added = diagnose(after).diagnostics;
  const extra = r.diagnostics.filter((d) => !added.includes(d));
  assert.deepEqual(extra.map((d) => d.replace(/\(\d+,\d+\)/, "")), ["recovered-source/worker/src/genui.ts: TS2322"]);
});

const valid: Record<string, string> = {
  tableByLens: `{ type: "Table", props: { lens: "accounts", columns: ["label"] } }`,
  tableByNode: `{ type: "Table", props: { nodeId: "n1" } }`,
  kpiMetrics: `{ type: "KpiRow", props: { metrics: ["gaps"] } }`,
  kpiNoMetrics: `{ type: "KpiRow", props: {} }`,
  stageBoard: `{ type: "StageBoard", props: {} }`,
};
const tightened: Record<string, string> = {
  tableNeitherNodeNorLens: `{ type: "Table", props: { columns: ["label"] } }`,
  emptyMetrics: `{ type: "KpiRow", props: { metrics: [] } }`,
  emptyColumns: `{ type: "Table", props: { lens: "topics", columns: [] } }`,
};
const stillRejected: Record<string, string> = {
  unknownComponent: `{ type: "Chart", props: {} }`,
  inlineRows: `{ type: "Table", props: { lens: "accounts", rows: [] } }`,
  wrongLens: `{ type: "MapMini", props: { lens: "people" } }`,
};

const caseFile = (name: string) => `harness/runtime/__view_plan_case_${name}.ts`;

function typeErrorsByCase(viewPlan: string) {
  const all = { ...valid, ...tightened, ...stillRejected };
  const roots = Object.fromEntries(Object.entries(all).map(([name, c]) => [
    caseFile(name),
    `import type { ViewPlan } from "../../packages/contracts/src/view-plan.ts";\nexport const plan: ViewPlan = { version: 1, title: "t", components: [${c}] };\n`,
  ]));
  const { diagnostics } = diagnose(viewPlan, roots);
  return (name: string) => diagnostics.filter((d) => d.startsWith(`${caseFile(name)}(`));
}

test("the corrected type matches the recovered validator where a type can, and the old type did not", () => {
  const plan = (c: string) => ({ version: 1, title: "t", components: [Function(`return (${c})`)()] });
  const was = typeErrorsByCase(before);
  const now = typeErrorsByCase(after);
  for (const [name, c] of Object.entries(valid)) {
    assert.equal(validateViewPlan(plan(c)), true, `validator accepts ${name}`);
    assert.deepEqual(was(name), [], `before accepts ${name}`);
    assert.deepEqual(now(name), [], `after accepts ${name}`);
  }
  for (const [name, c] of Object.entries(tightened)) {
    assert.equal(validateViewPlan(plan(c)), false, `validator rejects ${name}`);
    assert.deepEqual(was(name), [], `before wrongly accepted ${name}`);
    assert.notDeepEqual(now(name), [], `after rejects ${name}`);
  }
  for (const [name, c] of Object.entries(stillRejected)) {
    assert.equal(validateViewPlan(plan(c)), false, `validator rejects ${name}`);
    assert.notDeepEqual(was(name), [], `before rejects ${name}`);
    assert.notDeepEqual(now(name), [], `after rejects ${name}`);
  }
});

test("every plan the recovered planner returns passes the validator and the corrected Table rule", () => {
  const nodes = new Map([
    ["acct", { kind: "account", access: "full", level: "content" }],
    ["gov", { kind: "governance", access: "full", level: "content" }],
    ["me", { kind: "personal", access: "full", level: "content" }],
    ["lock", { kind: "topic", access: "locked", level: "content" }],
    ["topic", { kind: "topic", access: "full", level: "content" }],
    ["dept", { kind: "department", access: "full", level: "summary" }],
  ]);
  const view = { nodes } as never;
  const plans = [
    ...[...nodes.keys()].map((nodeId) => planView(view, { nodeId })),
    ...["show accounts", "governance maturity", "knowledge gaps", "review candidates", "anything else", ""].map((prompt) => planView(view, { prompt })),
  ];
  const tables = [];
  for (const p of plans) {
    assert.ok(p);
    assert.equal(validateViewPlan(p), true, JSON.stringify(p));
    for (const c of p.components) {
      if (c.type === "Table") {
        tables.push(c);
        assert.equal(c.props.nodeId !== undefined || c.props.lens !== undefined, true);
      }
      if ((c.type === "KpiRow" && c.props.metrics) || (c.type === "Table" && c.props.columns)) {
        const list = c.type === "KpiRow" ? c.props.metrics : (c as { props: { columns?: unknown[] } }).props.columns;
        assert.ok(list && list.length > 0);
      }
    }
  }
  assert.equal(tables.length, 3);
  assert.equal(planView(view, { nodeId: "nope" }), null);
});

test("the derived module path is the one recovered imports resolve to in the reconstruction layout", () => {
  const genui = resolve("reconstruction/worker-root/worker/src/genui.ts");
  const target = resolve(dirname(genui), "../../../packages/contracts/src/view-plan.ts");
  assert.equal(relative(process.cwd(), target), DERIVED);
});
