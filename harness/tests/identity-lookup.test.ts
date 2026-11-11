/**
 * The directory lookups use the same actor rule as quorum.
 * Mixed case, padding, and two matching principals are pinned on the real modules.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

type Policy = {
  session(input: { email: string; actAs: null; now: number; limit: number }): Promise<{
    principal: { id: string };
    active: boolean;
  }>;
  resolvePrincipalId(email: string): Promise<string>;
  scimUserCreate(
    input: { userName: string; active: boolean },
    now: number,
  ): Promise<{ ok: true } | { ok: false; code: string }>;
  gov(method: string, args: unknown[]): { ok: boolean; code?: string; change?: { id: string } };
};

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
  const mod = (await import(policySpecifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  return policy;
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "identity-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function addPrincipal(file: string, id: string, email: string, subject: string | null = null): void {
  const db = openSqlite(file);
  db.prepare("INSERT INTO principals (id, email, subject) VALUES (?, ?, ?)").run(id, email, subject);
  db.close();
}

function principalCount(file: string): number {
  const db = openSqlite(file);
  const row = db.prepare("SELECT COUNT(*) AS n FROM principals").get() as { n: number };
  db.close();
  return row.n;
}

function scimPrincipal(file: string, userName: string): string | undefined {
  const db = openSqlite(file);
  const row = db.prepare("SELECT principal_id FROM scim_users WHERE user_name = ?").get(userName) as
    | { principal_id: string }
    | undefined;
  db.close();
  return row?.principal_id;
}

function scimCount(file: string): number {
  const db = openSqlite(file);
  const row = db.prepare("SELECT COUNT(*) AS n FROM scim_users").get() as { n: number };
  db.close();
  return row.n;
}

const role = {
  id: "reviewer",
  label: "Reviewer",
  summary: "Reviews",
  grants: [],
  exclusions: [],
  never: [],
};

function propose(policy: Policy, by: string, roleId: string) {
  return policy.gov("propose", [
    {
      kind: "role_upsert",
      payload: { role: { ...role, id: roleId } },
      scopeKey: `role:${roleId}`,
      scope: null,
      needsSecond: true,
      proposedBy: by,
      baseVersion: 0,
      label: "Reviewer",
    },
    NOW,
  ]);
}

test("identity lookup: mixed case, spaces, and NBSP are the same principal", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    addPrincipal(file, "p1", "Ada@A.example");
    addPrincipal(file, "pad", " ada@pad.example ");
    addPrincipal(file, "nbsp", "\u00A0ada@nbsp.example\u00A0");
    addPrincipal(file, "wide", "\u2003ada@wide.example");

    const sessionCase = await policy.session({ email: "ada@a.example", actAs: null, now: NOW, limit: 100 });
    assert.equal(sessionCase.principal.id, "p1");
    assert.equal(await policy.resolvePrincipalId("ADA@a.example"), "p1");

    const sessionPad = await policy.session({ email: "ada@pad.example", actAs: null, now: NOW, limit: 100 });
    assert.equal(sessionPad.principal.id, "pad");
    assert.equal(await policy.resolvePrincipalId("\u00A0ada@nbsp.example"), "nbsp");
    assert.equal(await policy.resolvePrincipalId("ada@wide.example"), "wide");

    const created = await policy.scimUserCreate({ userName: "ada@a.example", active: true }, NOW);
    assert.equal(created.ok, true);
    assert.equal(scimPrincipal(file, "ada@a.example"), "p1");
    assert.equal(principalCount(file), 4);

    const padded = await policy.scimUserCreate({ userName: "ada@nbsp.example", active: true }, NOW);
    assert.equal(padded.ok, true);
    assert.equal(scimPrincipal(file, "ada@nbsp.example"), "nbsp");
    assert.equal(principalCount(file), 4);
  } finally {
    remove();
  }
});

test("identity lookup: two principals that normalise together are refused", async () => {
  const { file, remove } = tempFile();
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const policy = await openPolicy(file);
    addPrincipal(file, "p1", "Ada@C.example");
    addPrincipal(file, "p2", " ada@c.example ");
    const created = await policy.scimUserCreate({ userName: "ada@c.example", active: true }, NOW);
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "ambiguous");
    assert.equal(principalCount(file), 2);
    assert.equal(scimCount(file), 0);
    const logged = lines.map((line) => JSON.parse(line) as { at?: string; reason?: string; ids?: string[] });
    const hit = logged.find((line) => line.reason === "ambiguous_principal");
    assert.deepEqual(hit?.ids, ["p1", "p2"]);
    assert.equal(JSON.stringify(hit).toLowerCase().includes("ada@"), false);
    const session = await policy.session({ email: "ada@c.example", actAs: null, now: NOW, limit: 100 });
    assert.equal(session.active, false);
    assert.equal(principalCount(file), 2);
    await assert.rejects(() => policy.resolvePrincipalId("ada@c.example"), /ambiguous_principal/);
  } finally {
    console.warn = warn;
    remove();
  }
});

test("identity lookup: governance uses the same actor rule", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    addPrincipal(file, "p1", "Ada@G.example");
    addPrincipal(file, "p2", " ada@g.example\u00A0");
    addPrincipal(file, "s1", "ada@left.example", "tid:ada");
    addPrincipal(file, "s2", "ada@right.example", "tid:bea");
    const db = openSqlite(file);
    db.prepare("INSERT INTO gov_identity (principal_id, email) VALUES (?, ?)").run("s1", "one@human.example");
    db.prepare("INSERT INTO gov_identity (principal_id, email) VALUES (?, ?)").run("s2", "one@human.example");
    db.close();

    const mixed = propose(policy, "p1", "mixed");
    assert.equal(mixed.ok, true);
    const mixedDecision = policy.gov("decide", [mixed.change?.id, true, "p2", null, NOW]);
    assert.equal(mixedDecision.ok, false);
    assert.equal(mixedDecision.code, "self_approval");

    const apart = propose(policy, "s1", "apart");
    assert.equal(apart.ok, true);
    const apartDecision = policy.gov("decide", [apart.change?.id, true, "s2", null, NOW]);
    assert.notEqual(apartDecision.code, "self_approval");
  } finally {
    remove();
  }
});
