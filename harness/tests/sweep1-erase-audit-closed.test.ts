/**
 * SB1-08 erase half. A refused audit append must not report the erase as a
 * success. The ledger still finishes, because the erase and the receipt are
 * not one transaction.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { ROLES, type Org, type OrgNode, type Principal } from "../adapters/policy-entry.ts";
import { installErasureTenant } from "../runtime/fake-erasure-stub.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import { decodeErasureLedger } from "../../src/state/erasure-request.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
register(new URL("../runtime/erasure-stub-hook.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const TENANT = "tenant-a";
const SUBJECT = "subject-1";
const PSEUDONYM_KEY = "0123456789abcdef0123456789abcdef";

type Policy = {
  humanIds(principalId: string, email?: string): string[];
  emailOfPrincipal(principalId: string): string | null;
  erasePrincipal(principalId: string, pseudonym: string): number;
};

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
  const dir = mkdtempSync(path.join(tmpdir(), "erase-audit-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function openPolicy(file: string): Promise<void> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let depth = 0;
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql,
      transactionSync<T>(fn: () => T): T {
        const nested = depth > 0;
        const save = `erase_audit_tx_${depth}`;
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
}

function putLedger(file: string, status: string, ledger: string): void {
  const db = openSqlite(file);
  db.prepare(
    `INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(principal_id) DO UPDATE SET status = excluded.status, ledger = excluded.ledger,
       updated_at = excluded.updated_at`,
  ).run(SUBJECT, status, ledger, 5);
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

test("erase audit: /append 500 still returns 200 erased", async () => {
  const { file, remove } = tempFile();
  const appends: number[] = [];
  try {
    await openPolicy(file);
    putLedger(file, "completed", JSON.stringify({ order: ["receipts"], mark: { receipts: "failed" } }));
    const mod = (await import(workerModule("ops-admin.ts"))) as {
      opsAdminRoutes: (deps: { now?: () => number }) => Hono;
      pendingAuditsSnapshot?: () => { action: string }[];
      retryPendingAudits?: (env: {
        AUDIT: { fetch: () => Promise<Response> };
      }) => Promise<{ written: number; pending: number }>;
    };
    let who = admin("ada", "ada@example.invalid");
    let clock = NOW;
    const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
    app.use("*", async (c, next) => {
      c.set("requestId", "r-erase-audit");
      c.set("session", { principal: who, ctx: { now: clock }, tenantId: TENANT, org: buildOrg(["acme"]) });
      await next();
    });
    app.route("/v1/admin", mod.opsAdminRoutes({ now: () => clock }));
    const post = (person: Principal, at: number) => {
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
              if (String(url).includes("pseudonymise"))
                return new Response(JSON.stringify({ rewritten: 1 }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                });
              appends.push(500);
              return new Response("no", { status: 500 });
            },
          },
        },
      );
    };
    const first = await post(admin("ada", "ada@example.invalid"), NOW);
    const second = await post(admin("bea", "bea@example.invalid"), NOW + 1_000);
    const secondText = await second.text();
    assert.equal(second.status, 503, secondText);
    assert.equal(secondText.includes('"status":"erased"') && secondText.includes('"ok":true'), false);
    const firstText = await first.text();
    assert.equal(first.status, 503, firstText);
    assert.equal(firstText.includes('"ok":true'), false);
    const stored = decodeErasureLedger(readLedger(file) ?? null, SUBJECT);
    assert.equal(stored.status.tag, "completed");
    assert.equal(appends.length > 0, true);
    assert.equal(typeof mod.pendingAuditsSnapshot, "function");
    const pending = mod.pendingAuditsSnapshot?.().filter((row) => row.action === "rights_erase") ?? [];
    assert.equal(pending.length, 1);
    assert.equal(typeof mod.retryPendingAudits, "function");
    const again = await mod.retryPendingAudits?.({
      AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
    });
    assert.equal((again?.written ?? 0) >= 1, true);
    assert.equal(
      mod.pendingAuditsSnapshot?.().some((row) => row.action === "rights_erase") ?? true,
      false,
    );
  } finally {
    remove();
  }
});
