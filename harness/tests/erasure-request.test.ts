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
import { erasureCalls, installErasureTenant } from "../runtime/fake-erasure-stub.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import {
  absentErasure,
  commitErasure,
  decodeErasureLedger,
  decodeErasureStatus,
  decodeStepMark,
  encodeErasure,
  erasurePlan,
  runErasure,
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
  const proven = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["receipts"], mark: { receipts: "failed" } }),
  });
  assert.equal(proven.status.tag, "partial_failed");
  assert.deepEqual(proven.order, ["receipts"]);
  const explicit = decodeErasureLedger({
    status: "partial_failed",
    ledger: JSON.stringify({ order: ["directory"], mark: { directory: "failed" } }),
  });
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

test("erasure request: a failed step stops the attempt and a resume continues it", async () => {
  const seen: string[] = [];
  const saved: StoredErasure[] = [];
  const stopped = await runErasure(
    absentErasure(),
    { type: "request", now: NOW, steps: erasurePlan(["acme"]) },
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
  erasePrincipal(principalId: string): number;
};

type LedgerRow = { status: string; ledger: string; updated_at: number };

function workerModule(name: string): string {
  return `../../recovered-source/worker/src/${name}`;
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

async function openPolicy(file: string): Promise<Policy> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql,
      transactionSync<T>(fn: () => T): T {
        return fn();
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
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  installErasureTenant(policy);
  return policy;
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
    const stored = decodeErasureLedger(row ?? null);
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
  return encodeErasure({ status: { tag: "completed" }, order: [...order], mark });
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
    const stored = decodeErasureLedger(readLedger(file) ?? null);
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
    });
    putLedger(file, stored.status, stored.ledger);
    const { post } = await eraseApp(org);
    const res = await post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(res.status, 200);
    assert.equal(pendingErase(file), undefined);
    const loaded = decodeErasureLedger(readLedger(file) ?? null);
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
    const stored = encodeErasure({ status: { tag: "partial_failed" }, order, mark });
    putLedger(file, stored.status, stored.ledger);
    const failing = await eraseApp(org, { receipts: false });
    const stopped = await failing.post(admin("ada", "ada@example.invalid"), NOW);
    assert.equal(stopped.status, 502);
    const body = (await stopped.json()) as { error?: string; status?: string; step?: string };
    assert.equal(body.error, "erase_incomplete");
    assert.equal(body.status, "partial_failed");
    assert.equal(body.step, "receipts");
    const reloaded = decodeErasureLedger(readLedger(file) ?? null);
    assert.equal(reloaded.status.tag, "partial_failed");
    assert.equal(reloaded.mark.receipts, "failed");
    const again = await eraseApp(org);
    const resumed = await again.post(admin("ada", "ada@example.invalid"), NOW + 1_000);
    assert.equal(resumed.status, 200);
    const doneBody = (await resumed.json()) as { status?: string };
    assert.equal(doneBody.status, "erased");
    const done = decodeErasureLedger(readLedger(file) ?? null);
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
        env: { AUDIT: { fetch: (url: string) => Promise<Response> } },
        tenantId: string,
        kind: "tenant",
        scope: string,
        now: number,
      ) => Promise<number>;
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
    assert.equal(applied, 1);
    const left = openSqlite(file);
    const person = left.prepare("SELECT id FROM principals WHERE id = ?").get(SUBJECT);
    left.close();
    assert.equal(person, undefined);
    assert.deepEqual(erasureCalls(), []);
    assert.equal(audits.some((url) => url.includes("pseudonymise")), false);
    const row = readLedger(file);
    const stored = decodeErasureLedger(row ?? null);
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
    const stored = decodeErasureLedger(readLedger(file) ?? null);
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
