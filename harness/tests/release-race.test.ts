/**
 * Two approvers can pass the in-memory release decision before either row is stored.
 * Exactly one release is allowed. The author refusal is the current behaviour.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const workspaceSpecifier = "../../src/worker/workspace.ts";

type Approve = { ok: true; released: boolean } | { ok: false; code: string };

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
  approve(
    id: string,
    expected: number,
    actorId: string,
    now: number,
    sameHuman?: string[],
  ): Approve;
};

async function openWorkspace(file: string): Promise<Workspace> {
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
  const mod = (await import(workspaceSpecifier)) as {
    Workspace: new (ctx: unknown, env: unknown) => Workspace;
  };
  const ws = new mod.Workspace(ctx, { WIKI_ALARMS: "off" });
  await ready;
  return ws;
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "release-race-"));
  return {
    file: path.join(dir, "workspace.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function item(id: string, releaseTarget: "scope" | "global") {
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

function outcome(result: Approve): string {
  if (!result.ok) return result.code;
  return result.released ? "released" : "waiting";
}

function releasedRows(file: string): number {
  const db = openSqlite(file);
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'item.released'")
    .get() as { n: number };
  db.close();
  return n.n;
}

function approvePair(file: string, id: string): Promise<[Approve, Approve]> {
  const barrier = new Int32Array(new SharedArrayBuffer(4));
  const run = (actor: string) =>
    new Promise<Approve>((resolve, reject) => {
      const worker = new Worker(new URL("../runtime/release-worker.mts", import.meta.url), {
        execArgv: ["--experimental-strip-types"],
        workerData: { file, id, actor, now: NOW + 10, barrier },
      });
      worker.once("message", (value: Approve) => resolve(value));
      worker.once("error", reject);
    });
  return Promise.all([run("p2"), run("p3")]);
}

test("release race: two approvers of one scope item release exactly once", async () => {
  const { file, remove } = tempFile();
  try {
    const ws = await openWorkspace(file);
    ws.create(item("scope", "scope"), NOW);
    const [a, b] = await approvePair(file, "scope");
    assert.deepEqual([outcome(a), outcome(b)].sort(), ["released", "replay"]);
    assert.equal(releasedRows(file), 1);
  } finally {
    remove();
  }
});

test("release race: two second approvers of one global item release exactly once", async () => {
  const { file, remove } = tempFile();
  try {
    const ws = await openWorkspace(file);
    ws.create(item("global", "global"), NOW);
    const first = ws.approve("global", 1, "one", NOW, ["one"]);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.released, false);
    const [a, b] = await approvePair(file, "global");
    assert.deepEqual([outcome(a), outcome(b)].sort(), ["released", "replay"]);
    assert.equal(releasedRows(file), 1);
  } finally {
    remove();
  }
});

test("CHARACTERIZATION: the author of an item cannot release it", async () => {
  const { file, remove } = tempFile();
  try {
    const ws = await openWorkspace(file);
    ws.create(item("mine", "scope"), NOW);
    const self = ws.approve("mine", 1, "author", NOW, ["author"]);
    assert.equal(self.ok, false);
    if (!self.ok) assert.equal(self.code, "self_approval");
    assert.equal(releasedRows(file), 0);
  } finally {
    remove();
  }
});
