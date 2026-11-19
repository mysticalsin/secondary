/**
 * Workspace release on the real Workspace. A record status still updates.
 * approved is not a status update.
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
const workspaceSpecifier = "../../src/worker/workspace.ts";

type Result = { ok: true; status?: string; released?: boolean; approvals?: number } | { ok: false; code: string };

type Workspace = {
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
      releaseTarget?: "scope" | "global";
    },
    now: number,
  ): { id: string };
  update(
    id: string,
    expected: number,
    patch: { status?: string },
    now: number,
    actorId: string,
  ): Result;
  edit(
    id: string,
    expected: number,
    patch: { title?: string },
    now: number,
    actorId: string,
  ): Result;
  approve(
    id: string,
    expected: number,
    actorId: string,
    now: number,
    sameHuman?: string[],
  ): Result;
  get(id: string): { status: string; revision: number } | null;
};

async function openWorkspace(): Promise<{ ws: Workspace; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "release-"));
  const db = openSqlite(path.join(dir, "workspace.sqlite"));
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
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready;
  return { ws, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

function candidate(id: string, releaseTarget: "scope" | "global" = "scope") {
  return {
    id,
    label: "Item",
    kind: "candidate",
    plane: "ACCOUNT",
    origin: "candidate" as const,
    status: "candidate",
    authorId: "author",
    body: "body",
    releaseTarget,
  };
}

test("release: a record status update is kept, and omitting status keeps the current one", async () => {
  const { ws, remove } = await openWorkspace();
  try {
    ws.create(candidate("rec"), NOW);
    const updated = ws.update("rec", 1, { status: "decided" }, NOW, "editor");
    assert.equal(updated.ok, true);
    assert.equal(ws.get("rec")?.status, "decided");
    const kept = ws.update("rec", 2, {}, NOW, "editor");
    assert.equal(kept.ok, true);
    assert.equal(ws.get("rec")?.status, "decided");
  } finally {
    remove();
  }
});

test("release: update cannot store approved or an unknown status", async () => {
  const { ws, remove } = await openWorkspace();
  try {
    ws.create(candidate("hole"), NOW);
    const approved = ws.update("hole", 1, { status: "approved" }, NOW, "editor");
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.equal(approved.code, "invalid_status");
    assert.equal(ws.get("hole")?.status, "candidate");
    const unknown = ws.update("hole", 1, { status: "nope" }, NOW, "editor");
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.code, "invalid_status");
    assert.equal(ws.get("hole")?.status, "candidate");
  } finally {
    remove();
  }
});

test("release: one approver releases a scope item, and the author cannot", async () => {
  const { ws, remove } = await openWorkspace();
  try {
    ws.create(candidate("scope"), NOW);
    const self = ws.approve("scope", 1, "author", NOW, ["author"]);
    assert.equal(self.ok, false);
    if (!self.ok) assert.equal(self.code, "self_approval");
    const released = ws.approve("scope", 1, "reviewer", NOW, ["reviewer"]);
    assert.equal(released.ok, true);
    if (released.ok) assert.equal(released.released, true);
    assert.equal(ws.get("scope")?.status, "approved");
    const edited = ws.edit("scope", ws.get("scope")?.revision ?? 0, { title: "Edited" }, NOW, "author");
    assert.equal(edited.ok, true);
    assert.equal(ws.get("scope")?.status, "candidate");
  } finally {
    remove();
  }
});

test("release: a global item stays candidate until a second person approves", async () => {
  const { ws, remove } = await openWorkspace();
  try {
    ws.create(candidate("global", "global"), NOW);
    const first = ws.approve("global", 1, "one", NOW, ["one"]);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.released, false);
    assert.equal(ws.get("global")?.status, "candidate");
    const second = ws.approve("global", 1, "two", NOW, ["two"]);
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.released, true);
    assert.equal(ws.get("global")?.status, "approved");
  } finally {
    remove();
  }
});
