/**
 * Real doBudget().add against an in-memory workspace. workspaceStub is the
 * only stand-in. The day-counter rules stay in the recovered module.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import {
  installBudgetWorkspace,
  type BudgetRow,
  type BudgetWorkspace,
} from "../runtime/fake-workspace-stub.ts";

register(new URL("../runtime/budget-stub-hook.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const budgetModule = "../../recovered-source/worker/src/ai/budget.ts";

type Adder = {
  add(tokens: number, cap: number): Promise<number | null>;
};

function memoryWorkspace(seed?: { id: string; body: unknown }): {
  ws: BudgetWorkspace;
  row: () => BudgetRow | undefined;
  edits: () => number;
} {
  const rows = new Map<string, BudgetRow>();
  let edits = 0;
  if (seed) rows.set(seed.id, { id: seed.id, body: seed.body, revision: 1 });
  return {
    row: () => (seed ? rows.get(seed.id) : undefined),
    edits: () => edits,
    ws: {
      async get(id) {
        const row = rows.get(id);
        return row ? { id: row.id, body: row.body, revision: row.revision } : null;
      },
      async create(item) {
        if (rows.has(item.id)) return { ok: false };
        rows.set(item.id, { id: item.id, body: item.body, revision: 1 });
        return { ok: true };
      },
      async edit(id, revision, patch) {
        const row = rows.get(id);
        if (!row || row.revision !== revision) return { ok: false };
        row.body = patch.body;
        row.revision += 1;
        edits += 1;
        return { ok: true };
      },
    },
  };
}

async function spend(body: unknown, tokens: number, cap: number) {
  const day = "usage:2026-11-11";
  const store = memoryWorkspace({ id: day, body });
  installBudgetWorkspace(store.ws);
  const { doBudget } = (await import(budgetModule)) as {
    doBudget: (env: unknown, tenantId: string, now: number) => Adder;
  };
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const result = await doBudget({}, "tenant", Date.parse("2026-11-11T00:00:00Z")).add(tokens, cap);
    return { result, lines, body: store.row()?.body, edits: store.edits() };
  } finally {
    console.warn = original;
  }
}

test("doBudget refuses a corrupt day counter and does not edit it", async () => {
  const secret = "corrupt-SECRET-body";
  const bodies: unknown[] = [secret, "NaN", "-1", "-0", "1.5", "Infinity", " 12", Number.NaN, 12, -3];
  for (const body of bodies) {
    const got = await spend(body, 1, 100);
    assert.equal(got.result, null, String(body));
    assert.equal(got.edits, 0, String(body));
    assert.equal(got.body, body, String(body));
    assert.equal(got.lines.length, 1, String(body));
    assert.equal(
      got.lines[0],
      JSON.stringify({ at: "usage_unreadable", key: "usage:2026-11-11" }),
      String(body),
    );
  }
});

test("doBudget refuses a corrupt refund, counts empty as zero, and still enforces the cap", async () => {
  const secret = "refund-SECRET";
  const refund = await spend(secret, -4, Number.MAX_SAFE_INTEGER);
  assert.equal(refund.result, null);
  assert.equal(refund.edits, 0);
  assert.equal(refund.body, secret);
  assert.equal(refund.lines[0], JSON.stringify({ at: "usage_unreadable", key: "usage:2026-11-11" }));

  const empty = await spend("", 2, 10);
  assert.equal(empty.result, 2);
  assert.equal(empty.edits, 1);
  assert.equal(empty.body, "2");
  assert.equal(empty.lines.length, 0);

  const missing = memoryWorkspace();
  installBudgetWorkspace(missing.ws);
  const { doBudget } = (await import(budgetModule)) as {
    doBudget: (env: unknown, tenantId: string, now: number) => Adder;
  };
  const added = await doBudget({}, "tenant", Date.parse("2026-11-11T00:00:00Z")).add(3, 10);
  assert.equal(added, 3);
  assert.equal(missing.edits(), 1);

  const capped = await spend("8", 3, 10);
  assert.equal(capped.result, null);
  assert.equal(capped.edits, 0);
  assert.equal(capped.body, "8");
  assert.equal(capped.lines.length, 0);
});
