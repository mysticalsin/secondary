/**
 * Red tests for SB-ERASURE-LEDGER-REPAIR. Each scenario has its own sqlite
 * file and its own principal, so the per-principal view cache cannot reuse
 * another scenario's result.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ROLES, type Org, type OrgNode, type Principal } from "../adapters/policy-entry.ts";
import { installErasureTenant } from "../runtime/fake-erasure-stub.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import {
  absentErasure,
  commitErasure,
  decodeErasureLedger,
  erasureWithGrant,
} from "../../src/state/erasure-request.ts";
import { requireOk } from "./require-ok.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
register(new URL("../runtime/erasure-stub-hook.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const root = fileURLToPath(new URL("../..", import.meta.url));

function workerModule(name: string): string {
  return `../../src/worker/${name}`;
}
const NOW = 1_700_000_000_000;
const TENANT = "tenant-a";
const KEY = "0123456789abcdef0123456789abcdef";
const GRAMMAR = "[a-z0-9][A-Za-z0-9_.:@-]{0,127}";

type LedgerRow = { status: string; ledger: string; updated_at: number };

type Host = {
  requestSecond(
    key: string,
    actor: string,
    now: number,
    email?: string,
    approvedSteps?: readonly string[],
  ): { tag: string };
};

function persona(id: string): Principal {
  return { id, email: `${id}@example.invalid`, tenantId: TENANT, roleIds: ["platform_admin"], memberships: [] };
}

function orgWith(scopes: readonly string[]): Org {
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
    roles: new Map(Object.values(ROLES).map((role) => [role.id, role])),
    links: [],
  };
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "erasure-ledger-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openPolicy(file: string): Promise<Host> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let depth = 0;
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...bindings: never[]) {
          return sql.exec(query, ...bindings);
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
    TenantPolicy: new (ctx: unknown, env: unknown) => Host;
  };
  const policy = new mod.TenantPolicy(ctx, { PSEUDONYM_KEY: KEY });
  await ready;
  installErasureTenant(policy, TENANT);
  return policy;
}

function putLedger(file: string, principalId: string, status: string, ledger: string): void {
  const db = openSqlite(file);
  db.prepare(
    `INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(principal_id) DO UPDATE SET status = excluded.status, ledger = excluded.ledger,
       updated_at = excluded.updated_at`,
  ).run(principalId, status, ledger, 5);
  db.close();
}

function readLedger(file: string, principalId: string): LedgerRow | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare("SELECT status, ledger, updated_at FROM erasure_requests WHERE principal_id = ?")
    .get(principalId) as LedgerRow | undefined;
  db.close();
  return row;
}

async function postErase(actorId: string, principalId: string, scopes: readonly string[]): Promise<Response> {
  const mod = (await import(workerModule("ops-admin.ts"))) as {
    opsAdminRoutes: (deps: { now?: () => number }) => Hono;
  };
  const who = persona(actorId);
  const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "r-ledger");
    c.set("session", { principal: who, ctx: { now: NOW }, tenantId: TENANT, org: orgWith(scopes) });
    await next();
  });
  app.route("/v1/admin", mod.opsAdminRoutes({ now: () => NOW }));
  return app.request(
    "https://api.invalid/v1/admin/rights/erase",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: principalId }),
    },
    {
      PSEUDONYM_KEY: KEY,
      AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
    },
  );
}

test("ledger repair: the erase route counts rejected company scopes and leaks no ids", async () => {
  const principalId = "p-l1";
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    const res = await postErase("ada-l1", principalId, ["c_ok", "Bad Name"]);
    const body = (await res.json()) as { error?: string; scopes?: number };
    assert.equal(res.status, 422);
    assert.equal(body.error, "invalid_scope");
    assert.equal(body.scopes, 1);
    const text = JSON.stringify(body);
    assert.equal(text.includes("Bad Name"), false);
    assert.equal(text.includes("c_ok"), false);
    assert.equal(text.includes("global"), false);
    assert.equal(readLedger(file, principalId), undefined);
  } finally {
    remove();
  }
});

test("ledger repair: one scope grammar is exported and the other copies are gone", () => {
  const files = ["src/state/erasure-request.ts", "src/worker/ops-internal.ts"];
  let copies = 0;
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    copies += text.split(GRAMMAR).length - 1;
  }
  assert.equal(copies, 1);
});

test("ledger repair: a request refuses a pending step the grammar does not place", () => {
  const opened = requireOk(
    commitErasure(absentErasure(), {
      type: "request",
      now: NOW,
      steps: ["receipts", "personal"],
    }),
  ).state;
  const step = commitErasure(opened, {
    type: "request",
    now: NOW + 1,
    steps: ["receipts", "personal", "scope:C_x"],
  });
  assert.equal(step.ok, false);
  if (!step.ok) assert.equal(step.reason, "unknown_step");
  assert.deepEqual(opened.order, ["receipts", "personal"]);
});

test("ledger repair: erasureWithGrant keeps the existing row when a step is not a plan step", () => {
  const principalId = "p-grant";
  const ledger = JSON.stringify({
    order: ["scope:C_x"],
    mark: { "scope:C_x": "pending" },
  });
  const existing = decodeErasureLedger({ status: "requested", ledger }, principalId);
  const next = erasureWithGrant(existing, {
    subject: principalId,
    requester: "ada",
    confirmer: "bea",
    steps: ["scope:C_x"],
  });
  assert.equal(next, existing);
});

test("ledger repair: a bad grant step is not written over the stored ledger", async () => {
  const principalId = "p-r1";
  const ledger = JSON.stringify({
    order: ["scope:C_x"],
    mark: { "scope:C_x": "pending" },
  });
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const first = policy.requestSecond(`erase:${principalId}`, "ada", NOW, "ada@example.invalid");
    assert.equal(first.tag, "recorded");
    const second = policy.requestSecond(
      `erase:${principalId}`,
      "bea",
      NOW + 1_000,
      "bea@example.invalid",
      ["scope:C_x"],
    );
    assert.equal(second.tag, "confirmed");
    const row = readLedger(file, principalId);
    assert.equal(row?.status, "requested");
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
  } finally {
    remove();
  }
});

test("ledger repair: a read-only report counts an unreadable legacy ledger and does not write", async () => {
  const principalId = "p-legacy";
  const ledger = JSON.stringify({
    order: ["scope:C_x"],
    mark: { "scope:C_x": "pending" },
  });
  const { file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const before = readLedger(file, principalId);
    const decoded = decodeErasureLedger(before ?? null, principalId);
    assert.equal(decoded.status.tag, "unreadable");
    const mod = await import("../../src/state/erasure-request.ts");
    const report = (mod as { reportUnreadableLedgers?: unknown }).reportUnreadableLedgers;
    assert.equal(typeof report, "function");
    const found = (
      report as (rows: readonly { principalId: string; status: string; ledger: string }[]) => {
        unreadable: number;
        principalIds: string[];
      }
    )([{ principalId, status: "requested", ledger }]);
    assert.equal(found.unreadable, 1);
    assert.deepEqual(found.principalIds, [principalId]);
    assert.equal(JSON.stringify(found).includes("C_x"), false);
    const after = readLedger(file, principalId);
    assert.equal(after?.status, before?.status);
    assert.equal(after?.ledger, before?.ledger);
    assert.equal(after?.updated_at, before?.updated_at);
  } finally {
    remove();
  }
});
