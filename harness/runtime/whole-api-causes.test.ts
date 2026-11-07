import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";

function tsc(project: string) {
  try {
    const stdout = execFileSync("node_modules/.bin/tsc", ["--noEmit", "--pretty", "false", "-p", project], { encoding: "utf8" });
    return { status: 0, output: stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}\n${failed.stderr ?? ""}` };
  }
}

function codes(output: string) {
  const counts: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const code = line.match(/error (TS\d+)/)?.[1];
    if (!code) continue;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

test("the snapshot command, the derived program, and the JS body check stay separate", () => {
  const before = {
    command: "npm run typecheck:worker",
    project: "tsconfig.worker.json",
    exit: 2,
    diagnostics: 119,
    codes: { TS2304: 68, TS2307: 43, TS7053: 1, TS2366: 1, TS7006: 3, TS7016: 1, TS2322: 2 },
  };
  const snapshot = tsc("tsconfig.worker.json");
  const derived = tsc("reconstruction/tsconfig.json");
  const bodies = tsc("reconstruction/tsconfig.check-js.json");
  const snapshotCodes = codes(snapshot.output);
  const bodyCodes = codes(bodies.output);
  const snapshotLines = snapshot.output.split("\n").filter((line) => line.includes("error TS"));
  assert.equal(snapshot.status, 2);
  assert.equal(snapshotLines.length, 119);
  assert.deepEqual(snapshotCodes, before.codes);
  for (const marker of [
    "recovered-source/worker/src/admin/routes.ts(910,41): error TS7053",
    "recovered-source/worker/src/agent/tools.ts(260,4): error TS2366",
    "recovered-source/worker/src/ai/planner.ts(38,33): error TS7006",
    "recovered-source/worker/src/auth/config.ts(54,11): error TS7006",
    "recovered-source/worker/src/ux/notify.ts(45,24): error TS7006",
    "recovered-source/worker/src/genui.ts(10,26): error TS7016",
    "recovered-source/worker/src/stubs.ts(33,3): error TS2322",
    "recovered-source/worker/src/stubs.ts(42,3): error TS2322",
  ]) {
    assert.equal(snapshot.output.includes(marker), true, marker);
  }
  assert.equal(derived.status, 0);
  assert.equal(derived.output.includes("error TS"), false);
  assert.equal(bodies.status, 2);
  assert.deepEqual(bodyCodes, {
    TS7006: 145,
    TS7023: 1,
    TS7024: 1,
    TS2345: 1,
    TS7034: 1,
    TS2362: 1,
    TS2363: 1,
    TS7005: 1,
    TS7031: 5,
  });
  const report = {
    before,
    after: {
      snapshot: { command: "npm run typecheck:worker", exit: snapshot.status, diagnostics: snapshotLines.length, codes: snapshotCodes },
      derivedProgram: {
        command: "tsc --noEmit -p reconstruction/tsconfig.json",
        exit: derived.status,
        diagnostics: 0,
        note: "The same recovered files that carry the 8 snapshot diagnostics contribute 0 diagnostics here because this program includes the derived Env, types.ts, agent-ui, view-plan, and validator declaration. That does not change the snapshot command.",
      },
      jsBodies: {
        command: "npm run typecheck:js-bodies",
        project: "reconstruction/tsconfig.check-js.json",
        exit: bodies.status,
        diagnostics: Object.values(bodyCodes).reduce((sum, count) => sum + count, 0),
        codes: bodyCodes,
        includedBodies: [
          "reconstruction/activity/validate.mjs",
          "reconstruction/import/policy.mjs",
          "reconstruction/ledger/object.mjs",
          "reconstruction/ledger/policy.mjs",
          "reconstruction/personal/plan.mjs",
          "reconstruction/release/identity.mjs",
          "reconstruction/release/jwks-validator.mjs",
          "reconstruction/release/routes.mjs",
          "reconstruction/ui/pages.mjs",
        ],
        notBodyChecked: ["recovered-source/worker/src/generated/view-plan.validator.js"],
      },
    },
    causes: [
      { code: "TS2304", count: 68, cause: "No interface Env exists in recovered-source or in @cloudflare/workers-types. The derived ambient is reconstruction/env.d.ts and is not part of tsconfig.worker.json." },
      { code: "TS2307", count: 43, cause: "Missing archive modules: recovered-source/worker/src/types.ts, packages/contracts/src/agent-ui/index.ts, and view-plan.ts. Derived copies exist only under reconstruction/." },
      { code: "TS7016", count: 1, file: "recovered-source/worker/src/genui.ts:10", cause: "The generated validator JavaScript is in the archive and has no declaration beside it. A derived declaration exists only under reconstruction/worker-root." },
      { code: "TS7053", count: 1, file: "recovered-source/worker/src/admin/routes.ts:910", cause: "PERSONAS resolved from @secondary/policy as a role record. s.persona is any because Session is imported from the missing types.ts. The diagnostic is absent from the derived program." },
      { code: "TS2366", count: 1, file: "recovered-source/worker/src/agent/tools.ts:260", cause: "AgentToolName does not narrow while agent-ui is unresolved. The same switch has a return for every member once that module is present." },
      { code: "TS7006", count: 3, files: ["ai/planner.ts:38", "auth/config.ts:54", "ux/notify.ts:45"], cause: "The callback parameters sit on expressions whose types are missing ViewPlan, Env, or org-role types. They are absent from the derived program." },
      { code: "TS2322", count: 2, file: "recovered-source/worker/src/stubs.ts:33 and :42", cause: "Without Env, get() is DurableObjectStub<DurableObjectBranded | undefined>, which is not DurableObjectStub<TenantPolicy> or DurableObjectStub<Workspace>. reconstruction/env.d.ts types those bindings, and the derived program accepts both assignments. stubs.ts was not edited." },
      { code: "JS-TS2345", count: 1, file: "reconstruction/activity/validate.mjs:134", cause: "@cloudflare/workers-types TextDecoderConstructorOptions does not include fatal. The Workers runtime accepts fatal: true. The call was not removed." },
      { code: "JS-implicit-any", count: 156, cause: "strict checkJs on unannotated JavaScript parameters. TS2362 and TS2363 in ledger/policy.mjs summarize() are the error type of those parameters, not a separate arithmetic bug." },
    ],
  };
  mkdirSync("reconstruction/coverage", { recursive: true });
  writeFileSync("reconstruction/coverage/cause-delta.json", `${JSON.stringify(report, null, 2)}\n`);
});
