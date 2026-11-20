/**
 * Red tests for SB-ERASURE-LEDGER-REPAIR. Each scenario has its own sqlite
 * file and its own principal, so the per-principal view cache cannot reuse
 * another scenario's result. No production code is changed in this file.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ROLES, type Org, type OrgNode, type Principal } from "../adapters/policy-entry.ts";
import { erasureCalls, installErasureTenant } from "../runtime/fake-erasure-stub.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";
import {
  absentErasure,
  commitErasure,
  decodeErasureLedger,
  erasureWithGrant,
  reportUnreadableLedgers,
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

function contractModule(name: string): string {
  return `../../packages/contracts/src/${name}`;
}

const NOW = 1_700_000_000_000;
const TENANT = "tenant_a";
const KEY = "0123456789abcdef0123456789abcdef";
const OPS = "synthetic-ops-hmac-secret-value-32";
const GRAMMAR = "[a-z0-9][A-Za-z0-9_.:@-]{0,127}";
const SENTINEL_A = "SENTINEL_SCOPE_A";
const SENTINEL_B = "SENTINEL_SCOPE_B";
const HEALTHY = ["receipts", "personal"];

type LedgerRow = { status: string; ledger: string; updated_at: number };
type Role = "platform_admin" | "consultant";
type FileMark = { name: string; mtimeMs: number; sha256: string };

type Host = {
  requestSecond(
    key: string,
    actor: string,
    now: number,
    email?: string,
    approvedSteps?: readonly string[],
  ): { tag: string };
};

type Report = {
  unreadable: number;
  principalIds: number | readonly string[];
  truncated: boolean;
};

function persona(id: string, role: Role = "platform_admin"): Principal {
  return { id, email: `${id}@example.invalid`, tenantId: TENANT, roleIds: [role], memberships: [] };
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

function tempFile(): { dir: string; file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "erasure-ledger-"));
  return {
    dir,
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function fingerprint(dir: string, prefix = ""): FileMark[] {
  const out: FileMark[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...fingerprint(full, rel));
    else
      out.push({
        name: rel,
        mtimeMs: st.mtimeMs,
        sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
      });
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...sourceFiles(full));
    else if (name.name.endsWith(".ts") || name.name.endsWith(".js") || name.name.endsWith(".mjs"))
      out.push(full);
  }
  return out;
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const names = ["log", "info", "warn", "error", "debug"] as const;
  const previous = names.map((name) => console[name]);
  for (const name of names) {
    console[name] = (...args: unknown[]) => {
      lines.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
      previous[names.indexOf(name)](...args);
    };
  }
  return {
    lines,
    restore() {
      names.forEach((name, index) => {
        console[name] = previous[index];
      });
    },
  };
}

function readableLedger(principalId: string): string {
  const mark: Record<string, string> = {};
  for (const id of HEALTHY) mark[id] = "pending";
  return JSON.stringify({
    order: HEALTHY,
    mark,
    grant: { subject: principalId, requester: "ada", confirmer: "bea", steps: HEALTHY },
  });
}

async function openPolicy(
  file: string,
  hook?: {
    queries?: string[];
    before?: (query: string, db: ReturnType<typeof openSqlite>) => void;
  },
): Promise<Host> {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let depth = 0;
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...bindings: never[]) {
          hook?.queries?.push(`${query} ${JSON.stringify(bindings)}`);
          hook?.before?.(query, db);
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

function pendingBy(file: string, principalId: string): string | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare("SELECT requested_by FROM pending_ops WHERE key = ?")
    .get(`erase:${principalId}`) as { requested_by: string } | undefined;
  db.close();
  return row?.requested_by;
}

async function adminApp(actorId: string, role: Role, scopes: readonly string[]) {
  const mod = (await import(workerModule("ops-admin.ts"))) as {
    opsAdminRoutes: (deps: { now?: () => number }) => Hono;
  };
  const who = persona(actorId, role);
  const app = new Hono<{ Variables: { requestId: string; session: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "r-ledger");
    c.set("session", { principal: who, ctx: { now: NOW }, tenantId: TENANT, org: orgWith(scopes) });
    await next();
  });
  app.route("/v1/admin", mod.opsAdminRoutes({ now: () => NOW }));
  return app;
}

function envFor(audits: string[]): { PSEUDONYM_KEY: string; AUDIT: { fetch: (input: string, init?: { body?: string }) => Promise<Response> } } {
  return {
    PSEUDONYM_KEY: KEY,
    AUDIT: {
      fetch: async (input, init) => {
        audits.push(`${input} ${init?.body ?? ""}`);
        return new Response(null, { status: 202 });
      },
    },
  };
}

async function postErase(
  actorId: string,
  principalId: string,
  scopes: readonly string[],
  role: Role,
  audits: string[],
): Promise<Response> {
  const app = await adminApp(actorId, role, scopes);
  return app.request(
    "https://api.invalid/v1/admin/rights/erase",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: principalId }),
    },
    envFor(audits),
  );
}

test("ledger repair: the erase route counts rejected company scopes and leaks no ids", async () => {
  const principalId = "p-l1";
  const { file, remove } = tempFile();
  const logs = captureLogs();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    const res = await postErase("ada-l1", principalId, ["c_ok", SENTINEL_A, SENTINEL_B], "platform_admin", audits);
    const text = await res.clone().text();
    const headerText = [...res.headers.entries()].map(([key, value]) => `${key}:${value}`).join("\n");
    const leaked = `${logs.lines.join("\n")}\n${audits.join("\n")}\n${headerText}\n${text}`;
    assert.equal(leaked.includes(SENTINEL_A), false);
    assert.equal(leaked.includes(SENTINEL_B), false);
    assert.equal(res.status, 422);
    assert.deepEqual(JSON.parse(text), { error: "invalid_scope", scopes: 2 });
    assert.equal(readLedger(file, principalId), undefined);
  } finally {
    logs.restore();
    remove();
  }
});

test("ledger repair: a caller without configure gets 403 and no scope count", async () => {
  const principalId = "p-view";
  const { file, remove } = tempFile();
  const logs = captureLogs();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    const res = await postErase("ada-view", principalId, [SENTINEL_A, SENTINEL_B], "consultant", audits);
    const text = await res.text();
    const leaked = `${logs.lines.join("\n")}\n${audits.join("\n")}\n${text}`;
    assert.equal(res.status, 403);
    assert.equal(text.includes("scopes"), false);
    assert.equal(leaked.includes(SENTINEL_A), false);
    assert.equal(leaked.includes(SENTINEL_B), false);
    assert.equal(readLedger(file, principalId), undefined);
  } finally {
    logs.restore();
    remove();
  }
});

test("ledger repair: every caller imports the exported scope grammar", () => {
  const erasurePath = path.join(root, "src/state/erasure-request.ts");
  const opsPath = path.join(root, "src/worker/ops-internal.ts");
  const erasure = readFileSync(erasurePath, "utf8");
  const ops = readFileSync(opsPath, "utf8");
  const importsGrammar =
    /import\s*\{[^}]*\bSCOPE_ID\b[^}]*\}\s*from\s*"\.\.\/state\/erasure-request\.ts"/.test(ops);
  assert.equal(importsGrammar, true);
  assert.equal(
    /export const SCOPE_ID = \/\^\[a-z0-9\]\[A-Za-z0-9_.:@-\]\{0,127\}\$/.test(erasure),
    true,
  );
  const stepStart = erasure.indexOf("export function scopeIdOfStep");
  const stepEnd = erasure.indexOf("function knownErasureStep");
  const stepBody = erasure.slice(stepStart, stepEnd);
  assert.equal(stepBody.includes("SCOPE_ID"), true);
  assert.equal(stepBody.includes("/^"), false);
  const literals: string[] = [];
  for (const file of sourceFiles(path.join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    if (text.includes(GRAMMAR)) literals.push(path.relative(root, file));
  }
  assert.deepEqual(literals, ["src/state/erasure-request.ts"]);
});

test("ledger repair: a request refuses a pending step the grammar does not place", () => {
  const opened = requireOk(
    commitErasure(absentErasure(), {
      type: "request",
      now: NOW,
      steps: HEALTHY,
    }),
  ).state;
  const step = commitErasure(opened, {
    type: "request",
    now: NOW + 1,
    steps: [...HEALTHY, "scope:C_x", "not-a-step"],
  });
  assert.equal(step.ok, false);
  if (!step.ok) assert.equal(step.reason, "unknown_step");
  assert.deepEqual(opened.order, HEALTHY);
});

test("ledger repair: a completed ledger refuses a step that cannot be placed", () => {
  let state = requireOk(
    commitErasure(absentErasure(), { type: "request", now: NOW, steps: ["receipts"] }),
  ).state;
  state = requireOk(commitErasure(state, { type: "resume", now: NOW })).state;
  state = requireOk(commitErasure(state, { type: "step_done", now: NOW, step: "receipts" })).state;
  assert.equal(state.status.tag, "completed");
  const step = commitErasure(state, {
    type: "request",
    now: NOW + 1,
    steps: ["receipts", "scope:C_x"],
  });
  assert.equal(step.ok, false);
  if (!step.ok) assert.equal(step.reason, "unknown_step");
  assert.deepEqual(state.order, ["receipts"]);
  assert.equal(state.mark.receipts, "done");
});

test("ledger repair: a restore refuses an unknown step", () => {
  let state = requireOk(
    commitErasure(absentErasure(), { type: "request", now: NOW, steps: ["receipts"] }),
  ).state;
  state = requireOk(commitErasure(state, { type: "resume", now: NOW })).state;
  state = requireOk(commitErasure(state, { type: "step_done", now: NOW, step: "receipts" })).state;
  const step = commitErasure(state, { type: "restore", now: NOW + 1, steps: ["not-a-step"] });
  assert.equal(step.ok, false);
  if (!step.ok) assert.equal(step.reason, "unknown_step");
  assert.equal(state.mark.receipts, "done");
});

test("ledger repair: erasureWithGrant refuses a bad step on a readable row", () => {
  const principalId = "p-grant";
  const existing = decodeErasureLedger(
    { status: "requested", ledger: readableLedger(principalId) },
    principalId,
  );
  assert.equal(existing.status.tag, "requested");
  const before = existing.grant?.steps.slice();
  const next = erasureWithGrant(existing, {
    subject: principalId,
    requester: "ada",
    confirmer: "cara",
    steps: [...HEALTHY, "scope:C_x", "not-a-step"],
  });
  assert.deepEqual(existing.grant?.steps, before);
  assert.deepEqual(next.grant?.steps, HEALTHY);
  assert.equal(next, existing);
});

test("ledger repair: a bad grant step is not written over the stored ledger", async () => {
  const principalId = "p-r1";
  const ledger = readableLedger(principalId);
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const first = policy.requestSecond(`erase:${principalId}`, "ada", NOW, "ada@example.invalid");
    assert.equal(first.tag, "recorded");
    assert.deepEqual(
      policy.requestSecond(`erase:${principalId}`, "bea", NOW + 1_000, "bea@example.invalid", [
        ...HEALTHY,
        "scope:C_x",
      ]),
      { tag: "refused" },
    );
    assert.equal(pendingBy(file, principalId), "ada");
    const row = readLedger(file, principalId);
    assert.equal(row?.status, "requested");
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
  } finally {
    remove();
  }
});

test("ledger repair: a signed workspace restore of a bad scope does not touch the ledger directory", async () => {
  const { dir, file, remove } = tempFile();
  const ledgerDir = path.join(dir, "ledgers");
  mkdirSync(ledgerDir);
  writeFileSync(path.join(ledgerDir, "p-restore.json"), readableLedger("p-restore"));
  writeFileSync(path.join(ledgerDir, "note.txt"), "synthetic ledger marker");
  let imported = 0;
  try {
    const policy = await openPolicy(file);
    const binding = {
      jurisdiction() {
        return binding;
      },
      idFromName() {
        return "tenant";
      },
      get() {
        return policy;
      },
    };
    const workspace = {
      jurisdiction() {
        return workspace;
      },
      idFromName() {
        return "ws";
      },
      get() {
        return {
          importAll() {
            imported += 1;
            return Promise.resolve(0);
          },
        };
      },
    };
    const mod = (await import(workerModule("ops-internal.ts"))) as {
      opsInternalRoutes: (deps: { now?: () => number }) => Hono;
    };
    const app = new Hono();
    app.route("/v1/internal/ops", mod.opsInternalRoutes({ now: () => Date.now() }));
    const signer = (await import(contractModule("ops-auth.ts"))) as {
      signOpsRequest: (input: {
        secret: string;
        method: string;
        url: string;
        body: string;
        now: number;
      }) => Promise<Record<string, string>>;
    };
    const before = fingerprint(ledgerDir);
    for (const scope of ["bad id", "C_x"]) {
      const url = `https://api.invalid/v1/internal/ops/restore?tenant=${TENANT}&kind=workspace&scope=${encodeURIComponent(scope)}`;
      const body = JSON.stringify({ tables: {} });
      const headers = await signer.signOpsRequest({
        secret: OPS,
        method: "POST",
        url,
        body,
        now: Math.floor(Date.now() / 1000),
      });
      const res = await app.request(
        url,
        { method: "POST", headers: { ...headers, "content-type": "application/json" }, body },
        {
          OPS_HMAC_KEY: OPS,
          RESTORE_ENABLED: "yes",
          ENVIRONMENT: "dev",
          DO_JURISDICTION: "off",
          DEV_AUTH_BYPASS_EMAIL: "dev@example.invalid",
          DEFAULT_TENANT_ID: TENANT,
          TENANT_POLICY: binding,
          WORKSPACE: workspace,
          AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
        },
      );
      assert.equal(res.status, 400, scope);
      assert.deepEqual(await res.json(), { error: "invalid_target" }, scope);
    }
    assert.equal(imported, 0);
    assert.deepEqual(fingerprint(ledgerDir), before);
  } finally {
    remove();
  }
});

test("ledger repair: reapplyErasures leaves mark bytes unchanged and imports no snapshot", async () => {
  const principalId = "p-reapply";
  const ledger = readableLedger(principalId);
  const { file, remove } = tempFile();
  let imported = 0;
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(principalId, "p-reapply@example.invalid");
    db.prepare(
      "INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(principalId, "pz_reapply", "[]", NOW - 1_000, NOW + 86_400_000);
    db.close();
    const rights = (await import(workerModule("ops-rights.ts"))) as {
      reapplyErasures: (
        env: unknown,
        tenantId: string,
        kind: "workspace",
        scope: string,
        now: number,
      ) => Promise<{ applied: number; skipped: string[] }>;
    };
    const applied = await rights.reapplyErasures(
      {
        PSEUDONYM_KEY: KEY,
        WORKSPACE: {
          jurisdiction() {
            return this;
          },
          idFromName() {
            return "ws";
          },
          get() {
            return {
              importAll() {
                imported += 1;
                return Promise.resolve(0);
              },
            };
          },
        },
        AUDIT: { fetch: async () => new Response(null, { status: 202 }) },
      },
      TENANT,
      "workspace",
      "bad id",
      NOW,
    );
    assert.deepEqual(applied, { applied: 0, skipped: [principalId] });
    assert.equal(imported, 0);
    assert.deepEqual(erasureCalls(), []);
    const row = readLedger(file, principalId);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
  } finally {
    remove();
  }
});

test("ledger repair: a read-only report counts an unreadable legacy ledger and does not write", async () => {
  const principalId = "p-legacy";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    writeFileSync(path.join(dir, "p-legacy.json"), ledger);
    writeFileSync(path.join(dir, "note.txt"), "synthetic ledger marker");
    mkdirSync(path.join(dir, "nested"));
    writeFileSync(path.join(dir, "nested", "row.json"), ledger);
    const beforeRow = readLedger(file, principalId);
    const decoded = decodeErasureLedger(beforeRow ?? null, principalId);
    assert.equal(decoded.status.tag, "unreadable");
    const before = fingerprint(dir);
    const mod = await import("../../src/state/erasure-request.ts");
    const report = (mod as { reportUnreadableLedgers?: unknown }).reportUnreadableLedgers;
    assert.equal(typeof report, "function");
    const call = report as (
      rows: readonly { principalId: string; status: string; ledger: string }[],
      options?: { includeIds?: boolean; limit?: number; cap?: number },
    ) => Report;
    const rows = [{ principalId, status: "requested", ledger }];
    const found = call(rows);
    assert.equal(found.unreadable, 1);
    assert.equal(found.principalIds, 1);
    assert.equal(found.truncated, false);
    assert.equal(JSON.stringify(found).includes("C_x"), false);
    assert.equal(JSON.stringify(found).includes(principalId), false);
    const listed = call(rows, { includeIds: true, limit: 10, cap: 10 });
    assert.equal(listed.unreadable, 1);
    assert.deepEqual(listed.principalIds, [principalId]);
    assert.equal(listed.truncated, false);
    assert.equal(JSON.stringify(listed).includes("C_x"), false);
    const capped = call(
      [...rows, { principalId: "p-legacy-2", status: "requested", ledger }],
      { includeIds: true, limit: 10, cap: 1 },
    );
    assert.equal(capped.truncated, true);
    assert.equal(Array.isArray(capped.principalIds) && capped.principalIds.length === 1, true);
    assert.equal(JSON.stringify([found, listed, capped]).includes("C_x"), false);
    assert.deepEqual(fingerprint(dir), before);
    const after = readLedger(file, principalId);
    assert.equal(after?.status, beforeRow?.status);
    assert.equal(after?.ledger, beforeRow?.ledger);
    assert.equal(after?.updated_at, beforeRow?.updated_at);
  } finally {
    remove();
  }
});

test("ledger repair: a caller without configure gets 403 on the ledger report", async () => {
  const principalId = "p-legacy";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    writeFileSync(path.join(dir, "note.txt"), "synthetic ledger marker");
    const nested = path.join(dir, "nested");
    mkdirSync(nested);
    writeFileSync(path.join(nested, "row.json"), ledger);
    const before = fingerprint(dir);
    const viewer = await adminApp("ada-view", "consultant", []);
    const denied = await viewer.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=1&includeIds=1",
      undefined,
      envFor(audits),
    );
    const deniedText = await denied.text();
    assert.equal(denied.status, 403);
    assert.equal(deniedText, "");
    assert.deepEqual(audits, []);
    const row = readLedger(file, principalId);
    assert.equal(row?.status, "requested");
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.deepEqual(fingerprint(dir), before);
  } finally {
    remove();
  }
});

test("ledger repair: an admin ledger report returns a count and a counts-only receipt", async () => {
  const principalId = "p-report";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    writeFileSync(path.join(dir, "note.txt"), "synthetic ledger marker");
    mkdirSync(path.join(dir, "nested"));
    writeFileSync(path.join(dir, "nested", "row.json"), ledger);
    const before = fingerprint(dir);
    const admin = await adminApp("ada-report", "platform_admin", []);
    const res = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=1",
      undefined,
      envFor(audits),
    );
    const text = await res.text();
    assert.equal(res.status, 200);
    const body = JSON.parse(text) as Report;
    assert.equal(body.unreadable, 1);
    assert.equal(body.principalIds, 1);
    assert.equal(body.truncated, false);
    assert.deepEqual(Object.keys(body).sort(), ["principalIds", "truncated", "unreadable"]);
    assert.equal(text.includes(principalId), false);
    assert.equal(text.includes("C_x"), false);
    assert.equal(audits.length, 1);
    const receipt = JSON.parse((audits[0] ?? "").slice((audits[0] ?? "").indexOf("{"))) as {
      action: string;
      reason: string;
      scopeId: string | null;
      principalId: string;
    };
    assert.deepEqual(
      { action: receipt.action, reason: receipt.reason, scopeId: receipt.scopeId },
      { action: "rights_erasure_ledgers", reason: "unreadable 1", scopeId: null },
    );
    assert.equal(JSON.stringify(receipt).includes(principalId), false);
    assert.equal(JSON.stringify(receipt).includes("C_x"), false);
    assert.equal(receipt.principalId === principalId, false);
    const row = readLedger(file, principalId);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.deepEqual(fingerprint(dir), before);
  } finally {
    remove();
  }
});

test("ledger repair: erasureWithGrant refuses a bad step when the grant does not cover the ledger", () => {
  const principalId = "p-nomatch";
  const ledger = JSON.stringify({
    order: HEALTHY,
    mark: { receipts: "pending", personal: "pending" },
    grant: { subject: principalId, requester: "ada", confirmer: "bea", steps: ["receipts"] },
  });
  const existing = decodeErasureLedger({ status: "requested", ledger }, principalId);
  assert.equal(existing.status.tag, "unreadable");
  const next = erasureWithGrant(existing, {
    subject: principalId,
    requester: "ada",
    confirmer: "cara",
    steps: [...HEALTHY, "scope:C_x", "not-a-step"],
  });
  assert.equal(next, existing);
  assert.equal(next.status.tag, "unreadable");
  assert.deepEqual(next.order, []);
});

test("ledger repair: a healthy ledger with no matching grant and a bad step is not overwritten", async () => {
  const principalId = "p-nomatch";
  const ledger = JSON.stringify({
    order: HEALTHY,
    mark: { receipts: "pending", personal: "pending" },
    grant: { subject: principalId, requester: "ada", confirmer: "bea", steps: ["receipts"] },
  });
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    assert.equal(policy.requestSecond(`erase:${principalId}`, "ada", NOW, "ada@example.invalid").tag, "recorded");
    assert.deepEqual(
      policy.requestSecond(`erase:${principalId}`, "bea", NOW + 1_000, "bea@example.invalid", [
        ...HEALTHY,
        "scope:C_x",
      ]),
      { tag: "refused" },
    );
    assert.equal(pendingBy(file, principalId), "ada");
    const row = readLedger(file, principalId);
    assert.equal(row?.status, "requested");
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
  } finally {
    remove();
  }
});

test("ledger repair: erasureWithGrant refuses a bad step when the row has no grant", () => {
  const principalId = "p-nogrant";
  const ledger = JSON.stringify({
    order: HEALTHY,
    mark: { receipts: "pending", personal: "pending" },
  });
  const existing = decodeErasureLedger({ status: "requested", ledger }, principalId);
  assert.equal(existing.status.tag, "unreadable");
  assert.equal(existing.grant, null);
  const next = erasureWithGrant(existing, {
    subject: principalId,
    requester: "ada",
    confirmer: "cara",
    steps: ["scope:C_x"],
  });
  assert.equal(next, existing);
  assert.deepEqual(next.order, []);
  assert.equal(next.mark.receipts, undefined);
});

test("ledger repair: a replayed grant does not mark a bad step done or delete the subject", async () => {
  const principalId = "p-replay";
  const ledger = JSON.stringify({ order: ["receipts"], mark: { receipts: "pending" } });
  const { file, remove } = tempFile();
  let drop = false;
  try {
    const policy = await openPolicy(file, {
      before(query, db) {
        if (drop && query.includes("DELETE FROM pending_ops WHERE key")) {
          drop = false;
          db.exec("DELETE FROM pending_ops");
        }
      },
    });
    const db = openSqlite(file);
    db.prepare("INSERT INTO principals (id, email) VALUES (?, ?)").run(principalId, "p-replay@example.invalid");
    db.close();
    putLedger(file, principalId, "requested", ledger);
    assert.equal(policy.requestSecond(`erase:${principalId}`, "ada", NOW, "ada@example.invalid").tag, "recorded");
    assert.deepEqual(
      policy.requestSecond(`erase:${principalId}`, "bea", NOW + 1_000, "bea@example.invalid", ["scope:C_x"]),
      { tag: "refused" },
    );
    assert.equal(pendingBy(file, principalId), "ada");
    drop = true;
    assert.deepEqual(
      policy.requestSecond(`erase:${principalId}`, "bea", NOW + 2_000, "bea@example.invalid", ["scope:C_x"]),
      { tag: "replay" },
    );
    const row = readLedger(file, principalId);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.equal(row?.ledger.includes('"done"'), false);
    const still = openSqlite(file);
    const person = still.prepare("SELECT id FROM principals WHERE id = ?").get(principalId) as
      | { id: string }
      | undefined;
    still.close();
    assert.equal(person?.id, principalId);
    assert.deepEqual(erasureCalls(), []);
  } finally {
    remove();
  }
});

test("ledger repair: the erase route does not turn a refused grant into 202", async () => {
  const principalId = "p-refused";
  const { file, remove } = tempFile();
  const audits: string[] = [];
  try {
    const policy = await openPolicy(file);
    const real = policy.requestSecond.bind(policy);
    policy.requestSecond = (key, actor, now, email, steps) => {
      if (steps !== undefined) return { tag: "refused" };
      return real(key, actor, now, email, steps);
    };
    const res = await postErase("ada-refused", principalId, ["c_ok"], "platform_admin", audits);
    const text = await res.text();
    assert.equal(res.status, 422);
    assert.deepEqual(JSON.parse(text), { error: "unknown_step" });
    assert.equal(text.includes("confirmed"), false);
    assert.equal(pendingBy(file, principalId), undefined);
    assert.equal(readLedger(file, principalId), undefined);
  } finally {
    remove();
  }
});

test("ledger repair: the ledger report truncates, caps the limit, and uses a database LIMIT", async () => {
  const first = "p-page-a";
  const second = "p-page-b";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  const queries: string[] = [];
  const audits: string[] = [];
  try {
    await openPolicy(file, { queries });
    putLedger(file, first, "requested", ledger);
    putLedger(file, second, "requested", ledger);
    writeFileSync(path.join(dir, "note.txt"), "synthetic ledger marker");
    mkdirSync(path.join(dir, "nested"));
    writeFileSync(path.join(dir, "nested", "row.json"), ledger);
    const before = fingerprint(dir);
    const admin = await adminApp("ada-page", "platform_admin", []);
    const res = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=1",
      undefined,
      envFor(audits),
    );
    const text = await res.text();
    assert.equal(res.status, 200);
    const body = JSON.parse(text) as Report;
    assert.equal(body.truncated, true);
    assert.equal(body.principalIds, 1);
    assert.equal(body.unreadable, 1);
    assert.equal(text.includes(first), false);
    assert.equal(text.includes(second), false);
    assert.equal(text.includes("C_x"), false);
    const limited = queries.filter((line) => line.includes("FROM erasure_requests") && line.includes("LIMIT"));
    assert.equal(limited.length > 0, true);
    assert.equal(limited.some((line) => line.includes("100001") || line.includes("99999")), false);
    const huge = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=100000",
      undefined,
      envFor(audits),
    );
    assert.equal(huge.status, 200);
    const bound = queries.filter((line) => line.includes("FROM erasure_requests") && line.includes("LIMIT"));
    assert.equal(bound.some((line) => line.includes("[101]")), true);
    assert.equal(bound.some((line) => line.includes("100000") || line.includes("100001")), false);
    assert.deepEqual(fingerprint(dir), before);
    for (const id of [first, second]) {
      const row = readLedger(file, id);
      assert.equal(row?.ledger, ledger);
      assert.equal(row?.updated_at, 5);
    }
  } finally {
    remove();
  }
});

test("ledger repair: includeIds is ignored unless the caller asks and still stays configure-only", async () => {
  const principalId = "p-legacy";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const before = fingerprint(dir);
    const admin = await adminApp("ada-ids", "platform_admin", []);
    const listed = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=10&includeIds=1",
      undefined,
      envFor(audits),
    );
    const listedText = await listed.text();
    assert.equal(listed.status, 200);
    const body = JSON.parse(listedText) as Report;
    assert.deepEqual(body.principalIds, [principalId]);
    assert.equal(body.unreadable, 1);
    assert.equal(body.truncated, false);
    assert.equal(listedText.includes("C_x"), false);
    const ignored = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=10&includeIds=yes",
      undefined,
      envFor(audits),
    );
    const ignoredText = await ignored.text();
    const ignoredBody = JSON.parse(ignoredText) as Report;
    assert.equal(ignored.status, 200);
    assert.equal(ignoredBody.principalIds, 1);
    assert.equal(ignoredText.includes(principalId), false);
    assert.equal(ignoredText.includes("C_x"), false);
    const viewer = await adminApp("ada-view-ids", "consultant", []);
    const denied = await viewer.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=10&includeIds=1",
      undefined,
      envFor(audits),
    );
    assert.equal(denied.status, 403);
    assert.equal(await denied.text(), "");
    assert.deepEqual(fingerprint(dir), before);
    const row = readLedger(file, principalId);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
  } finally {
    remove();
  }
});

test("ledger repair: a ledger report refuses when the audit write fails", async () => {
  const principalId = "p-audit";
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { dir, file, remove } = tempFile();
  try {
    await openPolicy(file);
    putLedger(file, principalId, "requested", ledger);
    const before = fingerprint(dir);
    const admin = await adminApp("ada-audit", "platform_admin", []);
    const env = envFor([]);
    env.AUDIT.fetch = async () => new Response("no", { status: 500 });
    const res = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=1&includeIds=1",
      undefined,
      env,
    );
    const text = await res.text();
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(text), { error: "audit_unavailable" });
    assert.equal(text.includes(principalId), false);
    assert.equal(text.includes("C_x"), false);
    const row = readLedger(file, principalId);
    assert.equal(row?.ledger, ledger);
    assert.equal(row?.updated_at, 5);
    assert.deepEqual(fingerprint(dir), before);
  } finally {
    remove();
  }
});

test("ledger repair: a directory fingerprint notices a nested write", () => {
  const { dir, remove } = tempFile();
  try {
    writeFileSync(path.join(dir, "note.txt"), "a");
    const nested = path.join(dir, "nested");
    mkdirSync(nested);
    writeFileSync(path.join(nested, "row.json"), "b");
    const before = fingerprint(dir);
    writeFileSync(path.join(nested, "row.json"), "c");
    assert.notDeepEqual(fingerprint(dir), before);
    writeFileSync(path.join(nested, "extra.json"), "d");
    const names = fingerprint(dir).map((mark) => mark.name);
    assert.equal(names.includes("nested/extra.json"), true);
  } finally {
    remove();
  }
});

test("ledger repair: an unknown step is refused with 422 unknown_step", async () => {
  const principalId = "p-exact";
  const { file, remove } = tempFile();
  const audits: string[] = [];
  try {
    const policy = await openPolicy(file);
    const real = policy.requestSecond.bind(policy);
    let calls = 0;
    policy.requestSecond = (key, actor, now, email, steps) => {
      calls += 1;
      if (calls === 1) return real(key, actor, now, email, steps);
      return real(key, actor, now, email, ["scope:C_x", "not-a-step"]);
    };
    const first = await postErase("ada-exact", principalId, ["c_ok"], "platform_admin", audits);
    assert.equal(first.status, 202);
    const second = await postErase("bea-exact", principalId, ["c_ok"], "platform_admin", audits);
    const text = await second.text();
    assert.equal(second.status, 422);
    assert.notEqual(second.status, 500);
    assert.deepEqual(JSON.parse(text), { error: "unknown_step" });
    assert.equal(pendingBy(file, principalId), "ada-exact");
    assert.equal(readLedger(file, principalId), undefined);
  } finally {
    remove();
  }
});

function unreadableRow(principalId: string): { principalId: string; status: string; ledger: string } {
  return {
    principalId,
    status: "requested",
    ledger: JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } }),
  };
}

test("ledger repair: the report limit keeps the first row and the cap sets truncated", () => {
  const rows = [unreadableRow("p-a"), unreadableRow("p-b"), unreadableRow("p-c")];
  const limited = reportUnreadableLedgers(rows, { limit: 1 });
  assert.equal(limited.unreadable, 1);
  assert.equal(limited.principalIds, 1);
  assert.equal(JSON.stringify(limited).includes("p-b"), false);
  const listed = reportUnreadableLedgers(rows, { includeIds: true, limit: 10, cap: 1 });
  assert.equal(listed.unreadable, 3);
  assert.deepEqual(listed.principalIds, ["p-a"]);
  assert.equal(listed.truncated, true);
  const covered = reportUnreadableLedgers(rows, { includeIds: true, limit: 10, cap: 3 });
  assert.equal(covered.truncated, false);
  assert.deepEqual(covered.principalIds, ["p-a", "p-b", "p-c"]);
});

test("ledger repair: the report clamps a limit above one hundred rows", () => {
  const rows = Array.from({ length: 120 }, (_, index) => unreadableRow(`p-${String(index).padStart(3, "0")}`));
  const clamped = reportUnreadableLedgers(rows, { limit: 500 });
  assert.equal(clamped.unreadable, 100);
  assert.equal(clamped.principalIds, 100);
  const listed = reportUnreadableLedgers(rows, { includeIds: true, limit: 500, cap: 150 });
  assert.equal(listed.unreadable, 100);
  assert.equal(Array.isArray(listed.principalIds) && listed.principalIds.length === 100, true);
  assert.equal(listed.truncated, false);
  const cut = reportUnreadableLedgers(rows, { includeIds: true, limit: 500, cap: 1 });
  assert.equal(cut.unreadable, 100);
  assert.equal(Array.isArray(cut.principalIds) && cut.principalIds.length === 1, true);
  assert.equal(cut.truncated, true);
});

test("ledger repair: the ledger page is ordered by principal id", async () => {
  const ledger = JSON.stringify({ order: ["scope:C_x"], mark: { "scope:C_x": "pending" } });
  const { file, remove } = tempFile();
  const audits: string[] = [];
  try {
    await openPolicy(file);
    putLedger(file, "p-m", "requested", ledger);
    putLedger(file, "p-a", "requested", ledger);
    const admin = await adminApp("ada-order", "platform_admin", []);
    const res = await admin.request(
      "https://api.invalid/v1/admin/rights/erasure-ledgers?limit=10&includeIds=1",
      undefined,
      envFor(audits),
    );
    const text = await res.text();
    assert.equal(res.status, 200);
    const body = JSON.parse(text) as Report;
    assert.deepEqual(body.principalIds, ["p-a", "p-m"]);
    assert.equal(body.unreadable, 2);
    assert.equal(body.truncated, false);
    assert.equal(text.includes("C_x"), false);
  } finally {
    remove();
  }
});

test("ledger repair: the grammar pin fails a javascript copy of the class", () => {
  const { dir, remove } = tempFile();
  try {
    const nested = path.join(dir, "pkg");
    mkdirSync(nested);
    writeFileSync(path.join(nested, "copy.mjs"), `export const SCOPE_ID = /^${GRAMMAR}$/;\n`);
    writeFileSync(path.join(nested, "copy.js"), `export const SCOPE_ID = /^${GRAMMAR}$/;\n`);
    writeFileSync(path.join(nested, "kept.ts"), "export const other = 1;\n");
    const hits = sourceFiles(dir)
      .map((file) => path.relative(dir, file))
      .filter((file) => readFileSync(path.join(dir, file), "utf8").includes(GRAMMAR))
      .sort();
    assert.deepEqual(hits, ["pkg/copy.js", "pkg/copy.mjs"]);
  } finally {
    remove();
  }
});
