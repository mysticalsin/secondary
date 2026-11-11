/**
 * Second-person confirmation on the real TenantPolicy and SQLite.
 * Correct cases stay the same. A shared sign-in address must not confirm itself.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { SECOND_PERSON_TTL_MS } from "../../src/state/quorum.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;
const policySpecifier = "../../recovered-source/worker/src/tenant-policy.ts";

type Ask = { tag: string };

type Host = {
  requestSecond(key: string, actor: string, now: number, email?: string): string | Ask;
};

function decision(result: string | Ask): string {
  if (typeof result !== "string") return result.tag;
  if (result === "first") return "recorded";
  if (result === "same") return "same_actor";
  if (result === "second") return "confirmed";
  return result;
}

async function openPolicy(file: string): Promise<Host> {
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
    TenantPolicy: new (ctx: unknown, env: unknown) => Host;
  };
  const policy = new mod.TenantPolicy(ctx, {});
  await ready;
  return policy;
}

function tempFile(): { file: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "quorum-"));
  return {
    file: path.join(dir, "tenant.sqlite"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function pending(file: string, key: string): { requested_by: string; requested_at: number } | undefined {
  const db = openSqlite(file);
  const row = db
    .prepare("SELECT requested_by, requested_at FROM pending_ops WHERE key = ?")
    .get(key) as { requested_by: string; requested_at: number } | undefined;
  db.close();
  return row;
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

test("quorum: a first ask waits, the same actor does not refresh it, and a different actor confirms", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    assert.equal(decision(policy.requestSecond("switch:ai", "p1", NOW, "ada@example.invalid")), "recorded");
    const row = pending(file, "switch:ai");
    assert.equal(row?.requested_by, "p1");
    assert.equal(row?.requested_at, NOW);
    assert.equal(
      decision(policy.requestSecond("switch:ai", "p1", NOW + 1_000, "ada@example.invalid")),
      "same_actor",
    );
    const again = pending(file, "switch:ai");
    assert.equal(again?.requested_by, row?.requested_by);
    assert.equal(again?.requested_at, row?.requested_at);
    assert.equal(
      decision(policy.requestSecond("switch:ai", "p2", NOW + 2_000, "bea@example.invalid")),
      "confirmed",
    );
    assert.equal(pending(file, "switch:ai"), undefined);
    assert.equal(
      decision(policy.requestSecond("switch:ai", "p2", NOW + 3_000, "bea@example.invalid")),
      "recorded",
    );
  } finally {
    remove();
  }
});

test("quorum: two ids that share a sign-in address and are not in the directory cannot confirm", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    assert.equal(decision(policy.requestSecond("role:x", "p1", NOW, "ada@example.invalid")), "recorded");
    assert.equal(
      decision(policy.requestSecond("role:x", "p2", NOW + 1, "ada@example.invalid")),
      "same_actor",
    );
    assert.equal(pending(file, "role:x")?.requested_by, "p1");
  } finally {
    remove();
  }
});

test("quorum: an expired ask is a new request, and the last millisecond of the window still waits", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    policy.requestSecond("erase:p9", "p1", NOW, "ada@example.invalid");
    assert.equal(
      decision(policy.requestSecond("erase:p9", "p2", NOW + SECOND_PERSON_TTL_MS - 1, "bea@example.invalid")),
      "confirmed",
    );
    policy.requestSecond("fields:b", "p1", NOW, "ada@example.invalid");
    assert.equal(
      decision(policy.requestSecond("fields:b", "p2", NOW + SECOND_PERSON_TTL_MS, "bea@example.invalid")),
      "recorded",
    );
    const replaced = pending(file, "fields:b");
    assert.equal(replaced?.requested_by, "p2");
    assert.equal(replaced?.requested_at, NOW + SECOND_PERSON_TTL_MS);
  } finally {
    remove();
  }
});

test("quorum: two directory subjects are two people even when the sign-in address matches", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    addPrincipal(file, "p1", "ada@a.example", "tid:ada");
    addPrincipal(file, "p2", "ada@b.example", "tid:bea");
    assert.equal(decision(policy.requestSecond("open:b", "p1", NOW, "one@human.example")), "recorded");
    assert.equal(
      decision(policy.requestSecond("open:b", "p2", NOW + 5, "one@human.example")),
      "confirmed",
    );
    assert.equal(pending(file, "open:b"), undefined);
  } finally {
    remove();
  }
});

test("quorum: two ids with one sign-in address are the same actor", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    addPrincipal(file, "p1", "ada@a.example");
    addPrincipal(file, "p2", "ada@b.example");
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      assert.equal(decision(policy.requestSecond("export:p9", "p1", NOW, "one@human.example")), "recorded");
      assert.equal(
        decision(policy.requestSecond("export:p9", "p2", NOW + 5, "one@human.example")),
        "same_actor",
      );
    } finally {
      console.warn = warn;
    }
    assert.equal(lines.length, 0);
    assert.equal(pending(file, "export:p9")?.requested_by, "p1");
    assert.equal(pending(file, "export:p9")?.requested_at, NOW);
  } finally {
    remove();
  }
});

test("quorum: concurrent confirms accept exactly one", async () => {
  const { file, remove } = tempFile();
  try {
    const policy = await openPolicy(file);
    assert.equal(decision(policy.requestSecond("restore:snap", "p1", NOW, "ada@example.invalid")), "recorded");
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    const run = (actor: string) =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker(new URL("../runtime/quorum-worker.mts", import.meta.url), {
          execArgv: ["--experimental-strip-types"],
          workerData: { file, key: "restore:snap", actor, now: NOW + 10, email: `${actor}@example.invalid`, barrier },
        });
        worker.once("message", (value: string | Ask) => resolve(decision(value)));
        worker.once("error", reject);
      });
    const [a, b] = await Promise.all([run("p2"), run("p3")]);
    assert.deepEqual([a, b].sort(), ["confirmed", "replay"]);
    assert.equal(pending(file, "restore:snap"), undefined);
  } finally {
    remove();
  }
});

test("quorum: the second-person callers share one result and do not keep string copies", () => {
  const callers = [
    "recovered-source/worker/src/tenant-policy.ts",
    "recovered-source/worker/src/brains/data.ts",
    "recovered-source/worker/src/brains/routes.ts",
    "recovered-source/worker/src/ops-admin.ts",
    "recovered-source/worker/src/ops-internal.ts",
  ];
  const keys = [
    "switch:",
    "brainfields:",
    "brainopen:",
    "brainrole:",
    "export:",
    "erase:",
    "restore:",
  ];
  const combined = callers.map((rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8")).join("\n");
  for (const key of keys) assert.equal(combined.includes(key), true, key);
  for (const rel of callers) {
    const text = readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
    assert.equal(text.includes("quorumConfirmed"), true, rel);
    assert.equal(text.includes('=== "first"'), false, rel);
    assert.equal(text.includes('=== "same"'), false, rel);
    assert.equal(text.includes('=== "second"'), false, rel);
    assert.equal(text.includes('!== "second"'), false, rel);
  }
});
