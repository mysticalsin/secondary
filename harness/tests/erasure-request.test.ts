/**
 * The erasure request is one machine. These assertions describe the wiring at the
 * current head: the clock is injected, re-apply uses that machine, and the route
 * returns that machine's outcome.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const root = new URL("../../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function between(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return src.slice(from, to);
}

test("erasure request: eraseSubject does not read the clock", () => {
  const body = between(
    source("recovered-source/worker/src/ops-rights.ts"),
    "export async function eraseSubject",
    "export async function reapplyErasures",
  );
  assert.doesNotMatch(body, /Date\.now\(\)/);
});

test("erasure request: re-apply runs the same machine", () => {
  const body = source("recovered-source/worker/src/ops-rights.ts").slice(
    source("recovered-source/worker/src/ops-rights.ts").indexOf("export async function reapplyErasures"),
  );
  assert.match(body, /runErasure\(/);
});

test("erasure request: re-apply has no second direct path", () => {
  const body = source("recovered-source/worker/src/ops-rights.ts").slice(
    source("recovered-source/worker/src/ops-rights.ts").indexOf("export async function reapplyErasures"),
  );
  assert.doesNotMatch(body, /kind === "tenant"/);
});

test("erasure request: the route returns the machine outcome", () => {
  const body = between(source("recovered-source/worker/src/ops-admin.ts"), 'r.post("/rights/erase"', "return r;");
  assert.match(body, /outcome\.status/);
  assert.doesNotMatch(body, /if \(!done\)/);
});

test("erasure request: the reducer is a state module", () => {
  assert.equal(existsSync(new URL("src/state/erasure-request.ts", root)), true);
});

const NOW = 1_700_000_000_000;

test("erasure request: legacy and unknown words decode to partial_failed, and a missing row is absent", () => {
  assert.deepEqual(decodeErasureStatus("legacy"), { tag: "partial_failed" });
  assert.deepEqual(decodeErasureStatus("unknown"), { tag: "partial_failed" });
  assert.deepEqual(decodeErasureStatus(null), { tag: "partial_failed" });
  assert.equal(decodeStepMark("legacy"), "failed");
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
  const continued = await runErasure(
    stopped,
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

test("erasure request: an unreadable clock does not start, and the module does not read one", () => {
  const refused = requireFail(commitErasure(absentErasure(), { type: "request", now: Number.NaN, steps: ["receipts"] }));
  assert.equal(refused.reason, "clock_unreadable");
  assert.doesNotMatch(source("src/state/erasure-request.ts"), /Date\.now\(\)/);
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

async function eraseApp(org: Org): Promise<{
  post: (who: Principal, at: number) => Promise<Response>;
  audits: string[];
}> {
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
              if (String(url).includes("pseudonymise"))
                return new Response(JSON.stringify({ rewritten: 1 }), { status: 200 });
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
