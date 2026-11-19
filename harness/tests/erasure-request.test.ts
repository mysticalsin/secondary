/**
 * The erasure request is one machine. Tests drive the reducer, the tenant store,
 * the erase route, and reapplyErasures. They do not scan source text.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { ROLES, type Org, type OrgNode, type Principal } from "../adapters/policy-entry.ts";
import { requireFail, requireOk } from "./require-ok.ts";
import { erasureActors, erasureCalls, erasureTenantIds, installErasureTenant } from "../runtime/fake-erasure-stub.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import {
  absentErasure,
  commitErasure,
  decodeErasure,
  decodeErasureLedger,
  decodeErasureStatus,
  decodeReceiptCursor,
  decodeReceiptErase,
  decodeStepMark,
  encodeErasure,
  erasurePlan,
  runErasure,
  scopeIdOfStep,
  stepsForRestore,
  type StoredErasure,
} from "../../src/state/erasure-request.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
register(new URL("../runtime/erasure-stub-hook.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

test("erasure request: a legacy status word is unreadable", () => {
  assert.deepEqual(decodeErasureStatus("legacy"), { tag: "unreadable" });
});

test("erasure request: an unknown status word is unreadable", () => {
  assert.deepEqual(decodeErasureStatus("unknown"), { tag: "unreadable" });
});

test("erasure request: a null status word is unreadable", () => {
  assert.deepEqual(decodeErasureStatus(null), { tag: "unreadable" });
});

test("erasure request: an unknown mark word is not stored as failed", () => {
  assert.equal(decodeStepMark("legacy"), null);
});

test("erasure request: a missing row is absent", () => {
  assert.deepEqual(decodeErasureLedger(null), absentErasure());
});

test("erasure request: corrupt JSON decodes to unreadable and keeps no steps", () => {
  const corrupt = decodeErasureLedger({ status: "completed", ledger: "not-json" });
  assert.equal(corrupt.status.tag, "unreadable");
  assert.deepEqual(corrupt.order, []);
});

test("erasure request: a completed row whose marks are not all done is unreadable", () => {
  const failedMark = decodeErasureLedger({
    status: "completed",
    ledger: JSON.stringify({ order: ["receipts"], mark: { receipts: "failed" } }),
  });
  assert.equal(failedMark.status.tag, "unreadable");
});

test("erasure request: a completed row with an empty order is unreadable", () => {
  const empty = decodeErasureLedger({
    status: "completed",
    ledger: JSON.stringify({ order: [], mark: {} }),
  });
  assert.equal(empty.status.tag, "unreadable");
});

test("erasure request: a proven partial failure stays partial_failed", () => {
  const grant = { subject: "subject-1", requester: "ada", confirmer: "bea", steps: ["receipts"] };
  const proven = decodeErasureLedger(
    {
      status: "partial_failed",
      ledger: JSON.stringify({ order: ["receipts"], mark: { receipts: "failed" }, grant }),
    },
    "subject-1",
  );
  assert.equal(proven.status.tag, "partial_failed");
  assert.deepEqual(proven.order, ["receipts"]);
  const explicit = decodeErasureLedger(
    {
      status: "partial_failed",
      ledger: JSON.stringify({
        order: ["directory"],
        mark: { directory: "failed" },
        grant: { subject: "subject-1", requester: "ada", confirmer: "bea", steps: ["directory"] },
      }),
    },
    "subject-1",
  );
  assert.equal(explicit.status.tag, "partial_failed");
  assert.equal(explicit.mark.directory, "failed");
});

test("erasure request: a mark map that is not an object is unreadable", () => {
  const row = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["directory"], mark: ["nope"] }),
  });
  assert.equal(row.status.tag, "unreadable");
  assert.deepEqual(row.order, []);
});

test("erasure request: a missing mark is unreadable", () => {
  const missing = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["directory"], mark: {} }),
  });
  assert.equal(missing.status.tag, "unreadable");
});

test("erasure request: an unknown mark word is unreadable", () => {
  const unknown = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["directory"], mark: { directory: "nope" } }),
  });
  assert.equal(unknown.status.tag, "unreadable");
});

test("erasure request: an order with an unknown step is unreadable", () => {
  const row = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["not-a-step"], mark: { "not-a-step": "pending" } }),
  });
  assert.equal(row.status.tag, "unreadable");
  assert.deepEqual(row.order, []);
});

test("erasure request: only the exact step forms are readable", () => {
  for (const id of ["receipts ", "scope:", "scope: ", "scope:../x", "Scope:c_delivery"]) {
    const row = decodeErasure({
      status: "partial_failed",
      order: [id],
      mark: { [id]: "pending" },
    });
    assert.equal(row.status.tag, "unreadable", id);
    assert.deepEqual(row.order, [], id);
  }
  const kept = decodeErasure({
    status: "partial_failed",
    order: ["receipts", "scope:c_delivery"],
    mark: { receipts: "pending", "scope:c_delivery": "pending" },
  });
  assert.deepEqual(kept.order, ["receipts", "scope:c_delivery"]);
});

test("erasure plan keeps only a scope id the step grammar accepts", () => {
  const plan = erasurePlan(["c_delivery", "bad id", "a\nb", "café", "a".repeat(129), ""]);
  assert.equal(plan.includes("scope:c_delivery"), true);
  for (const bad of ["scope:bad id", "scope:a\nb", "scope:café", `scope:${"a".repeat(129)}`, "scope:"]) {
    assert.equal(plan.includes(bad), false, bad);
  }
});

test("erasure request stores a known scope and drops a step the grammar rejects", () => {
  const opened = requireOk(
    commitErasure(absentErasure(), {
      type: "request",
      now: NOW,
      steps: ["personal", "scope:c_delivery", "scope:bad id", "scope:c_delivery\n", "not-a-step"],
    }),
  ).state;
  assert.deepEqual(opened.order, ["personal", "scope:c_delivery"]);
  assert.equal(opened.order.includes("scope:bad id"), false);
  assert.equal(opened.mark["scope:bad id"], undefined);
  assert.equal(scopeIdOfStep("scope:c_delivery"), "c_delivery");
  assert.equal(scopeIdOfStep("scope:c_delivery\n"), null);
  assert.equal(scopeIdOfStep(`scope:${"a".repeat(129)}`), null);
  assert.equal(scopeIdOfStep("scope:café"), null);
  assert.deepEqual(stepsForRestore("workspace", "bad id", "p1"), []);
  assert.deepEqual(stepsForRestore("workspace", "c_delivery", "p1"), ["scope:c_delivery"]);
  const openedAgain = requireOk(
    commitErasure(opened, {
      type: "request",
      now: NOW + 1,
      steps: ["directory", "scope:bad id", "scope:c_delivery"],
    }),
  ).state;
  assert.deepEqual(openedAgain.order, ["scope:c_delivery", "personal", "directory"]);
});

test("erasure request: a failed step stops the attempt and a resume continues it", async () => {
  const seen: string[] = [];
  const saved: StoredErasure[] = [];
  const plan = erasurePlan(["acme"]);
  const opened: Record<string, "pending"> = {};
  for (const id of plan) opened[id] = "pending";
  const stopped = await runErasure(
    {
      status: { tag: "requested" },
      order: plan,
      mark: opened,
      grant: { subject: "p1", requester: "ada", confirmer: "bea", steps: plan },
      receipts: null,
    },
    { type: "request", now: NOW, steps: plan },
    async (step) => {
      seen.push(step);
      return step !== "receipts";
    },
    async (state) => {
      saved.push(state);
    },
  );
  assert.deepEqual(seen, ["receipts"]);
  assert.equal(stopped.status.tag, "partial_failed");
  assert.equal(stopped.mark.receipts, "failed");
  assert.equal(stopped.mark.tombstone, "pending");
  const persisted = saved.filter((state) => state.status.tag === "partial_failed").at(-1);
  const reloaded = decodeErasureLedger(
    persisted ? { status: encodeErasure(persisted).status, ledger: encodeErasure(persisted).ledger } : null,
    "p1",
  );
  assert.equal(reloaded.mark.receipts, "failed");
  const continued = await runErasure(
    reloaded,
    { type: "resume", now: NOW + 1 },
    async (step) => {
      seen.push(step);
      return true;
    },
    async (state) => {
      saved.push(state);
    },
  );
  assert.equal(continued.status.tag, "completed");
  assert.deepEqual(seen, [
    "receipts",
    "receipts",
    "tombstone",
    "scope:acme",
    "personal",
    "connector",
    "directory",
  ]);
  assert.equal(saved.at(-1)?.status.tag, "completed");
});

test("erasure request: a restore reopens the restored step and leaves finished steps done", async () => {
  const finished = requireOk(
    commitErasure(absentErasure(), {
      type: "request",
      now: NOW,
      steps: ["receipts", "directory"],
    }),
  ).state;
  let current = requireOk(commitErasure(finished, { type: "resume", now: NOW })).state;
  current = requireOk(commitErasure(current, { type: "step_done", now: NOW, step: "receipts" })).state;
  current = requireOk(commitErasure(current, { type: "step_done", now: NOW, step: "directory" })).state;
  assert.equal(current.status.tag, "completed");
  const seen: string[] = [];
  const restored = await runErasure(
    current,
    { type: "restore", now: NOW + 2, steps: stepsForRestore("tenant", "tenant", "p1") },
    async (step) => {
      seen.push(step);
      return true;
    },
    async () => {},
  );
  assert.deepEqual(seen, ["directory"]);
  assert.equal(restored.mark.receipts, "done");
  assert.equal(restored.status.tag, "completed");
  assert.deepEqual(stepsForRestore("workspace", "personal:p1", "p1"), ["personal"]);
  assert.deepEqual(stepsForRestore("workspace", "personal:other", "p1"), []);
  assert.deepEqual(stepsForRestore("workspace", "acme", "p1"), ["scope:acme"]);
});

test("erasure request: an unreadable clock does not start", () => {
  const refused = requireFail(commitErasure(absentErasure(), { type: "request", now: Number.NaN, steps: ["receipts"] }));
  assert.equal(refused.reason, "clock_unreadable");
});

const TENANT = "tenant-a";
const SUBJECT = "subject-1";
const PSEUDONYM_KEY = "0123456789abcdef0123456789abcdef";

type Policy = {
  erasureLoad(principalId: string): { status: string; ledger: string } | null;
  humanIds(principalId: string, email?: string): string[];
  emailOfPrincipal(principalId: string): string | null;
  erasePrincipal(principalId: string, pseudonym: string): number;
};

type PolicyConnection = {
  prepare(query: string): { get(...args: unknown[]): unknown };
};

type OpenedPolicy = Policy & { connection: PolicyConnection };

type LedgerRow = { status: string; ledger: string; updated_at: number };

function workerModule(name: string): string {
  return `../../src/worker/${name}`;
}

function buildOrg(scopes: readonly string[]): Org {
  const nodes = new Map<string, OrgNode>();
  nodes.set("core", {
    id: "core",
    label: "Core",
    kind: "core",
    plane: "GLOBAL_NONPERSONAL",
    parentId: null,
    childIds: [...scopes],
    facts: {},
    leaf: null,
  });
  for (const id of scopes) {
    nodes.set(id, {
      id,
      label: id,
      kind: "department",
      plane: "TEAM_RESTRICTED",
      parentId: "core",
      childIds: [],
      dept: id,
      facts: {},
      leaf: null,
    });
  }
  return {
    tenantId: TENANT,
    seed: 1,
    nodes,
    roots: ["core"],
    links: [],
    roles: new Map(Object.values(ROLES).map((role) => [role.id, role])),
  };
}

function admin(id: string, email: string): Principal {
  return { id, email, tenantId: TENANT, roleIds: ["platform_admin"], memberships: [] };
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "erasure-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

type SqlHookDb = {
  prepare(query: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
};

async function openPolicy(
  file: string,
  options?: { afterSql?: (query: string, db: SqlHookDb) => void },
): Promise<OpenedPolicy> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let depth = 0;
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...bindings: never[]) {
          const result = sql.exec(query, ...bindings);
          options?.afterSql?.(query, db);
          return result;
        },
      },
      transactionSync<T>(fn: () => T): T {
        const nested = depth > 0;
        const save = `erasure_tx_${depth}`;
        if (nested) db.exec(`SAVEPOINT ${save}`);
        else db.exec("BEGIN");
        depth += 1;
        try {
          const result = fn();
          depth -= 1;
          if (nested) db.exec(`RELEASE ${save}`);
          else db.exec("COMMIT");
          return result;
        } catch (error) {
          depth -= 1;
          try {
            if (nested) db.exec(`ROLLBACK TO ${save}`);
            else db.exec("ROLLBACK");
          } catch {
            // The driver may already have closed the transaction.
          }
          throw error;
        }
      },
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  const mod = (await import(workerModule("tenant-policy.ts"))) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new mod.TenantPolicy(ctx, {
    PSEUDONYM_KEY,
    AUDIT: {
      fetch: async () => new Response(JSON.stringify({ rewritten: 1 }), { status: 200 }),
    },
  });
  await ready;
  installErasureTenant(policy);
  return Object.assign(policy, { connection: db });
}

function putLedger(file: string, status: string, ledger: string, updatedAt = 5): void {
  const db = openSqlite(file);
  db.prepare(
    `INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(principal_id) DO UPDATE SET status = excluded.status, ledger = excluded.ledger,
       updated_at = excluded.updated_at`,
  ).run(SUBJECT, status, ledger, updatedAt);
  db.close();
}

function readLedger(file: string): LedgerRow | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare("SELECT status, ledger, updated_at FROM erasure_requests WHERE principal_id = ?")
    .get(SUBJECT) as LedgerRow | undefined;
  db.close();
  return row;
}

function tombstones(file: string): number {
  const db = openSqlite(file);
  const row = db.prepare("SELECT COUNT(*) AS n FROM erasure_tombstones").get() as { n: number };
  db.close();
  return row.n;
}

function pendingErase(file: string): string | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare("SELECT requested_by FROM pending_ops WHERE key = ?")
    .get(`erase:${SUBJECT}`) as { requested_by: string } | undefined;
  db.close();
  return row?.requested_by;
}

async function eraseApp(
  org: Org,
  options?: { receipts?: boolean },
): Promise<{
  post: (who: Principal, at: number) => Promise<Response>;
  audits: string[];
}> {
  const receiptsOk = options?.receipts !== false;
  const audits: string[] = [];
  const mod = (await import(workerModule("ops-admin.ts"))) as {
    opsAdminRoutes: (deps: { now?: () => number }) => Hono;
  };
  let clock = NOW;
  let who = admin("ada", "ada@example.invalid");
  const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "r1");
    c.set("session", { principal: who, ctx: { now: clock }, tenantId: TENANT, org });
    await next();
  });
  app.route("/v1/admin", mod.opsAdminRoutes({ now: () => clock }));
  return {
    audits,
    post: async (person, at) => {
      who = person;
      clock = at;
      return app.request(
        "https://api.invalid/v1/admin/rights/erase",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ principal: SUBJECT }),
        },
        {
          PSEUDONYM_KEY,
          AUDIT: {
            fetch: async (url: string) => {
              audits.push(String(url));
              if (String(url).includes("pseudonymise")) {
                if (!receiptsOk) return new Response("no", { status: 503 });
                return new Response(JSON.stringify({ rewritten: 1 }), { status: 200 });
              }
              return new Response(null, { status: 202 });
            },
          },
        },
      );
    },
  };
}

test("erasure request: one principal cannot erase from a damaged ledger", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "completed", "not-json");
    const org = buildOrg(["acme"]);
    const { post, audits } = await eraseApp(org);
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(res.status, 202);
    const body = (await res.json()) as { status?: string; needs?: string };
    assert.equal(body.status, "pending");
    assert.equal(body.needs, "second_person");
    const row = readLedger(file);
    assert.equal(row?.ledger, "not-json");
    assert.equal(row?.updated_at, 5);
    assert.equal(tombstones(file), 0);
    assert.deepEqual(erasureCalls(), []);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    assert.equal(pendingErase(file), "ada");
  } finally {
    remove();
  }
});

test("erasure request: a second person plans a damaged ledger in full", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "completed", JSON.stringify({ order: ["receipts"], mark: { receipts: "failed" } }));
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const plan = erasurePlan(rights.companyScopes(org));
    const { post } = await eraseApp(org);
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    assert.equal(second.status, 200);
    const body = (await second.json()) as { status?: string };
    assert.equal(body.status, "erased");
    const row = readLedger(file);
    const stored = decodeErasureLedger(row ?? null, SUBJECT);
    assert.deepEqual(stored.order, plan);
    assert.equal(stored.status.tag, "completed");
    assert.equal(stored.order.every((id) => stored.mark[id] === "done"), true);
  } finally {
    remove();
  }
});

function completedLedger(order: readonly string[]): { status: string; ledger: string } {
  const mark: Record<string, "done"> = {};
  for (const id of order) mark[id] = "done";
  return encodeErasure({
    status: { tag: "completed" },
    order: [...order],
    mark,
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: [...order] },
    receipts: null,
  });
}

test("erasure request: a later company scope needs a new quorum and only that step", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const before = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const finished = completedLedger(erasurePlan(rights.companyScopes(before)));
    putLedger(file, finished.status, finished.ledger);
    const after = buildOrg(["acme", "beta"]);
    const { post, audits } = await eraseApp(after);
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    assert.equal(readLedger(file)?.ledger, finished.ledger);
    assert.equal(readLedger(file)?.updated_at, 5);
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    assert.equal(second.status, 200);
    const body = (await second.json()) as { status?: string };
    assert.equal(body.status, "erased");
    assert.deepEqual(erasureCalls(), ["pseudonymise:beta"]);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    const stored = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.equal(stored.mark["scope:beta"], "done");
    assert.equal(stored.mark.receipts, "done");
    assert.equal(stored.status.tag, "completed");
  } finally {
    remove();
  }
});

test("erasure request: a completed request with nothing new returns erased and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const finished = completedLedger(erasurePlan(rights.companyScopes(org)));
    putLedger(file, finished.status, finished.ledger);
    const { post, audits } = await eraseApp(org);
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    assert.equal(second.status, 200);
    const body = (await second.json()) as { status?: string };
    assert.equal(body.status, "erased");
    const row = readLedger(file);
    assert.equal(row?.ledger, finished.ledger);
    assert.equal(row?.updated_at, 5);
    assert.equal(row?.status, "completed");
    assert.deepEqual(erasureCalls(), []);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    assert.equal(tombstones(file), 0);
  } finally {
    remove();
  }
});

test("erasure request: a proven partial failure resumes without a second person", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const order = erasurePlan(rights.companyScopes(org));
    const stored = encodeErasure({
      status: { tag: "partial_failed" },
      order,
      mark: Object.fromEntries(order.map((id) => [id, id === "receipts" ? "failed" : "pending"])),
      grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: order },
      receipts: null,
    });
    putLedger(file, stored.status, stored.ledger);
    const { post } = await eraseApp(org);
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(res.status, 200);
    assert.equal(pendingErase(file), undefined);
    const loaded = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.equal(loaded.status.tag, "completed");
    assert.equal(loaded.mark.receipts, "done");
  } finally {
    remove();
  }
});

test("erasure request: a failed step is stored, and the next call resumes that row to completed", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const order = erasurePlan(rights.companyScopes(org));
    const mark: Record<string, "failed" | "pending"> = {};
    for (const id of order) mark[id] = id === "receipts" ? "failed" : "pending";
    const stored = encodeErasure({
      status: { tag: "partial_failed" },
      order,
      mark,
      grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: order },
      receipts: null,
    });
    putLedger(file, stored.status, stored.ledger);
    const failing = await eraseApp(org, { receipts: false });
    const stopped = await failing.post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(stopped.status, 502);
    const body = (await stopped.json()) as { error?: string; status?: string; step?: string };
    assert.equal(body.error, "erase_incomplete");
    assert.equal(body.status, "partial_failed");
    assert.equal(body.step, "receipts");
    const reloaded = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.equal(reloaded.status.tag, "partial_failed");
    assert.equal(reloaded.mark.receipts, "failed");
    const again = await eraseApp(org);
    const resumed = await again.post(admin("ada", "ada@example.invalid"), NOW + 1_000);
    assert.equal(resumed.status, 200);
    const doneBody = (await resumed.json()) as { status?: string };
    assert.equal(doneBody.status, "erased");
    const done = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.equal(done.status.tag, "completed");
    assert.equal(done.mark.receipts, "done");
  } finally {
    remove();
  }
});

test("erasure request: a tenant restore reopens directory through reapplyErasures", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
      reapplyErasures: (
        env: { PSEUDONYM_KEY?: string; AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        kind: "tenant",
        scope: string,
        now: number,
      ) => Promise<{ applied: number; skipped: string[] }>;
    };
    const finished = completedLedger(erasurePlan(rights.companyScopes(org)));
    putLedger(file, finished.status, finished.ledger);
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(SUBJECT, "subject@example.invalid");
    db.prepare(
      "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(SUBJECT, "pz_subject", "[]", NOW - 1_000, NOW + 86_400_000);
    db.close();
    const audits: string[] = [];
    const applied = await rights.reapplyErasures(
      {
        PSEUDONYM_KEY,
        AUDIT: {
          fetch: async (url: string) => {
            audits.push(String(url));
            return new Response(JSON.stringify({ rewritten: 1 }), { status: 200 });
          },
        },
      },
      TENANT,
      "tenant",
      "tenant",
      NOW,
    );
    assert.deepEqual(applied, { applied: 1, skipped: [] });
    const left = openSqlite(file);
    const person = left.prepare("SELECT id FROM principals WHERE id = ?").get(SUBJECT);
    left.close();
    assert.equal(person, undefined);
    assert.deepEqual(erasureCalls(), []);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    const row = readLedger(file);
    const stored = decodeErasureLedger(row ?? null, SUBJECT);
    assert.equal(stored.status.tag, "completed");
    assert.equal(stored.mark.receipts, "done");
    assert.equal(stored.mark.directory, "done");
    assert.equal(row?.updated_at, NOW);
    assert.notEqual(row?.updated_at, 5);
  } finally {
    remove();
  }
});

async function damageStaysPending(status: string, ledger: string): Promise<void> {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, status, ledger);
    const { post, audits } = await eraseApp(buildOrg(["acme"]));
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(res.status, 202);
    const body = (await res.json()) as { status?: string; needs?: string };
    assert.equal(body.status, "pending");
    assert.equal(body.needs, "second_person");
    const row = readLedger(file);
    assert.equal(row?.status, status);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.equal(tombstones(file), 0);
    assert.deepEqual(erasureCalls(), []);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    assert.equal(pendingErase(file), "ada");
  } finally {
    remove();
  }
}

async function damagePlansInFull(status: string, ledger: string): Promise<void> {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, status, ledger);
    const org = buildOrg(["acme"]);
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      companyScopes: (org: Org) => string[];
    };
    const plan = erasurePlan(rights.companyScopes(org));
    const { post } = await eraseApp(org);
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    assert.equal(second.status, 200);
    const body = (await second.json()) as { status?: string };
    assert.equal(body.status, "erased");
    const stored = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.deepEqual(stored.order, plan);
    assert.equal(stored.status.tag, "completed");
    assert.equal(stored.order.every((id) => stored.mark[id] === "done"), true);
  } finally {
    remove();
  }
}

const LEGACY_LEDGER = JSON.stringify({ order: ["directory"], mark: { directory: "pending" } });
const CORRUPT_MARK_LEDGER = JSON.stringify({ order: ["directory"], mark: ["nope"] });
const UNKNOWN_STEP_LEDGER = JSON.stringify({
  order: ["not-a-step"],
  mark: { "not-a-step": "pending" },
});

test("erasure request: a legacy status needs a second person and is not rewritten", async () => {
  await damageStaysPending("legacy", LEGACY_LEDGER);
});

test("erasure request: a second person replaces a legacy status with the full plan", async () => {
  await damagePlansInFull("legacy", LEGACY_LEDGER);
});

test("erasure request: a corrupt mark map needs a second person and is not rewritten", async () => {
  await damageStaysPending("partial_failed", CORRUPT_MARK_LEDGER);
});

test("erasure request: a second person replaces a corrupt mark map with the full plan", async () => {
  await damagePlansInFull("partial_failed", CORRUPT_MARK_LEDGER);
});

test("erasure request: an unknown step needs a second person and is not rewritten", async () => {
  await damageStaysPending("partial_failed", UNKNOWN_STEP_LEDGER);
});

test("erasure request: a second person replaces an unknown step with the full plan", async () => {
  await damagePlansInFull("partial_failed", UNKNOWN_STEP_LEDGER);
});

async function acmePlan(): Promise<string[]> {
  const rights = (await import(workerModule("ops-rights.ts"))) as {
    companyScopes: (org: Org) => string[];
  };
  return erasurePlan(rights.companyScopes(buildOrg(["acme"])));
}

function pendingLedger(order: readonly string[], grant?: object): string {
  const mark: Record<string, string> = {};
  for (const id of order) mark[id] = "pending";
  return JSON.stringify(grant ? { order, mark, grant } : { order, mark });
}

test("erasure request: a stored row without a grant is unreadable", () => {
  const row = decodeErasureLedger({
    status: "requested",
    ledger: JSON.stringify({ order: ["receipts"], mark: { receipts: "pending" } }),
  });
  assert.equal(row.status.tag, "unreadable");
  assert.deepEqual(row.order, []);
});

test("erasure request: a requested row without a grant needs a second person", async () => {
  await damageStaysPending("requested", pendingLedger(await acmePlan()));
});

test("erasure request: a running row without a grant needs a second person", async () => {
  await damageStaysPending("running", pendingLedger(await acmePlan()));
});

test("erasure request: one approver on the grant needs a second person", async () => {
  const plan = await acmePlan();
  await damageStaysPending(
    "requested",
    pendingLedger(plan, { subject: SUBJECT, requester: "ada", confirmer: "ada", steps: plan }),
  );
});

test("erasure request: a plan step outside the grant needs a second person", async () => {
  const plan = await acmePlan();
  await damageStaysPending(
    "requested",
    pendingLedger(plan, {
      subject: SUBJECT,
      requester: "ada",
      confirmer: "bea",
      steps: plan.filter((id) => id !== "directory"),
    }),
  );
});

test("erasure request: a valid grant resumes without a second person", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const plan = await acmePlan();
    const mark: Record<string, string> = {};
    for (const id of plan) mark[id] = id === "receipts" ? "failed" : "pending";
    putLedger(
      file,
      "partial_failed",
      JSON.stringify({
        order: plan,
        mark,
        grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: plan },
      }),
    );
    const { post } = await eraseApp(buildOrg(["acme"]));
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    const erased = (await res.json()) as { ok?: boolean; status?: string; step?: string | null };
    assert.equal(res.status, 200);
    assert.equal(erased.ok, true);
    assert.equal(erased.status, "erased");
    assert.equal(erased.step, null);
    assert.equal(pendingErase(file), undefined);
    const body = JSON.parse(readLedger(file)?.ledger ?? "{}") as { grant?: { confirmer?: string } };
    assert.equal(body.grant?.confirmer, "bea");
  } finally {
    remove();
  }
});

test("erasure request: one person asking writes no erasure row", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const { post } = await eraseApp(buildOrg(["acme"]));
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(res.status, 202);
    assert.equal(readLedger(file), undefined);
  } finally {
    remove();
  }
});

test("erasure request: reapply skips a row without a grant and runs a granted row", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const granted = "subject-granted";
    const bare = "subject-bare";
    const db = openSqlite(file);
    const insertLedger = db.prepare(
      "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, 'completed', ?, 5)",
    );
    insertLedger.run(
      granted,
      JSON.stringify({
        order: ["directory"],
        mark: { directory: "done" },
        grant: { subject: granted, requester: "ada", confirmer: "bea", steps: ["directory"] },
      }),
    );
    insertLedger.run(bare, JSON.stringify({ order: ["directory"], mark: { directory: "done" } }));
    const insertPerson = db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)");
    insertPerson.run(granted, "granted@example.invalid");
    insertPerson.run(bare, "bare@example.invalid");
    const insertStone = db.prepare(
      "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertStone.run(granted, "pz_granted", "[]", NOW - 1_000, NOW + 86_400_000);
    insertStone.run(bare, "pz_bare", "[]", NOW - 1_000, NOW + 86_400_000);
    db.close();
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      reapplyErasures: (
        env: { PSEUDONYM_KEY?: string; AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        kind: "tenant",
        scope: string,
        now: number,
      ) => Promise<number | { applied: number; skipped: readonly string[] }>;
    };
    const result = await rights.reapplyErasures(
      {
        PSEUDONYM_KEY,
        AUDIT: {
          fetch: async () => new Response(JSON.stringify({ rewritten: 1 }), { status: 200 }),
        },
      },
      TENANT,
      "tenant",
      "tenant",
      NOW,
    );
    const reported = typeof result === "object" && result !== null ? [...result.skipped] : result;
    const left = openSqlite(file);
    const barePerson = left.prepare("SELECT id FROM principals WHERE id = ?").get(bare);
    const grantedPerson = left.prepare("SELECT id FROM principals WHERE id = ?").get(granted);
    const bareRow = left
      .prepare("SELECT updated_at FROM erasure_requests WHERE principal_id = ?")
      .get(bare) as { updated_at: number } | undefined;
    left.close();
    assert.deepEqual(
      {
        skipped: reported,
        bareStillPresent: barePerson !== undefined,
        bareUpdatedAt: bareRow?.updated_at,
        grantedRemoved: grantedPerson === undefined,
      },
      {
        skipped: [bare],
        bareStillPresent: true,
        bareUpdatedAt: 5,
        grantedRemoved: true,
      },
    );
  } finally {
    remove();
  }
});

function invalidGrantLedger(principalId: string, grant: object): string {
  return JSON.stringify({
    order: ["directory", "receipts"],
    mark: { directory: "done", receipts: "done" },
    grant,
  });
}

async function reapplyPlanted(principalId: string, ledger: string): Promise<{
  skipped: unknown;
  present: boolean;
  updatedAt: number | undefined;
}> {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const db = openSqlite(file);
    db.prepare(
      "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, 'completed', ?, 5)",
    ).run(principalId, ledger);
    db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(principalId, `${principalId}@example.invalid`);
    db.prepare(
      "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(principalId, "pz", "[]", NOW - 1_000, NOW + 86_400_000);
    db.close();
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      reapplyErasures: (
        env: { AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        kind: "tenant",
        scope: string,
        now: number,
      ) => Promise<number | { applied: number; skipped: readonly string[] }>;
    };
    const result = await rights.reapplyErasures(
      { AUDIT: { fetch: async () => new Response(JSON.stringify({ rewritten: 1 }), { status: 200 }) } },
      TENANT,
      "tenant",
      "tenant",
      NOW,
    );
    const left = openSqlite(file);
    const person = left.prepare("SELECT id FROM principals WHERE id = ?").get(principalId);
    const row = left.prepare("SELECT updated_at FROM erasure_requests WHERE principal_id = ?").get(principalId) as
      | { updated_at: number }
      | undefined;
    left.close();
    return {
      skipped: typeof result === "object" && result !== null ? [...result.skipped] : result,
      present: person !== undefined,
      updatedAt: row?.updated_at,
    };
  } finally {
    remove();
  }
}

test("erasure request: reapply skips a one-approver grant and does not run it", async () => {
  const id = "subject-same";
  const seen = await reapplyPlanted(
    id,
    invalidGrantLedger(id, { subject: id, requester: "ada", confirmer: "ada", steps: ["directory", "receipts"] }),
  );
  assert.deepEqual(seen, { skipped: [id], present: true, updatedAt: 5 });
});

test("erasure request: reapply skips a grant that leaves a plan step out and does not run it", async () => {
  const id = "subject-narrow";
  const seen = await reapplyPlanted(
    id,
    invalidGrantLedger(id, { subject: id, requester: "ada", confirmer: "bea", steps: ["directory"] }),
  );
  assert.deepEqual(seen, { skipped: [id], present: true, updatedAt: 5 });
});

test("erasure request: a grant for another subject is unreadable and needs a fresh quorum", async () => {
  const plan = await acmePlan();
  const ledger = pendingLedger(plan, {
    subject: "other-subject",
    requester: "ada",
    confirmer: "bea",
    steps: plan,
  });
  const decoded = decodeErasureLedger({ status: "requested", ledger }, SUBJECT);
  assert.equal(decoded.status.tag, "unreadable");
  assert.deepEqual(decoded.order, []);
  await damageStaysPending("requested", ledger);
});

test("erasure request: a replayed confirm writes no grant and leaves the erasure row", async () => {
  const { file, remove } = tempFile();
  try {
    const ledger = JSON.stringify({ order: ["directory"], mark: { directory: "pending" } });
    let replay = false;
    await openPolicy(file, {
      afterSql(query, db) {
        if (replay && query.includes("SELECT") && query.includes("pending_ops"))
          db.prepare("DELETE FROM pending_ops WHERE key = ?").run(`erase:${SUBJECT}`);
      },
    });
    putLedger(file, "legacy", ledger);
    const { post } = await eraseApp(buildOrg(["acme"]));
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    assert.equal(readLedger(file)?.ledger, ledger);
    replay = true;
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    assert.equal(second.status, 202);
    const row = readLedger(file);
    assert.equal(row?.status, "legacy");
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.equal(row?.ledger.includes("grant"), false);
  } finally {
    remove();
  }
});

test("erasure request: a throw after the grant write keeps the ask and writes no row", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    const { post } = await eraseApp(buildOrg(["acme"]));
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(first.status, 202);
    assert.equal(pendingErase(file), "ada");
    const side = openSqlite(file);
    side.exec(
      `CREATE TRIGGER erasure_grant_boom BEFORE INSERT ON erasure_requests
       BEGIN SELECT RAISE(ABORT, 'grant_boom'); END`,
    );
    side.close();
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000).then(
      (res) => res.status,
      () => 500,
    );
    assert.equal(second >= 500, true);
    const pending = policy.connection
      .prepare("SELECT requested_by FROM pending_ops WHERE key = ?")
      .get(`erase:${SUBJECT}`) as { requested_by: string } | undefined;
    const ledger = policy.connection
      .prepare("SELECT principal_id FROM erasure_requests WHERE principal_id = ?")
      .get(SUBJECT);
    assert.equal(pending?.requested_by, "ada");
    assert.equal(ledger, undefined);
  } finally {
    remove();
  }
});

type Tombstones = OpenedPolicy & {
  tombstoneAdd(
    principalId: string,
    pseudonym: string,
    aliases: string[],
    now: number,
    expiresAt: number,
  ): void;
  tombstoneList(now: number): { principalId: string; pseudonym: string; aliases: string[] }[];
  tombstonePurge(now: number): number;
};

type StoneRow = {
  pseudonym: string;
  aliases: string;
  erased_at: number;
  expires_at: number;
};

function readStone(file: string, principalId: string): StoneRow | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare(
      "SELECT pseudonym, aliases, erased_at, expires_at FROM erasure_tombstones WHERE principal_id = ?",
    )
    .get(principalId) as StoneRow | undefined;
  db.close();
  return row ? { ...row } : undefined;
}

/** AFTER UPDATE fires only when the upsert WHERE matches. A live repeat stays at 0. */
function armTombstoneWrites(file: string): void {
  const side = openSqlite(file);
  side.exec("CREATE TABLE tombstone_writes (n INTEGER)");
  side.exec("INSERT INTO tombstone_writes VALUES (0)");
  side.exec(
    `CREATE TRIGGER count_tombstone AFTER UPDATE ON erasure_tombstones
     BEGIN UPDATE tombstone_writes SET n = n + 1; END`,
  );
  side.close();
}

function tombstoneWrites(file: string): number {
  const db = openSqlite(file);
  const writes = db.prepare("SELECT n FROM tombstone_writes").get() as { n: number };
  db.close();
  return writes.n;
}

test("erasure tombstone: a repeat keeps the original expiry and does not write", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    policy.tombstoneAdd("p", "pz", ["a@example.invalid"], 10, 100);
    armTombstoneWrites(file);
    policy.tombstoneAdd("p", "pz", ["a@example.invalid"], 10, 100);
    assert.equal(tombstoneWrites(file), 0);
    assert.deepEqual(readStone(file, "p"), {
      pseudonym: "pz",
      aliases: JSON.stringify(["a@example.invalid"]),
      erased_at: 10,
      expires_at: 100,
    });
  } finally {
    remove();
  }
});

test("erasure tombstone: a shorter request leaves every original column and does not write", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    policy.tombstoneAdd("p", "pz-first", ["a@example.invalid"], 10, 100);
    armTombstoneWrites(file);
    policy.tombstoneAdd("p", "pz-second", ["b@example.invalid"], 20, 50);
    assert.equal(tombstoneWrites(file), 0);
    assert.deepEqual(readStone(file, "p"), {
      pseudonym: "pz-first",
      aliases: JSON.stringify(["a@example.invalid"]),
      erased_at: 10,
      expires_at: 100,
    });
  } finally {
    remove();
  }
});

test("erasure tombstone: a later longer expiry does not refresh the row and does not write", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    policy.tombstoneAdd("p", "pz", ["a@example.invalid"], 10, 100);
    armTombstoneWrites(file);
    policy.tombstoneAdd("p", "pz-later", ["a@example.invalid"], 30, 400);
    assert.equal(tombstoneWrites(file), 0);
    assert.deepEqual(readStone(file, "p"), {
      pseudonym: "pz",
      aliases: JSON.stringify(["a@example.invalid"]),
      erased_at: 10,
      expires_at: 100,
    });
  } finally {
    remove();
  }
});

test("erasure tombstone: an expired row takes the new expiry and keeps the other columns", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    policy.tombstoneAdd("p", "pz-first", ["a@example.invalid"], 10, 50);
    armTombstoneWrites(file);
    policy.tombstoneAdd("p", "pz-second", ["b@example.invalid"], 80, 400);
    assert.deepEqual(
      { writes: tombstoneWrites(file), row: readStone(file, "p") },
      {
        writes: 1,
        row: {
          pseudonym: "pz-first",
          aliases: JSON.stringify(["a@example.invalid"]),
          erased_at: 10,
          expires_at: 400,
        },
      },
    );
  } finally {
    remove();
  }
});

test("erasure tombstone: a row that appears before the insert is not clobbered", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    const planted = openSqlite(file);
    planted
      .prepare(
        "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("p", "raced", "[]", 1, 900);
    planted.close();
    armTombstoneWrites(file);
    policy.tombstoneAdd("p", "pz", ["a@example.invalid"], 10, 100);
    assert.equal(tombstoneWrites(file), 0);
    assert.deepEqual(readStone(file, "p"), {
      pseudonym: "raced",
      aliases: "[]",
      erased_at: 1,
      expires_at: 900,
    });
  } finally {
    remove();
  }
});

test("erasure tombstone: an expiry equal to now is expired and one tick later stays", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as Tombstones;
    const now = 100;
    policy.tombstoneAdd("edge", "pz-edge", ["a@example.invalid"], 10, now);
    policy.tombstoneAdd("due", "pz-due", ["a@example.invalid"], 10, now);
    policy.tombstoneAdd("live", "pz-live", ["c@example.invalid"], 10, now + 1);
    const listed = policy.tombstoneList(now).map((row) => row.principalId).sort();
    assert.deepEqual(listed, ["live"]);
    armTombstoneWrites(file);
    policy.tombstoneAdd("edge", "pz-next", ["b@example.invalid"], now, 400);
    policy.tombstoneAdd("live", "pz-later", ["d@example.invalid"], now, 900);
    assert.deepEqual(
      { writes: tombstoneWrites(file), edge: readStone(file, "edge"), live: readStone(file, "live") },
      {
        writes: 1,
        edge: {
          pseudonym: "pz-edge",
          aliases: JSON.stringify(["a@example.invalid"]),
          erased_at: 10,
          expires_at: 400,
        },
        live: {
          pseudonym: "pz-live",
          aliases: JSON.stringify(["c@example.invalid"]),
          erased_at: 10,
          expires_at: now + 1,
        },
      },
    );
    assert.equal(policy.tombstonePurge(now), 1);
    assert.equal(readStone(file, "due"), undefined);
    assert.deepEqual(readStone(file, "live"), {
      pseudonym: "pz-live",
      aliases: JSON.stringify(["c@example.invalid"]),
      erased_at: 10,
      expires_at: now + 1,
    });
    assert.equal(readStone(file, "edge")?.expires_at, 400);
  } finally {
    remove();
  }
});

type ReceiptPage = { rewritten: number; cursor?: string } | "throw";

function receiptsField(ledger: string | undefined): unknown {
  if (!ledger) return null;
  try {
    const body = JSON.parse(ledger) as { receipts?: unknown };
    return body.receipts ?? null;
  } catch {
    return null;
  }
}

async function grantedLedger(receipts?: unknown): Promise<string> {
  const plan = await acmePlan();
  const mark: Record<string, string> = {};
  for (const id of plan) mark[id] = "pending";
  return JSON.stringify({
    order: plan,
    mark,
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: plan },
    ...(receipts === undefined ? {} : { receipts }),
  });
}

async function postReceipts(pages: ReceiptPage[]): Promise<{ status: number; seen: Array<string | null> }> {
  const seen: Array<string | null> = [];
  let page = 0;
  const mod = (await import(workerModule("ops-admin.ts"))) as {
    opsAdminRoutes: (deps: { now?: () => number }) => Hono;
  };
  const who = admin("ada", "ada@example.invalid");
  const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "r1");
    c.set("session", { principal: who, ctx: { now: NOW }, tenantId: TENANT, org: buildOrg(["acme"]) });
    await next();
  });
  app.route("/v1/admin", mod.opsAdminRoutes({ now: () => NOW }));
  const res = await app.request(
    "https://api.invalid/v1/admin/rights/erase",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: SUBJECT }),
    },
    {
      PSEUDONYM_KEY,
      AUDIT: {
        fetch: async (url: string, init?: { body?: string }) => {
          if (!String(url).includes("pseudonymise")) return new Response(null, { status: 202 });
          const sent = JSON.parse(init?.body ?? "{}") as { cursor?: string };
          seen.push(sent.cursor ?? null);
          const next = pages[page];
          page += 1;
          if (next === undefined || next === "throw") throw new Error("audit down");
          return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
        },
      },
    },
  );
  return { status: res.status, seen };
}

test("erasure receipts: a typed result decodes and a bad shape is rejected", () => {
  assert.deepEqual(decodeReceiptErase({ tag: "done", rewritten: 2 }), { tag: "done", rewritten: 2 });
  assert.deepEqual(decodeReceiptErase({ tag: "partial", rewritten: 1, cursor: "p2" }), {
    tag: "partial",
    rewritten: 1,
    cursor: "p2",
  });
  assert.deepEqual(decodeReceiptErase({ tag: "failed", reason: "refused", rewritten: 1, cursor: "p2" }), {
    tag: "failed",
    reason: "refused",
    rewritten: 1,
    cursor: "p2",
  });
  assert.equal(decodeReceiptErase({ tag: "done" }).tag, "rejected");
  assert.equal(decodeReceiptErase({ tag: "done", rewritten: -1 }).tag, "rejected");
  assert.equal(decodeReceiptErase({ tag: "partial", rewritten: 1, cursor: "legacy" }).tag, "rejected");
  assert.equal(decodeReceiptErase({ tag: "nope" }).tag, "rejected");
  assert.equal(decodeReceiptCursor("p2"), "p2");
  assert.equal(decodeReceiptCursor("legacy"), null);
  assert.equal(decodeReceiptCursor(2), null);
});

test("erasure receipts: a crash after a page resumes at the next page", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger());
    const pages: ReceiptPage[] = [
      { rewritten: 1, cursor: "p2" },
      "throw",
      { rewritten: 1, cursor: "p3" },
      { rewritten: 4 },
    ];
    const first = await postReceipts(pages);
    const mid = receiptsField(readLedger(file)?.ledger);
    const second = await postReceipts(pages.slice(first.seen.length));
    assert.deepEqual(
      { mid, seen: [...first.seen, ...second.seen], second: second.status },
      {
        mid: { tag: "partial", rewritten: 1, cursor: "p2" },
        seen: [null, "p2", "p2", "p3"],
        second: 200,
      },
    );
  } finally {
    remove();
  }
});

test("erasure receipts: a page that fails to save keeps the previous cursor", async () => {
  const { file, remove } = tempFile();
  try {
    let otherSaw = false;
    await openPolicy(file, {
      afterSql(query, db) {
        if (!query.includes("erasure_requests")) return;
        const row = db.prepare("SELECT ledger FROM erasure_requests WHERE principal_id = ?").get(SUBJECT) as
          | { ledger: string }
          | undefined;
        if (!row?.ledger.includes('"cursor":"p3"')) return;
        const other = openSqlite(file);
        const outside = other.prepare("SELECT ledger FROM erasure_requests WHERE principal_id = ?").get(SUBJECT) as
          | { ledger: string }
          | undefined;
        other.close();
        otherSaw = outside?.ledger.includes('"cursor":"p3"') === true;
        throw new Error("page_boom");
      },
    });
    putLedger(file, "partial_failed", await grantedLedger());
    const first = await postReceipts([
      { rewritten: 1, cursor: "p2" },
      { rewritten: 1, cursor: "p3" },
      { rewritten: 4 },
    ]);
    assert.deepEqual(
      { status: first.status, otherSaw, receipts: receiptsField(readLedger(file)?.ledger), seen: first.seen },
      {
        status: 502,
        otherSaw: false,
        receipts: { tag: "partial", rewritten: 1, cursor: "p2" },
        seen: [null, "p2"],
      },
    );
  } finally {
    remove();
  }
});

test("erasure receipts: a slow page write finishes before the ledger moves on", async () => {
  const { file, remove } = tempFile();
  const order: string[] = [];
  let inflight = 0;
  try {
    const policy = await openPolicy(file);
    const target = policy as unknown as {
      erasureSaveAtomic(
        principalId: string,
        status: string,
        ledger: string,
        updatedAt: number,
      ): void | Promise<void>;
    };
    const save = target.erasureSaveAtomic.bind(target);
    target.erasureSaveAtomic = (principalId, status, ledger, updatedAt) => {
      const page = ledger.includes('"cursor":"page-1"');
      const label = status === "partial_failed" ? "partial_failed" : page ? "page-1" : status;
      const delay = label === "page-1" ? 40 : label === "partial_failed" ? 5 : 0;
      inflight += 1;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(label);
          void Promise.resolve(save(principalId, status, ledger, updatedAt)).then(() => {
            inflight -= 1;
            resolve();
          });
        }, delay);
      });
    };
    putLedger(file, "partial_failed", await grantedLedger());
    const run = await postReceipts([{ rewritten: 1, cursor: "page-1" }]);
    assert.deepEqual(
      {
        status: run.status,
        inflight,
        order: order.filter((label) => label === "page-1" || label === "partial_failed"),
        stored: readLedger(file)?.status ?? null,
        receipts: receiptsField(readLedger(file)?.ledger),
      },
      {
        status: 502,
        inflight: 0,
        order: ["page-1", "partial_failed"],
        stored: "partial_failed",
        receipts: { tag: "partial", rewritten: 1, cursor: "page-1" },
      },
    );
  } finally {
    remove();
  }
});

test("erasure receipts: a finished scan is not run again", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "done", rewritten: 2 }));
    const run = await postReceipts([{ rewritten: 1 }]);
    assert.deepEqual({ status: run.status, seen: run.seen }, { status: 200, seen: [] });
  } finally {
    remove();
  }
});

test("erasure receipts: a malformed done result is not treated as finished", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "done" }));
    const run = await postReceipts([{ rewritten: 1 }]);
    assert.deepEqual(run.seen, [null]);
  } finally {
    remove();
  }
});

test("erasure receipts: a legacy cursor starts again and does not skip", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "partial", rewritten: 3, cursor: "legacy" }));
    const legacy = await postReceipts([{ rewritten: 1 }]);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "partial", rewritten: 3, cursor: 2 }));
    const numeric = await postReceipts([{ rewritten: 1 }]);
    assert.deepEqual({ legacy: legacy.seen, numeric: numeric.seen }, { legacy: [null], numeric: [null] });
  } finally {
    remove();
  }
});

test("erasure receipts: an empty or unknown cursor starts again", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "partial", rewritten: 3, cursor: "" }));
    const empty = await postReceipts([{ rewritten: 1 }]);
    putLedger(file, "partial_failed", await grantedLedger({ tag: "partial", rewritten: 3, cursor: "unknown" }));
    const unknown = await postReceipts([{ rewritten: 1 }]);
    assert.deepEqual(
      {
        emptyCursor: decodeReceiptCursor(""),
        unknownCursor: decodeReceiptCursor("unknown"),
        empty: empty.seen,
        unknown: unknown.seen,
      },
      { emptyCursor: null, unknownCursor: null, empty: [null], unknown: [null] },
    );
  } finally {
    remove();
  }
});

test("erasure receipts: a partial result stays partial_failed and the retry continues", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, "partial_failed", await grantedLedger());
    const pages: ReceiptPage[] = Array.from({ length: 2000 }, (_, i) => ({
      rewritten: 1,
      cursor: `c${i + 1}`,
    }));
    const first = await postReceipts(pages);
    const row = readLedger(file);
    const held = receiptsField(row?.ledger) as { tag?: string; cursor?: string; rewritten?: number } | null;
    const second = await postReceipts([{ rewritten: 1 }]);
    assert.deepEqual(
      {
        status: row?.status,
        first: first.status,
        held,
        retry: second.seen,
        resumed: second.status,
      },
      {
        status: "partial_failed",
        first: 502,
        held: { tag: "partial", rewritten: first.seen.length, cursor: `c${first.seen.length}` },
        retry: [`c${first.seen.length}`],
        resumed: 200,
      },
    );
  } finally {
    remove();
  }
});

function rowsOf(db: ReturnType<typeof openSqlite>, query: string): Record<string, unknown>[] {
  return db
    .prepare(query)
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

test("an unusable pseudonym key leaves the person, the journal, and the step, and import does not resurrect them", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = (await openPolicy(file)) as OpenedPolicy & {
      exportAll(): unknown;
      importAll(data: unknown): number;
    };
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'ada@example.invalid')").run();
    db.prepare("INSERT INTO principal_status (principal_id, active, changed_at) VALUES ('user_1', 1, 1)").run();
    db.prepare("INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'status', 'user_1', '', '', 1)").run();
    db.prepare(
      "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES ('user_1', 'requested', ?, 5)",
    ).run(
      JSON.stringify({
        order: ["directory"],
        mark: { directory: "pending" },
        grant: { subject: "user_1", requester: "ada", confirmer: "bea", steps: ["directory"] },
      }),
    );
    const journalBefore = rowsOf(db, "SELECT kind, a, b, c, v FROM security_journal");
    db.close();
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      eraseSubject: (
        env: { AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        org: Org,
        principalId: string,
        pseudonym: string,
        now: number,
      ) => Promise<{ tag?: string; reason?: string }>;
    };
    const env = {
      AUDIT: { fetch: async () => new Response(JSON.stringify({ rewritten: 1 }), { status: 200 }) },
    };
    const first = await rights.eraseSubject(env, TENANT, buildOrg(["acme"]), "user_1", "", NOW);
    const second = await rights.eraseSubject(env, TENANT, buildOrg(["acme"]), "user_1", "", NOW + 1);
    policy.importAll(policy.exportAll());
    const after = openSqlite(file);
    const person = after.prepare("SELECT id FROM principals WHERE id = 'user_1'").get() as { id: string } | undefined;
    const status = after.prepare("SELECT principal_id FROM principal_status WHERE principal_id = 'user_1'").get();
    const journal = rowsOf(after, "SELECT kind, a, b, c, v FROM security_journal");
    const stored = after
      .prepare("SELECT ledger FROM erasure_requests WHERE principal_id = 'user_1'")
      .get() as { ledger: string } | undefined;
    after.close();
    const step = stored ? (JSON.parse(stored.ledger) as { mark?: { directory?: string } }).mark?.directory ?? null : null;
    assert.deepEqual(
      {
        first: first.tag ?? null,
        firstReason: first.reason ?? null,
        second: second.tag ?? null,
        person: person?.id ?? null,
        resurrected: person == null && status != null,
        journal,
        step,
      },
      {
        first: "refused",
        firstReason: "pseudonym_key",
        second: "refused",
        person: "user_1",
        resurrected: false,
        journal: journalBefore,
        step: "pending",
      },
    );
  } finally {
    remove();
  }
});

test("reapplyErasures refuses an unusable pseudonym key and deletes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'ada@example.invalid')").run();
    db.prepare(
      "INSERT INTO memberships (principal_id, scope_type, scope_id) VALUES ('user_1', 'account', 'a_ember')",
    ).run();
    db.prepare("INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'status', 'user_1', '', '', 1)").run();
    db.prepare(
      "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES ('user_1', 'completed', ?, 5)",
    ).run(
      JSON.stringify({
        order: ["directory"],
        mark: { directory: "done" },
        grant: { subject: "user_1", requester: "ada", confirmer: "bea", steps: ["directory"] },
      }),
    );
    db.prepare(
      "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES ('user_1', 'pz_user', '[]', ?, ?)",
    ).run(NOW - 1_000, NOW + 86_400_000);
    const before = {
      person: rowsOf(db, "SELECT id, email FROM principals"),
      memberships: rowsOf(db, "SELECT principal_id, scope_type, scope_id FROM memberships"),
      journal: rowsOf(db, "SELECT kind, a, b, c, v FROM security_journal"),
      tombstones: rowsOf(db, "SELECT principal_id, pseudonym FROM erasure_tombstones"),
    };
    db.close();
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      reapplyErasures: (
        env: { AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        kind: "tenant",
        scope: string,
        now: number,
      ) => Promise<{ applied: number; skipped: string[] }>;
    };
    const env = { AUDIT: { fetch: async () => new Response(JSON.stringify({ rewritten: 1 }), { status: 200 }) } };
    const first = await rights.reapplyErasures(env, TENANT, "tenant", "tenant", NOW);
    const second = await rights.reapplyErasures(env, TENANT, "tenant", "tenant", NOW + 1);
    const after = openSqlite(file);
    const picture = {
      person: rowsOf(after, "SELECT id, email FROM principals"),
      memberships: rowsOf(after, "SELECT principal_id, scope_type, scope_id FROM memberships"),
      journal: rowsOf(after, "SELECT kind, a, b, c, v FROM security_journal"),
      tombstones: rowsOf(after, "SELECT principal_id, pseudonym FROM erasure_tombstones"),
    };
    after.close();
    assert.deepEqual(
      { first, second, picture },
      { first: { applied: 0, skipped: ["user_1"] }, second: { applied: 0, skipped: ["user_1"] }, picture: before },
    );
  } finally {
    remove();
  }
});

test("export refuses through the same key decision when the key is missing or short", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'ada@example.invalid')").run();
    db.close();
    const mod = (await import(workerModule("ops-admin.ts"))) as {
      opsAdminRoutes: (deps: { now?: () => number }) => Hono;
    };
    const org = buildOrg(["acme"]);
    const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
    app.use("*", async (c, next) => {
      c.set("requestId", "r1");
      c.set("session", {
        principal: admin("ada", "ada@example.invalid"),
        ctx: { now: NOW },
        tenantId: TENANT,
        org,
      });
      await next();
    });
    app.route("/v1/admin", mod.opsAdminRoutes({ now: () => NOW }));
    const post = (env: { PSEUDONYM_KEY?: string }) =>
      app.request(
        "https://api.invalid/v1/admin/rights/export",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ principal: "user_1" }),
        },
        env,
      );
    const missing = await post({});
    const missingAgain = await post({});
    const short = await post({ PSEUDONYM_KEY: "x".repeat(31) });
    const shortAgain = await post({ PSEUDONYM_KEY: "x".repeat(31) });
    const after = openSqlite(file);
    const picture = {
      person: rowsOf(after, "SELECT id, email FROM principals"),
      pending: rowsOf(after, "SELECT key, requested_by FROM pending_ops"),
    };
    after.close();
    assert.deepEqual(
      {
        missing: { status: missing.status, body: await missing.json() },
        missingAgain: { status: missingAgain.status, body: await missingAgain.json() },
        short: { status: short.status, body: await short.json() },
        shortAgain: { status: shortAgain.status, body: await shortAgain.json() },
        picture,
      },
      {
        missing: { status: 503, body: { error: "export_disabled" } },
        missingAgain: { status: 503, body: { error: "export_disabled" } },
        short: { status: 503, body: { error: "export_disabled" } },
        shortAgain: { status: 503, body: { error: "export_disabled" } },
        picture: { person: [{ id: "user_1", email: "ada@example.invalid" }], pending: [] },
      },
    );
  } finally {
    remove();
  }
});

test("erase route maps a missing or short key to 503 erase_disabled and writes nothing", async () => {
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES ('user_1', 'ada@example.invalid')").run();
    db.prepare(
      "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'status', 'user_1', '', '', 1)",
    ).run();
    db.close();
    const mod = (await import(workerModule("ops-admin.ts"))) as {
      opsAdminRoutes: (deps: { now?: () => number }) => Hono;
    };
    const org = buildOrg(["acme"]);
    const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
    app.use("*", async (c, next) => {
      c.set("requestId", "r1");
      c.set("session", {
        principal: admin("ada", "ada@example.invalid"),
        ctx: { now: NOW },
        tenantId: TENANT,
        org,
      });
      await next();
    });
    app.route("/v1/admin", mod.opsAdminRoutes({ now: () => NOW }));
    const post = (env: { PSEUDONYM_KEY?: string }) =>
      app.request(
        "https://api.invalid/v1/admin/rights/erase",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ principal: "user_1" }),
        },
        env,
      );
    const missing = await post({});
    const missingAgain = await post({});
    const short = await post({ PSEUDONYM_KEY: "x".repeat(31) });
    const shortAgain = await post({ PSEUDONYM_KEY: "x".repeat(31) });
    const after = openSqlite(file);
    const picture = {
      person: rowsOf(after, "SELECT id, email FROM principals"),
      journal: rowsOf(after, "SELECT kind, a, b, c FROM security_journal"),
      pending: rowsOf(after, "SELECT key, requested_by FROM pending_ops"),
      erasure: rowsOf(after, "SELECT principal_id, status FROM erasure_requests"),
    };
    after.close();
    assert.deepEqual(
      {
        missing: { status: missing.status, body: await missing.json() },
        missingAgain: { status: missingAgain.status, body: await missingAgain.json() },
        short: { status: short.status, body: await short.json() },
        shortAgain: { status: shortAgain.status, body: await shortAgain.json() },
        picture,
      },
      {
        missing: { status: 503, body: { error: "erase_disabled" } },
        missingAgain: { status: 503, body: { error: "erase_disabled" } },
        short: { status: 503, body: { error: "erase_disabled" } },
        shortAgain: { status: 503, body: { error: "erase_disabled" } },
        picture: {
          person: [{ id: "user_1", email: "ada@example.invalid" }],
          journal: [{ kind: "status", a: "user_1", b: "", c: "" }],
          pending: [],
          erasure: [],
        },
      },
    );
  } finally {
    remove();
  }
});

const SUBJECT_EMAIL = "subject.person@example.invalid";
const PLANTED_PAGE = "planted-erasure-page-body";
const CONNECTOR_SECRET = "0123456789abcdef0123456789abcdef";

function acmeOnlyOrg(): Org {
  const nodes = new Map<string, OrgNode>();
  nodes.set("acme", {
    id: "acme",
    label: "acme",
    kind: "department",
    plane: "TEAM_RESTRICTED",
    parentId: null,
    childIds: [],
    dept: "acme",
    facts: {},
    leaf: null,
  });
  return {
    tenantId: TENANT,
    seed: 1,
    nodes,
    roots: ["acme"],
    links: [],
    roles: new Map(Object.values(ROLES).map((role) => [role.id, role])),
  };
}

function directoryLedger(mark: "pending" | "done"): string {
  return JSON.stringify({
    order: ["directory"],
    mark: { directory: mark },
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: ["directory"] },
  });
}

function receiptsDoneLedger(): string {
  return JSON.stringify({
    order: ["receipts", "directory"],
    mark: { receipts: "done", directory: "pending" },
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: ["receipts", "directory"] },
  });
}

function armStepTrace(trace: string[]): void {
  const slot = globalThis as { __erasureCalls?: string[] };
  const calls = slot.__erasureCalls ?? [];
  slot.__erasureCalls = calls;
  calls.push = (...items: string[]) => {
    for (const item of items) {
      if (item.startsWith("pseudonymise:")) trace.push(`scope:${item.slice("pseudonymise:".length)}`);
      else if (item.startsWith("wipe:")) trace.push("personal");
    }
    return Array.prototype.push.apply(calls, items);
  };
}

function storedPlan(file: string): { status: string; order: string[]; mark: Record<string, string> } {
  const row = readLedger(file);
  const body = JSON.parse(row?.ledger ?? "{}") as { order?: string[]; mark?: Record<string, string> };
  return { status: row?.status ?? "", order: body.order ?? [], mark: body.mark ?? {} };
}

async function openAppendCase(
  file: string,
  trace: string[],
  mark: "pending" | "done" | "absent",
): Promise<{ org: Org; plan: string[] }> {
  await openPolicy(file, {
    afterSql(query) {
      if (query.includes("INSERT INTO erasure_tombstones")) trace.push("tombstone");
      if (query.startsWith("DELETE FROM principals")) trace.push("directory");
    },
  });
  armStepTrace(trace);
  const db = openSqlite(file);
  db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(SUBJECT, SUBJECT_EMAIL);
  db.prepare("INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (1, 'note', ?, '', ?, 1)").run(
    SUBJECT,
    PLANTED_PAGE,
  );
  db.close();
  if (mark !== "absent") putLedger(file, "requested", directoryLedger(mark));
  const org = acmeOnlyOrg();
  const rights = (await import(workerModule("ops-rights.ts"))) as {
    companyScopes: (org: Org) => string[];
  };
  return { org, plan: erasurePlan(rights.companyScopes(org)) };
}

function recordPostedTenant(
  posted: string[] | undefined,
  body: unknown,
  field: "tenant" | "tenantId",
): void {
  if (!posted || typeof body !== "string") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const value = (parsed as Record<string, unknown>)[field];
  if (typeof value === "string") posted.push(value);
}

async function eraseRoute(
  org: Org,
  trace: string[],
  posted?: string[],
): Promise<{
  post: (who: Principal, at: number, env: Record<string, unknown>) => Promise<Response>;
}> {
  const mod = (await import(workerModule("ops-admin.ts"))) as {
    opsAdminRoutes: (deps: { now?: () => number }) => Hono;
  };
  let clock = NOW;
  let who = admin("ada", "ada@example.invalid");
  const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "r1");
    c.set("session", { principal: who, ctx: { now: clock }, tenantId: TENANT, org });
    await next();
  });
  app.route("/v1/admin", mod.opsAdminRoutes({ now: () => clock }));
  return {
    post: async (person, at, env) => {
      who = person;
      clock = at;
      return app.request(
        "https://api.invalid/v1/admin/rights/erase",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ principal: SUBJECT }),
        },
        {
          ...env,
          AUDIT: {
            fetch: async (url: string, init?: { body?: unknown }) => {
              if (String(url).includes("/pseudonymise")) trace.push("receipts");
              if (String(url).includes("/pseudonymise")) {
                recordPostedTenant(posted, init?.body, "tenant");
                return new Response(JSON.stringify({ rewritten: 1 }), { status: 200 });
              }
              return new Response(null, { status: 202 });
            },
          },
        },
      );
    },
  };
}

function keyedEnv(connector: boolean, trace: string[], posted?: string[]): Record<string, unknown> {
  if (!connector) return { PSEUDONYM_KEY };
  return {
    PSEUDONYM_KEY,
    CONNECTOR_HMAC_KEY: CONNECTOR_SECRET,
    CONNECTOR: {
      fetch: async (_url: string, init?: { body?: unknown }) => {
        trace.push("connector");
        recordPostedTenant(posted, init?.body, "tenantId");
        return new Response(null, { status: 200 });
      },
    },
  };
}

test("erasure append T1: a refused no-key erase then a keyed erase stores the canonical plan", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org, plan } = await openAppendCase(file, trace, "pending");
    const before = readLedger(file);
    const { post } = await eraseRoute(org, trace);
    const refused = await post(admin("ada", "ada@example.invalid"), NOW, {});
    const afterRefusal = readLedger(file);
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: "erase_disabled" });
    assert.equal(afterRefusal?.status, before?.status);
    assert.equal(afterRefusal?.ledger, before?.ledger);
    const first = await post(admin("ada", "ada@example.invalid"), NOW + 1, keyedEnv(false, trace));
    assert.equal(first.status, 202);
    trace.length = 0;
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 2, keyedEnv(false, trace));
    const failed = storedPlan(file);
    assert.equal(second.status, 502);
    assert.deepEqual(failed.order, plan);
    assert.equal(failed.status, "partial_failed");
    assert.equal(plan[0], "receipts");
    assert.equal(plan.at(-1), "directory");
    trace.length = 0;
    const retry = await post(admin("ada", "ada@example.invalid"), NOW + 3, keyedEnv(true, trace));
    const done = storedPlan(file);
    assert.equal(retry.status, 200);
    assert.equal(done.status, "completed");
    assert.deepEqual(done.order, plan);
    assert.deepEqual(trace, ["connector", "directory"]);
    for (const step of ["receipts", "tombstone", "scope:acme", "personal"] as const)
      assert.equal(done.mark[step], "done");
  } finally {
    remove();
  }
});

test("erasure append T1b: receipts is the first step that runs", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org } = await openAppendCase(file, trace, "pending");
    const { post } = await eraseRoute(org, trace);
    const refused = await post(admin("ada", "ada@example.invalid"), NOW, {});
    assert.equal(refused.status, 503);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW + 1, keyedEnv(false, trace));
    assert.equal(pending.status, 202);
    trace.length = 0;
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 2, keyedEnv(false, trace));
    assert.equal(ran.status, 502);
    assert.equal(trace[0], "receipts");
  } finally {
    remove();
  }
});

test("erasure append T2: every step returning true stores the canonical plan and completes", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org, plan } = await openAppendCase(file, trace, "pending");
    const { post } = await eraseRoute(org, trace);
    const refused = await post(admin("ada", "ada@example.invalid"), NOW, {});
    assert.equal(refused.status, 503);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW + 1, keyedEnv(true, trace));
    assert.equal(pending.status, 202);
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 2, keyedEnv(true, trace));
    const stored = storedPlan(file);
    assert.deepEqual(stored.order, plan);
    assert.equal(stored.status, "completed");
    assert.equal(ran.status, 200);
  } finally {
    remove();
  }
});

test("erasure append T3: a done step is kept and is not run again", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org, plan } = await openAppendCase(file, trace, "done");
    const { post } = await eraseRoute(org, trace);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    assert.equal(pending.status, 202);
    trace.length = 0;
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 1, keyedEnv(true, trace));
    const stored = storedPlan(file);
    const rest = plan.filter((id) => id !== "directory");
    assert.equal(ran.status, 200);
    assert.equal(stored.status, "completed");
    assert.equal(stored.mark.directory, "done");
    assert.equal(trace.includes("directory"), false);
    assert.deepEqual(trace, rest);
    assert.deepEqual(stored.order, ["directory", ...rest]);
  } finally {
    remove();
  }
});

test("erasure append T3b: a done receipts step stays first and directory runs last", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org, plan } = await openAppendCase(file, trace, "absent");
    putLedger(file, "requested", receiptsDoneLedger());
    const { post } = await eraseRoute(org, trace);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    assert.equal(pending.status, 202);
    trace.length = 0;
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 1, keyedEnv(true, trace));
    const stored = storedPlan(file);
    const rest = plan.filter((id) => id !== "receipts");
    assert.equal(ran.status, 200);
    assert.equal(stored.status, "completed");
    assert.equal(stored.mark.receipts, "done");
    assert.equal(trace.includes("receipts"), false);
    assert.deepEqual(stored.order, ["receipts", ...rest]);
    assert.equal(stored.order.at(-1), "directory");
    assert.deepEqual(trace, rest);
  } finally {
    remove();
  }
});

test("erasure append T4: a re-plan log names steps and states and omits the key, email, and content", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  const lines: string[] = [];
  const warn = console.warn;
  const log = console.log;
  const error = console.error;
  const take = (...args: unknown[]) => {
    lines.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
  };
  console.warn = take;
  console.log = take;
  console.error = take;
  try {
    const { org } = await openAppendCase(file, trace, "pending");
    const { post } = await eraseRoute(org, trace);
    const refused = await post(admin("ada", "ada@example.invalid"), NOW, {});
    assert.equal(refused.status, 503);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW + 1, keyedEnv(false, trace));
    assert.equal(pending.status, 202);
    trace.length = 0;
    lines.length = 0;
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 2, keyedEnv(false, trace));
    assert.equal(ran.status, 502);
    const text = `${lines.join("\n")}\n${trace.join("\n")}`;
    assert.equal(text.includes(PSEUDONYM_KEY), false);
    assert.equal(text.includes(SUBJECT_EMAIL), false);
    assert.equal(text.includes(PLANTED_PAGE), false);
    assert.equal(trace[0], "receipts");
  } finally {
    console.warn = warn;
    console.log = log;
    console.error = error;
    remove();
  }
});

test("erasure append T5: an absent subject stores the canonical plan with directory last", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  try {
    const { org, plan } = await openAppendCase(file, trace, "absent");
    assert.equal(readLedger(file), undefined);
    const { post } = await eraseRoute(org, trace);
    const pending = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(false, trace));
    assert.equal(pending.status, 202);
    trace.length = 0;
    const ran = await post(admin("bea", "bea@example.invalid"), NOW + 1, keyedEnv(false, trace));
    const stored = storedPlan(file);
    assert.equal(ran.status, 502);
    assert.equal(stored.status, "partial_failed");
    assert.deepEqual(stored.order, plan);
    assert.equal(stored.order.at(-1), "directory");
    assert.equal(trace[0], "receipts");
    assert.equal(trace.includes("directory"), false);
  } finally {
    remove();
  }
});

test("erasure append T010: a pending scope the current plan omits stays and runs, and directory is last", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  const kept = erasurePlan(["acme", "beta"]);
  try {
    const { org } = await openAppendCase(file, trace, "absent");
    const mark = Object.fromEntries(kept.map((id) => [id, "pending"]));
    putLedger(
      file,
      "requested",
      JSON.stringify({
        order: kept,
        mark,
        grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: kept },
      }),
    );
    const { post } = await eraseRoute(org, trace);
    const ran = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    const stored = storedPlan(file);
    assert.equal(ran.status, 200);
    assert.equal(stored.status, "completed");
    assert.deepEqual(stored.order, kept);
    assert.deepEqual(trace, kept);
    assert.equal(stored.order.at(-1), "directory");
    assert.equal(trace.includes("scope:beta"), true);
  } finally {
    remove();
  }
});

test("erasure append T012: a kept step runs only for this principal and this tenant; this store cannot hold a second tenant", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  const otherId = "other-subject";
  const otherPage = "other-subject-page-body";
  const otherTenantId = "tenant-b";
  const kept = erasurePlan(["acme", "beta"]);
  try {
    const { org } = await openAppendCase(file, trace, "absent");
    const session = openSqlite(file);
    session.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(otherId, "other.person@example.invalid");
    session.prepare("INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (2, 'note', ?, '', ?, 1)").run(
      otherId,
      otherPage,
    );
    const otherOrder = ["personal", "scope:beta", "directory"];
    session
      .prepare(
        "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, 'requested', ?, 5)",
      )
      .run(
        otherId,
        JSON.stringify({
          order: otherOrder,
          mark: Object.fromEntries(otherOrder.map((id) => [id, "pending"])),
          grant: {
            subject: otherId,
            requester: "ada",
            confirmer: "bea",
            steps: [...new Set([...erasurePlan(["acme"]), ...otherOrder])],
          },
        }),
      );
    session.close();
    const beforeDb = openSqlite(file);
    const otherLedgerBefore = beforeDb
      .prepare("SELECT status, ledger FROM erasure_requests WHERE principal_id = ?")
      .get(otherId) as { status: string; ledger: string };
    beforeDb.close();
    putLedger(
      file,
      "requested",
      JSON.stringify({
        order: kept,
        mark: Object.fromEntries(kept.map((id) => [id, "pending"])),
        grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: kept },
      }),
    );
    const { post } = await eraseRoute(org, trace);
    const ran = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    assert.equal(ran.status, 200);
    const beta = erasureActors().filter((actor) => actor.op === "pseudonymise" && actor.scope === "beta");
    assert.deepEqual(
      beta.map((actor) => ({ tenantId: actor.tenantId, principalId: actor.principalId })),
      [{ tenantId: TENANT, principalId: SUBJECT }],
    );
    assert.equal(
      erasureActors().some((actor) => actor.principalId === otherId || actor.tenantId === otherTenantId),
      false,
    );
    const left = openSqlite(file);
    const otherPrincipal = left.prepare("SELECT id FROM principals WHERE id = ?").get(otherId);
    const otherJournal = left.prepare("SELECT c FROM security_journal WHERE a = ?").get(otherId) as { c: string };
    const otherLedger = left
      .prepare("SELECT status, ledger FROM erasure_requests WHERE principal_id = ?")
      .get(otherId) as { status: string; ledger: string };
    const otherStamp = left
      .prepare("SELECT ledger, updated_at FROM erasure_requests WHERE principal_id = ?")
      .get(otherId) as { ledger: string; updated_at: number };
    left.close();
    assert.equal((otherPrincipal as { id: string } | undefined)?.id, otherId);
    assert.equal(otherJournal.c, otherPage);
    assert.deepEqual(otherLedger, otherLedgerBefore);
    assert.equal(otherStamp.updated_at, 5);
    assert.equal(otherStamp.ledger, otherLedgerBefore.ledger);
    assert.deepEqual(
      (JSON.parse(otherStamp.ledger) as { order: string[] }).order,
      (JSON.parse(otherLedgerBefore.ledger) as { order: string[] }).order,
    );
  } finally {
    remove();
  }
});

test("erasure append T013: a failed scope the current plan omits is retried before the erase completes", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  const kept = erasurePlan(["acme", "beta"]);
  const mark = Object.fromEntries(kept.map((id) => [id, "pending"]));
  mark["scope:beta"] = "failed";
  try {
    const { org } = await openAppendCase(file, trace, "absent");
    putLedger(
      file,
      "partial_failed",
      JSON.stringify({
        order: kept,
        mark,
        grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: kept },
      }),
    );
    const { post } = await eraseRoute(org, trace);
    const ran = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    const stored = storedPlan(file);
    assert.equal(ran.status, 200);
    assert.deepEqual(stored.order, kept);
    assert.equal(trace.includes("scope:beta"), true);
    assert.equal(stored.mark["scope:beta"], "done");
    assert.equal(stored.status, "completed");
    assert.equal(stored.order.at(-1), "directory");
  } finally {
    remove();
  }
});

test("erasure append T016: a pending scope reshuffles before personal and the full order is pinned", async () => {
  const { file, remove } = tempFile();
  const trace: string[] = [];
  const storedOrder = ["personal", "scope:x", "directory"];
  const expected = ["receipts", "tombstone", "scope:acme", "scope:x", "personal", "connector", "directory"];
  try {
    const { org, plan } = await openAppendCase(file, trace, "absent");
    const mark = Object.fromEntries(storedOrder.map((id) => [id, "pending"]));
    putLedger(
      file,
      "requested",
      JSON.stringify({
        order: storedOrder,
        mark,
        grant: {
          subject: SUBJECT,
          requester: "ada",
          confirmer: "bea",
          steps: [...new Set([...plan, ...storedOrder])],
        },
      }),
    );
    const { post } = await eraseRoute(org, trace);
    const ran = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace));
    const stored = storedPlan(file);
    assert.equal(ran.status, 200);
    assert.deepEqual(stored.order, expected);
    assert.deepEqual(trace, expected);
  } finally {
    remove();
  }
});

test("erasure append T017: an erase of tenant-a leaves tenant-b's store unchanged and every resolver call names tenant-a", async () => {
  const storeA = tempFile();
  const storeB = tempFile();
  const trace: string[] = [];
  const otherTenant = "tenant-b";
  const plan = erasurePlan(["acme"]);
  const kept = JSON.stringify({
    order: plan,
    mark: Object.fromEntries(plan.map((id) => [id, "pending"])),
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: plan },
  });
  const otherLedger = JSON.stringify({
    order: ["directory"],
    mark: { directory: "pending" },
    grant: { subject: SUBJECT, requester: "ada", confirmer: "bea", steps: [...plan, "directory"] },
  });
  try {
    const policyA = await openPolicy(storeA.file, {
      afterSql(query) {
        if (query.includes("INSERT INTO erasure_tombstones")) trace.push("tombstone");
        if (query.startsWith("DELETE FROM principals")) trace.push("directory");
      },
    });
    armStepTrace(trace);
    const seedA = openSqlite(storeA.file);
    seedA.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(SUBJECT, SUBJECT_EMAIL);
    seedA.close();
    putLedger(storeA.file, "requested", kept);
    const policyB = await openPolicy(storeB.file);
    const seedB = openSqlite(storeB.file);
    seedB.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(SUBJECT, "b-only@example.invalid");
    seedB
      .prepare(
        "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, 'b-stone', ?, 4, 8)",
      )
      .run(SUBJECT, JSON.stringify(["b-only@example.invalid"]));
    seedB
      .prepare("INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (3, 'note', ?, 'b-field', 'b-journal', 1)")
      .run(SUBJECT);
    seedB
      .prepare(
        "INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, 'requested', ?, 9)",
      )
      .run(SUBJECT, otherLedger);
    seedB.close();
    installErasureTenant(policyA, TENANT);
    installErasureTenant(policyB, otherTenant);
    const before = erasureTable(storeB.file);
    const beforeStore = tenantStore(storeB.file);
    const posted: string[] = [];
    const { post } = await eraseRoute(acmeOnlyOrg(), trace, posted);
    const ran = await post(admin("ada", "ada@example.invalid"), NOW, keyedEnv(true, trace, posted));
    const after = erasureTable(storeB.file);
    const afterStore = tenantStore(storeB.file);
    assert.equal(ran.status, 200);
    assert.deepEqual(after, before);
    assert.equal(after[0]?.ledger, before[0]?.ledger);
    assert.equal(after[0]?.updated_at, before[0]?.updated_at);
    assert.equal(after[0]?.updated_at, 9);
    assert.equal(beforeStore.principals.length, 1);
    assert.equal(beforeStore.principals[0]?.email, "b-only@example.invalid");
    assert.equal(beforeStore.tombstones.length, 1);
    assert.equal(beforeStore.tombstones[0]?.pseudonym, "b-stone");
    assert.equal(beforeStore.journal.length, 1);
    assert.equal(beforeStore.journal[0]?.c, "b-journal");
    assert.deepEqual(afterStore, beforeStore);
    assert.equal(erasureTenantIds().length > 0, true);
    assert.equal(
      erasureTenantIds().every((id) => id === TENANT),
      true,
    );
    assert.equal(posted.length >= 2, true);
    assert.deepEqual(
      posted,
      posted.map(() => TENANT),
    );
  } finally {
    storeA.remove();
    storeB.remove();
  }
});

function tenantStore(file: string): {
  requests: Record<string, unknown>[];
  principals: Record<string, unknown>[];
  tombstones: Record<string, unknown>[];
  journal: Record<string, unknown>[];
} {
  const db = openSqlite(file);
  const snap = {
    requests: rowsOf(
      db,
      "SELECT principal_id, status, ledger, updated_at FROM erasure_requests ORDER BY principal_id",
    ),
    principals: rowsOf(db, "SELECT id, email FROM principals ORDER BY id"),
    tombstones: rowsOf(
      db,
      "SELECT principal_id, pseudonym, aliases, erased_at, expires_at FROM erasure_tombstones ORDER BY principal_id",
    ),
    journal: rowsOf(db, "SELECT seq, at, kind, a, b, c, v FROM security_journal ORDER BY seq"),
  };
  db.close();
  return snap;
}

function erasureTable(file: string): { principal_id: string; status: string; ledger: string; updated_at: number }[] {
  const db = openSqlite(file);
  const rows = db
    .prepare(
      "SELECT principal_id, status, ledger, updated_at FROM erasure_requests ORDER BY principal_id",
    )
    .all() as { principal_id: string; status: string; ledger: string; updated_at: number }[];
  db.close();
  return rows.map((row) => ({
    principal_id: row.principal_id,
    status: row.status,
    ledger: row.ledger,
    updated_at: row.updated_at,
  }));
}
