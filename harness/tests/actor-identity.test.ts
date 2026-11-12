/**
 * One actor rule, on the real modules the three callers use.
 * Erase, wiki review, and workspace release all take the humanIds list.
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
const workspaceSpecifier = "../../recovered-source/worker/src/workspace.ts";

type Policy = {
  humanIds(principalId: string, email?: string): string[];
};

type Fail = { ok: false; code: string };
type Workspace = {
  wikiTouch(tenantId: string, scopeId: string, now: number): Promise<void>;
  create(
    item: {
      id: string;
      label: string;
      kind: string;
      plane: string;
      origin: "candidate";
      status: string;
      authorId: string;
      body: string | null;
    },
    now: number,
  ): { id: string };
  review(
    id: string,
    expected: number,
    actorId: string,
    verdict: string,
    now: number,
    sameHuman?: string[],
  ): { ok: true } | Fail;
  approve(
    id: string,
    expected: number,
    actorId: string,
    now: number,
    sameHuman?: string[],
  ): { ok: true } | Fail;
  wikiDecide(
    id: string,
    decision: "approve" | "reject",
    actorId: string,
    now: number,
    opts?: { sameHuman?: string[] },
  ): Promise<{ ok: true } | Fail>;
};

function tempDir(): { dir: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "actor-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

function ctxFor(file: string): { ctx: unknown; ready: () => Promise<void> } {
  const db = openSqlite(file);
  const sql = sqliteStorage(db);
  let ready: Promise<void> = Promise.resolve();
  const ctx = {
    storage: {
      sql,
      transactionSync<T>(fn: () => T): T {
        return fn();
      },
      setAlarm() {},
    },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
      return ready;
    },
  };
  return { ctx, ready: () => ready };
}

async function openPair(dir: string): Promise<{ policy: Policy; ws: Workspace }> {
  const policyCtx = ctxFor(path.join(dir, "tenant.sqlite"));
  const policyMod = (await import(policySpecifier)) as {
    TenantPolicy: new (ctx: unknown, env: unknown) => Policy;
  };
  const policy = new policyMod.TenantPolicy(policyCtx.ctx, {});
  await policyCtx.ready();
  const wsCtx = ctxFor(path.join(dir, "workspace.sqlite"));
  const wsMod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new wsMod.Workspace(wsCtx.ctx, { WIKI_ALARMS: "off" });
  await wsCtx.ready();
  await ws.wikiTouch("acme", "global", NOW);
  return { policy, ws };
}

function addPrincipal(
  file: string,
  id: string,
  email: string,
  subject: string | null = null,
): void {
  const db = openSqlite(file);
  db.prepare("INSERT INTO principals (id, email, subject) VALUES (?, ?, ?)").run(id, email, subject);
  db.close();
}

let itemN = 0;

function item(authorId: string, kind: string) {
  itemN += 1;
  return {
    id: `item-${itemN}`,
    label: "Item",
    kind,
    plane: "ACCOUNT",
    origin: "candidate" as const,
    status: "candidate",
    authorId,
    body: "body",
  };
}

/** The erase route refuses when the target id is in this list. */
function eraseRefuses(ids: string[], target: string): boolean {
  return ids.includes(target);
}

async function callers(
  ws: Workspace,
  actorId: string,
  authorId: string,
  sameHuman: string[],
): Promise<{ review: string; release: string; wiki: string }> {
  const reviewed = ws.review(ws.create(item(authorId, "candidate"), NOW).id, 1, actorId, "accept", NOW, sameHuman);
  const released = ws.approve(ws.create(item(authorId, "candidate"), NOW).id, 1, actorId, NOW, sameHuman);
  const decided = await ws.wikiDecide(
    ws.create(item(authorId, "wiki_ingest"), NOW).id,
    "reject",
    actorId,
    NOW,
    { sameHuman },
  );
  return {
    review: reviewed.ok ? "allowed" : reviewed.code,
    release: released.ok ? "allowed" : released.code,
    wiki: decided.ok ? "allowed" : decided.code,
  };
}

test("identity: a null-subject pair that shares a sign-in address is one actor", async () => {
  const { dir, remove } = tempDir();
  try {
    const { policy, ws } = await openPair(dir);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p1", "ada@a.example", null);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p2", "ada@b.example", null);
    policy.humanIds("p1", "one@human.example");
    policy.humanIds("p2", "one@human.example");
    const fromP1 = policy.humanIds("p1", "one@human.example");
    const fromP2 = policy.humanIds("p2", "one@human.example");
    assert.equal(eraseRefuses(fromP1, "p2"), true);
    assert.equal(eraseRefuses(fromP2, "p1"), true);
    assert.deepEqual(await callers(ws, "p2", "p1", fromP2), {
      review: "self_approval",
      release: "self_approval",
      wiki: "self_approval",
    });
  } finally {
    remove();
  }
});

test("identity: a mixed-case directory email is the same actor", async () => {
  const { dir, remove } = tempDir();
  try {
    const { policy, ws } = await openPair(dir);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p1", "Ada@A.example", "tid:ada");
    addPrincipal(path.join(dir, "tenant.sqlite"), "p2", "ada@b.example", null);
    policy.humanIds("p1", "one@human.example");
    policy.humanIds("p2", "ada@a.example");
    const fromP1 = policy.humanIds("p1", "one@human.example");
    const fromP2 = policy.humanIds("p2", "ada@a.example");
    assert.equal(eraseRefuses(fromP1, "p2"), true);
    assert.equal(eraseRefuses(fromP2, "p1"), true);
    assert.deepEqual(await callers(ws, "p1", "p2", fromP1), {
      review: "self_approval",
      release: "self_approval",
      wiki: "self_approval",
    });
  } finally {
    remove();
  }
});

test("identity: whitespace and NBSP in subjects and emails are the same actor", async () => {
  const { dir, remove } = tempDir();
  try {
    const { policy, ws } = await openPair(dir);
    const nbsp = "\u00A0";
    addPrincipal(path.join(dir, "tenant.sqlite"), "p1", "ada@a.example", ` ${nbsp}tid:ada `);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p2", "ada@b.example", `tid:ada${nbsp}`);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p3", `${nbsp}ada@c.example `, null);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p4", "ada@c.example", null);
    const subjects = policy.humanIds("p1", "one@a.example");
    const subjectsBack = policy.humanIds("p2", "two@b.example");
    assert.equal(eraseRefuses(subjects, "p2"), true);
    assert.equal(eraseRefuses(subjectsBack, "p1"), true);
    assert.deepEqual(await callers(ws, "p2", "p1", subjectsBack), {
      review: "self_approval",
      release: "self_approval",
      wiki: "self_approval",
    });
    const emails = policy.humanIds("p3", "");
    const emailsBack = policy.humanIds("p4", "");
    assert.equal(eraseRefuses(emails, "p4"), true);
    assert.equal(eraseRefuses(emailsBack, "p3"), true);
    assert.deepEqual(await callers(ws, "p4", "p3", emailsBack), {
      review: "self_approval",
      release: "self_approval",
      wiki: "self_approval",
    });
  } finally {
    remove();
  }
});

test("identity: two directory subjects stay two people, in either order", async () => {
  const { dir, remove } = tempDir();
  try {
    const { policy, ws } = await openPair(dir);
    addPrincipal(path.join(dir, "tenant.sqlite"), "p1", "ada@a.example", "tid:ada");
    addPrincipal(path.join(dir, "tenant.sqlite"), "p2", "ada@b.example", "tid:bea");
    const fromP1 = policy.humanIds("p1", "one@human.example");
    const fromP2 = policy.humanIds("p2", "one@human.example");
    assert.equal(eraseRefuses(fromP1, "p2"), false);
    assert.equal(eraseRefuses(fromP2, "p1"), false);
    const forward = await callers(ws, "p2", "p1", fromP2);
    assert.equal(forward.review, "allowed");
    assert.equal(forward.release, "allowed");
    assert.notEqual(forward.wiki, "self_approval");
    const back = await callers(ws, "p1", "p2", fromP1);
    assert.equal(back.review, "allowed");
    assert.equal(back.release, "allowed");
    assert.notEqual(back.wiki, "self_approval");
  } finally {
    remove();
  }
});
