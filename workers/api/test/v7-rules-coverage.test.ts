// The rule gate must stand on every path that writes text into a brain. The list of writers is not
// kept by hand: it is derived from the Workspace Durable Object itself (every public method that
// reaches an INSERT, UPDATE or DELETE, transitively), and the callers of each are found by scanning
// the source. A new write method, or a new place that calls one, fails here until a person decides
// whether it needs the rule gate (and adds it) or is exempt (and says why).

import { describe, expect, it } from "vitest";
import { Workspace } from "../src/index.ts";

const sources = (
  import.meta as unknown as { glob: (p: string, o: object) => Record<string, string> }
).glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });

/** A call that puts the rules in front of the write. */
const GATE =
  /(?<!function )\b(ruleGate|ruleServiceCheck|ruleDecideGuard|engineRules|shareGate|guard)\(/;

/** Public methods of the Workspace object, with their source. */
function methods(): Map<string, string> {
  const out = new Map<string, string>();
  for (let p = Workspace.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
    for (const n of Object.getOwnPropertyNames(p)) {
      if (n === "constructor" || out.has(n)) continue;
      const v = Object.getOwnPropertyDescriptor(p, n)?.value;
      if (typeof v === "function") out.set(n, Function.prototype.toString.call(v));
    }
  return out;
}

/** Methods that write, directly or through another method of the same object. */
function writers(): string[] {
  const src = methods();
  const w = new Set(
    [...src].filter(([, s]) => /\b(INSERT|UPDATE|DELETE)\b/.test(s)).map(([n]) => n),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [n, s] of src)
      if (!w.has(n) && [...s.matchAll(/this\.(\w+)\(/g)].some((m) => w.has(m[1] as string))) {
        w.add(n);
        grew = true;
      }
  }
  return [...w].sort();
}

const STORES = ["wiki/store.ts", "brains/store.ts", "workspace.ts"];
const filesOf = (): [string, string][] =>
  Object.entries(sources)
    .map(([p, s]) => [p.replace("../src/", ""), s] as [string, string])
    .filter(([f]) => !f.startsWith("rules/") && !STORES.includes(f));

const callers = (method: string): string[] =>
  filesOf()
    .filter(([, s]) => new RegExp(`\\.${method}\\(`).test(s))
    .map(([f]) => f)
    .sort();

/** Methods through which text enters a brain, and for each calling file: gated, or exempt and why. */
const INTAKE: Record<string, Record<string, string>> = {
  create: {
    "routes.ts": "gate", // contribute and promote (submitCandidate)
    "wiki/routes.ts": "gate", // meeting records
    "ux/records.ts": "gate", // account records
    "uxv2/routines.ts": "gate", // routine ingest (the personal branch writes a Personal Brain)
    "agent/index.ts":
      "exempt: saved views are personal-plane rows; their share is gated in agent/views.ts",
    "ai/budget.ts": "exempt: a usage counter, a number and no text",
    "ai/routes.ts": "exempt: a brief written to the caller's own Personal Brain",
    "uxv2/ledger.ts": "exempt: a usage ledger row, numbers and ids only",
  },
  update: {
    "ux/records.ts": "gate",
    "agent/index.ts": "exempt: a saved view in the caller's Personal Brain",
    "ux/personal.ts": "exempt: the caller's Personal Brain",
  },
  edit: {
    "routes.ts": "gate", // edit of a candidate (editGate)
    "ai/budget.ts": "exempt: a usage counter, a number and no text",
    "ai/routes.ts": "exempt: a brief in the caller's own Personal Brain",
    "uxv2/ledger.ts": "exempt: a usage ledger row, numbers and ids only",
  },
  comment: {
    "routes.ts": "exempt: a reviewer's note on an item, not brain content; it never becomes a page",
    "ux/review.ts":
      "exempt: a reviewer's note on an item, not brain content; it never becomes a page",
    "uxv2/questions.ts":
      "exempt: a reviewer's note on an item, not brain content; it never becomes a page",
  },
  wikiPropose: {
    "brains/data.ts": "gate",
    "brains/push.ts": "gate",
    "wiki/engine.ts": "gate",
    "wiki/routes.ts": "gate",
    "uxv2/questions.ts": "gate", // keep_current
  },
  wikiEditProposal: { "wiki/routes.ts": "gate" },
  wikiDecide: { "wiki/routes.ts": "gate", "uxv2/questions.ts": "gate" },
  sourceUpsert: { "connector.ts": "gate" },
  brainFieldsWrite: { "brains/data.ts": "gate" },
};

/** Writers that are not an intake of text, with the reason. */
const OTHER: Record<string, string> = {};
for (const n of [
  "alarm",
  "outbox",
  "snapshot",
  "purgeExpired",
  "wipe",
  "pseudonymise",
  "wikiPseudonymise",
  "wikiForgetSources",
  "sourcePurge",
  "sourceDelete",
])
  OTHER[n] = "maintenance, erasure or deletion: it removes or rewrites, it adds no text";
for (const n of [
  "wikiEnqueue",
  "wikiJobFinish",
  "wikiJobsDue",
  "wikiLogAppend",
  "wikiMarkRun",
  "wikiNotify",
  "wikiSourceSeen",
  "wikiSupersede",
  "wikiRefreshHashes",
  "wikiTouch",
  "wikiIndex",
  "wikiSearch",
  "reindex",
  "reindexPage",
  "wikiPage",
  "wikiReset",
  "wikiSetSchema",
  "wikiSetSettings",
  "brainSchemaAdd",
  "brainConfigSet",
  "metaSet",
  "brainSetHidden",
  "brainPurgeFields",
])
  OTHER[n] = "bookkeeping, index or configuration: no page text";
for (const n of [
  "brainMemberSet",
  "brainMemberRemove",
  "brainRuleStamp",
  "brainCoachDone",
  "brainCoachSave",
])
  OTHER[n] = "membership, rule stamp or coaching state: no page text";
for (const n of [
  "approve",
  "review",
  "keepPrevious",
  "remove",
  "retag",
  "addContribution",
  "wikiVerifyFact",
  "wikiRegisterPromotion",
  "wikiSyncPromotions",
])
  OTHER[n] = "a decision or a mark on an existing item; the text was gated when it came in";
for (const n of ["applyProposal", "savePage"])
  OTHER[n] = "internal: only wikiDecide applies a proposal, and wikiDecide is guarded";
for (const n of ["brainDaily", "brainJournalRun"])
  OTHER[n] = "a journal built from audit ids and counts by the system";
for (const n of ["seed", "wikiSeedRun"])
  OTHER[n] = "dev seed of synthetic data, refused outside dev";
for (const n of ["lensSetOptOut", "lensSavedAdd", "lensSavedRemove"])
  OTHER[n] =
    "a person's own choice (who-knows opt-out, saved searches), kept in their Personal Brain: no page text";
for (const n of ["opsKvSet", "opsRetryClaim"])
  OTHER[n] = "v7 operate bookkeeping (a setting, a retry marker keyed by event id): no page text";
OTHER.scratch = "writes personal-plane rows only; Personal Brains carry no rules";

describe("rule gate coverage, derived from the Workspace object", () => {
  it("every method that writes is classified: an intake of text or a named exception", () => {
    const derived = writers();
    const known = [...Object.keys(INTAKE), ...Object.keys(OTHER)].sort();
    expect(derived.filter((m) => !known.includes(m))).toEqual([]);
    expect(known.filter((m) => !derived.includes(m))).toEqual([]);
    for (const [m, why] of Object.entries(OTHER)) expect(why.length, m).toBeGreaterThan(10);
  });

  it("every file that calls an intake method is known, and a gated one calls a rule gate", () => {
    const files = new Map(filesOf());
    for (const [method, table] of Object.entries(INTAKE)) {
      expect(callers(method), `callers of ${method}`).toEqual(Object.keys(table).sort());
      for (const [file, how] of Object.entries(table)) {
        if (how === "gate")
          expect(GATE.test(files.get(file) ?? ""), `${method} in ${file}`).toBe(true);
        else expect(how, `${method} in ${file}`).toMatch(/^exempt: .{12,}/);
      }
    }
  });
});
